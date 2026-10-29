// Reglas del juego. No toca archivos ni la base de datos: todo lo de acá se puede probar solo.

export const NOMBRE_JUEGO = 'Crack del Día';

const MS_DIA = 86_400_000;
const OFFSET_ARGENTINA_HORAS = -3; // el día cambia a las 00:00 hora argentina
const MAX_CLUBES = 8; // cuántos clubes se usan como pistas (los primeros de la carrera)

// ───────────── Texto ─────────────

// Para comparar nombres sin importar tildes, mayúsculas ni signos: "Ángel Di María" -> "angel di maria"
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Mapa "nombre normalizado" -> conjunto de ids (nombres y apodos). Sirve para resolver lo que escribe la persona.
export function construirIndice(lista) {
  const indice = new Map();
  for (const j of lista) {
    for (const nombre of [j.nombre, ...(j.alias ?? [])]) {
      const clave = normalizar(nombre);
      if (!clave) continue;
      if (!indice.has(clave)) indice.set(clave, new Set());
      indice.get(clave).add(j.id);
    }
  }
  return indice;
}

export function resolverTexto(texto, indice) {
  const ids = indice.get(normalizar(texto));
  if (!ids || ids.size === 0) return { tipo: 'ninguno' };
  if (ids.size > 1) return { tipo: 'ambiguo' };
  return { tipo: 'uno', id: [...ids][0] };
}

// ───────────── Fechas ─────────────

export function fechaDeHoy(ahora = Date.now()) {
  return new Date(ahora + OFFSET_ARGENTINA_HORAS * 3_600_000).toISOString().slice(0, 10);
}

export function fechaValida(f) {
  return typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(f));
}

export function diaAnterior(fecha, cuantos = 1) {
  return new Date(Date.parse(fecha) - cuantos * MS_DIA).toISOString().slice(0, 10);
}

export function numeroDeDia(fecha, inicio) {
  return Math.max(1, Math.round((Date.parse(fecha) - Date.parse(inicio)) / MS_DIA) + 1);
}

// ───────────── Pistas ─────────────

function rango(desde, hasta) {
  if (desde == null && hasta == null) return '';
  if (hasta == null) return `desde ${desde}`;
  if (desde == null) return `hasta ${hasta}`;
  return desde === hasta ? String(desde) : `${desde}–${hasta}`;
}

// Junta los pasos por un mismo club: "Boca Juniors 1996–2002 y 2007–2014"
function clubesAgrupados(carrera) {
  const grupos = new Map();
  for (const paso of carrera ?? []) {
    if (!paso.club) continue;
    if (!grupos.has(paso.club)) grupos.set(paso.club, []);
    const r = rango(paso.desde, paso.hasta);
    if (r) grupos.get(paso.club).push(r);
  }
  return [...grupos].map(([club, rangos]) => ({ club, rangos }));
}

// Las pistas básicas: se ven todas desde que arranca la partida y no cuestan puntos.
// En este orden: posición, altura, debut, retiro y debut en la selección.
// Si un dato no existe, esa pista se omite (no se inventa nada).
export function basicasDe(j) {
  const basicas = [];
  if (j.posicion) basicas.push({ tipo: 'posicion', etiqueta: 'Posición', valor: j.posicion });
  if (j.alturaCm) {
    basicas.push({ tipo: 'altura', etiqueta: 'Altura', valor: (j.alturaCm / 100).toFixed(2).replace('.', ',') });
  }
  if (j.debut != null) basicas.push({ tipo: 'debut', etiqueta: 'Debut', valor: String(j.debut) });
  if (j.activo) {
    basicas.push({ tipo: 'retiro', etiqueta: 'Retiro', valor: '—' }); // sigue jugando
  } else if (j.retiro != null && !j.retiroIncompleto) {
    basicas.push({ tipo: 'retiro', etiqueta: 'Retiro', valor: String(j.retiro) });
  }
  if (j.debutSeleccion != null) {
    basicas.push({ tipo: 'seleccion', etiqueta: 'Selección', valor: `debut ${j.debutSeleccion}` });
  }
  return basicas;
}

// ───────────── Categorías de pistas que se piden ─────────────

// Texto de una sola línea: un ítem o ninguno.
const unItem = (etiqueta, valor) => {
  const texto = typeof valor === 'number' ? String(valor) : String(valor ?? '').trim();
  return texto ? [{ etiqueta, valor: texto }] : [];
};

// Lista de textos: un ítem por elemento, sin vacíos ni repetidos.
const variosItems = (etiqueta, valores) => {
  const vistos = new Set();
  const items = [];
  for (const v of Array.isArray(valores) ? valores : []) {
    const texto = String(v ?? '').trim();
    if (!texto || vistos.has(texto)) continue;
    vistos.add(texto);
    items.push({ etiqueta, valor: texto });
  }
  return items;
};

