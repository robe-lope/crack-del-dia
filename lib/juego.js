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

// Pistas en el orden del programa: posición, altura, debut, retiro, título; después la selección y los clubes.
// Si un dato no existe, esa pista se omite (no se inventa nada).
export function pistasDe(j) {
  const pistas = [];
  if (j.posicion) pistas.push({ tipo: 'posicion', etiqueta: 'Posición', valor: j.posicion });
  if (j.alturaCm) {
    pistas.push({ tipo: 'altura', etiqueta: 'Altura', valor: (j.alturaCm / 100).toFixed(2).replace('.', ',') });
  }
  if (j.debut != null) pistas.push({ tipo: 'debut', etiqueta: 'Debut', valor: String(j.debut) });
  if (j.activo) {
    pistas.push({ tipo: 'retiro', etiqueta: 'Retiro', valor: '—' }); // sigue jugando
  } else if (j.retiro != null && !j.retiroIncompleto) {
    pistas.push({ tipo: 'retiro', etiqueta: 'Retiro', valor: String(j.retiro) });
  }
  if (j.titulo) pistas.push({ tipo: 'titulo', etiqueta: 'Título', valor: j.titulo });
  if (j.debutSeleccion != null) {
    pistas.push({ tipo: 'seleccion', etiqueta: 'Selección', valor: `debut ${j.debutSeleccion}` });
  }
  clubesAgrupados(j.carrera)
    .slice(0, MAX_CLUBES)
    .forEach(({ club, rangos }, i) => {
      pistas.push({ tipo: 'club', etiqueta: `${i + 1}°`, valor: [club, rangos.join(' y ')].filter(Boolean).join(' ') });
    });
  return pistas;
}

// Resolver con la primera pista vale 1000; con la última vale 1000 / cantidad de pistas.
export function puntaje(pistasUsadas, totalPistas) {
  if (totalPistas <= 0) return 0;
  return Math.round((1000 * (totalPistas - pistasUsadas + 1)) / totalPistas);
}

// ───────────── Jugador del día ─────────────

// Cuántos nombres equivocados se permiten. Al tercero la partida termina en 0 puntos.
export const INTENTOS_MAX = 3;

export function esElegible(j, minPopularidad = 0) {
  return Boolean(j.jugable) && !j.excluir && j.debut != null && (j.popularidad ?? 0) >= minPopularidad && pistasDe(j).length >= 5;
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