// El catálogo: para agregar una categoría nueva alcanza con sumar una entrada acá.
// `items(jugador)` devuelve la lista ordenada de pistas de esa categoría ([] si el jugador no tiene datos).
// Cada pedido revela el próximo ítem; la categoría aparece en el modal solo si tiene al menos uno.
export const CATEGORIAS = [
  {
    id: 'carrera',
    nombre: 'Carrera',
    detalle: 'Los clubes, uno por uno',
    items: (j) =>
      clubesAgrupados(j.carrera)
        .slice(0, MAX_CLUBES)
        .map(({ club, rangos }, i) => ({
          etiqueta: `${i + 1}°`,
          valor: [club, rangos.join(' y ')].filter(Boolean).join(' '),
        })),
  },
  { id: 'apodo', nombre: 'Apodo', detalle: 'Cómo le dicen', items: (j) => unItem('Apodo', j.apodo) },
  {
    // El nombre en pantalla es "Vitrina" (con la aclaración "títulos y premios" en el modal), pero
    // el campo interno sigue siendo `palmares` (así lo guarda bajar-palmares.mjs).
    id: 'palmares',
    nombre: 'Vitrina',
    detalle: 'Títulos y premios',
    // El campo `titulo` se carga a mano y es el más jugoso: va primero.
    items: (j) => variosItems('Vitrina', [j.titulo, ...(Array.isArray(j.palmares) ? j.palmares : [])]),
  },
  {
    id: 'nacimiento',
    nombre: 'Nacimiento',
    detalle: 'Dónde nació',
    items: (j) => unItem('Nació en', j.lugarNacimiento),
  },
  { id: 'dorsal', nombre: 'Dorsal', detalle: 'El número que usó', items: (j) => unItem('Dorsal', j.dorsal) },
  {
    id: 'curiosidades',
    nombre: 'Curiosidades',
    detalle: 'Datos sueltos',
    items: (j) => variosItems('Dato', j.curiosidades),
  },
];

const CATEGORIA_POR_ID = new Map(CATEGORIAS.map((c) => [c.id, c]));

export const nombreCategoria = (id) => CATEGORIA_POR_ID.get(id)?.nombre ?? id;

// Mapa (en el orden del catálogo) id de categoría -> ítems [{ etiqueta, valor }].
// Solo entran las categorías para las que el jugador tiene datos.
export function categoriasDe(j) {
  const mapa = new Map();
  for (const categoria of CATEGORIAS) {
    const items = categoria.items(j);
    if (items.length) mapa.set(categoria.id, items);
  }
  return mapa;
}

// ───────────── Puntaje ─────────────

export const PUNTAJE_BASE = 1000;
export const COSTO_PISTA = 100;
export const PUNTAJE_MINIMO = 100;

// Fijo: no depende de cuántos datos tenga el jugador. Las básicas son gratis.
// Sin pistas pedidas vale 1000; cada pista pedida resta 100, con piso de 100.
export function puntaje(pedidas = 0) {
  return Math.max(PUNTAJE_MINIMO, PUNTAJE_BASE - COSTO_PISTA * Math.max(0, pedidas));
}

// Tope de pistas pagas: las que hacen falta para llegar al piso (hoy 9). Pasado ese punto cada pista
// costaría 0, así que se cortan ahí. Sale de la fórmula: si cambian los números, cambia solo.
export const MAX_PISTAS = Math.ceil((PUNTAJE_BASE - PUNTAJE_MINIMO) / COSTO_PISTA);

// ───────────── Jugador del día ─────────────

// Cuántos nombres equivocados se permiten. Al tercero la partida termina en 0 puntos.
export const INTENTOS_MAX = 3;

// Sirve como jugador del día si se lo puede adivinar: con al menos 3 pistas básicas de arranque
// y alguna categoría para pedir (si no, el botón "Pedir pista" nacería muerto).
export const MIN_BASICAS = 3;

export function esElegible(j, minPopularidad = 0) {
  return (
    Boolean(j.jugable) &&
    !j.excluir &&
    j.debut != null &&
    (j.popularidad ?? 0) >= minPopularidad &&
    basicasDe(j).length >= MIN_BASICAS &&
    categoriasDe(j).size > 0
  );
}

// El jugador del día tiene que tener alguna cercanía con Argentina: ser argentino (por origen o
// nacionalidad) o haber pasado por un club del fútbol argentino. Es más laxo que el checkbox de
// práctica a propósito: un argentino que nunca jugó acá (Messi) igual puede salir.
export function esArgentinoOJugoEnArgentina(j) {
  return j.origen === 'Argentinos' || j.nacionalidad?.codigo === 'ar' || j.jugoEnArgentina === true;
}

function hashTexto(texto) {
  let h = 1779033703 ^ texto.length;
  for (let i = 0; i < texto.length; i++) {
    h = Math.imul(h ^ texto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function generadorAlAzar(semilla) {
  let a = semilla;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mezcla fija (según la semilla secreta) de todos los elegibles: no se repite ninguno hasta dar toda la vuelta.
export function elegirDelDia(elegibles, numero, semilla) {
  if (!elegibles.length) return null;
  const orden = [...elegibles].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const azar = generadorAlAzar(hashTexto(String(semilla)));
  for (let i = orden.length - 1; i > 0; i--) {
    const k = Math.floor(azar() * (i + 1));
    [orden[i], orden[k]] = [orden[k], orden[i]];
  }
  return orden[(numero - 1) % orden.length];
}
