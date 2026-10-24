// Arma el palmarés de un jugador a partir de la sección "Palmarés" de su artículo en Wikipedia en
// español (el HTML que devuelve la REST API de MediaWiki, /api/rest_v1/page/html/<título>).
// Funciones puras: no hacen red ni tocan archivos, así se pueden testear con HTML guardado.
// Las usa bajar-palmares.mjs.
import { parse } from 'node-html-parser';
import { normalizar } from './juego.js';

export const MAX_ITEMS = 10;

// ───────────── Leer una tabla, con rowspan y colspan ─────────────

// Saca las notas al pie ("[520]") antes de leer el texto: si no, quedan pegadas al nombre.
function textoLimpio(el) {
  if (!el) return '';
  const clon = el.clone();
  clon.querySelectorAll('sup').forEach((s) => s.remove());
  return clon.text.replace(/\s+/g, ' ').trim();
}

// El primer enlace "de contenido" de una celda (si tiene): de ahí sale el país real de una
// "selección" aunque el texto visible solo diga el nombre del país, y el nombre completo de un
// torneo cuando la celda del año está abreviada ("M-1975"). Antes del enlace que importa suele
// venir el de la banderita (un <a> a "Archivo:Flag_of_...svg", dentro de la celda): hay que saltarlo.
function primerEnlace(el) {
  const enlaces = el?.querySelectorAll('a') ?? [];
  const a = enlaces.find((e) => !/^\.?\/?(archivo|file):/i.test(e.getAttribute('href') ?? '')) ?? enlaces[0];
  if (!a) return null;
  return { href: a.getAttribute('href') ?? '', title: a.getAttribute('title') ?? '', texto: textoLimpio(a) };
}

// Convierte una <table> en una grilla de filas × columnas, resolviendo rowspan/colspan: una celda
// que ocupa varias filas aparece repetida en cada una. Cada celda queda como { texto, enlace }.
// Se apoya en las filas reales del <tbody>; una fila que es un único <th colspan> (un divisor como
// "Jugador del partido" dentro de la tabla de distinciones) se devuelve como null y se descarta.
export function normalizarFilas(tabla) {
  const filas = tabla.querySelectorAll('tbody > tr');
  const pendientes = []; // { col, celda, restante }
  const grilla = [];
  for (const fila of filas) {
    const celdas = fila.querySelectorAll('td, th');
    if (celdas.length === 1 && celdas[0].tagName === 'TH') {
      grilla.push(null); // fila divisora, no es un dato
      continue;
    }
    const salida = [];
    let celdaIdx = 0;
    let col = 0;
    while (celdaIdx < celdas.length || pendientes.some((p) => p.restante > 0)) {
      const pendiente = pendientes.find((p) => p.col === col && p.restante > 0);
      if (pendiente) {
        salida[col] = pendiente.celda;
        pendiente.restante--;
        col++;
        continue;
      }
      if (celdaIdx >= celdas.length) break;
      const elemento = celdas[celdaIdx++];
      const celda = { texto: textoLimpio(elemento), enlace: primerEnlace(elemento) };
      const colspan = Number(elemento.getAttribute('colspan') || 1);
      const rowspan = Number(elemento.getAttribute('rowspan') || 1);
      for (let c = 0; c < colspan; c++) {
        salida[col + c] = celda;
        if (rowspan > 1) pendientes.push({ col: col + c, celda, restante: rowspan - 1 });
      }
      col += colspan;
    }
    grilla.push(salida);
  }
  return grilla;
}

// ───────────── Qué es cada columna ─────────────

// Ojo: normalizar() (lib/juego.js) también se come la tilde de la ñ al sacar los acentos, así que
// "Año" normaliza a "ano", no "anio".
const esColumna = (patron) => (texto) => patron.test(normalizar(texto ?? ''));
const esTitulo = esColumna(/^titulo/);
const esEquipo = esColumna(/^(club|equipo)\b/);
const esAnio = esColumna(/^ano/);
const esDistincion = esColumna(/^distinc/);

// A partir de la fila de encabezados, dice qué forma tiene la tabla: de títulos (con equipo) o de
// distinciones individuales. Devuelve los índices de columna que hacen falta, o null si no se
// reconoce (la tabla se descarta, mejor eso que inventar datos).
function formaDeTabla(encabezados) {
  const idx = (f) => encabezados.findIndex(f);
  const iDistincion = idx(esDistincion);
  if (iDistincion >= 0) {
    const iAnio = idx(esAnio);
    return { tipo: 'distinciones', iDistincion, iAnio };
  }
  const iTitulo = idx(esTitulo);
  const iEquipo = idx(esEquipo);
  const iAnio = idx(esAnio);
  if (iTitulo >= 0 && iEquipo >= 0 && iAnio >= 0) return { tipo: 'equipo', iTitulo, iEquipo, iAnio };
  return null;
}

// ¿El equipo de esta celda es en realidad una selección nacional? Wikipedia enlaza esas celdas a
// "Selección de fútbol (sub-X) de <país>" aunque el texto visible sea solo el nombre del país. A
// veces (ediciones recientes, todavía sin wikilink) la celda es puro texto: "Selección de Argentina".
const RE_SELECCION = /selecci[oó]n de f[uú]tbol/i;
export function esSeleccion(celdaEquipo) {
  if (celdaEquipo?.enlace) {
    const destino = `${celdaEquipo.enlace.href} ${celdaEquipo.enlace.title}`;
    if (RE_SELECCION.test(destino)) return true;
  }
  return /^selecci[oó]n\b/i.test(celdaEquipo?.texto ?? '');
}

// El nombre del país a partir del título del enlace ("Selección de fútbol sub-20 de Argentina" ->
// "Argentina"); si no se puede, se limpia el texto visible a mano.
export function nombreDeSeleccion(celdaEquipo) {
  const titulo = celdaEquipo?.enlace?.title ?? '';
  const m = /^selecci[oó]n de f[uú]tbol(?: sub-\d+)?(?: olímpica)? de (.+)$/i.exec(titulo);
  if (m) return m[1].trim();
  return (celdaEquipo?.texto ?? '')
    .replace(/^selecci[oó]n( olímpica)? de /i, '')
    .replace(/\s+sub-\d+$/i, '')
    .trim();
}

// El primer año de 4 cifras que aparece en el texto ("1989/90" -> "1989", "M-1975" -> "1975").
function anioDe(texto) {
  return /(\d{4})/.exec(texto ?? '')?.[1] ?? null;
}

// Cuando la celda del año no es un año "limpio" (p. ej. "M-1975", porque el campeonato se juega por
// torneos cortos), el nombre del título real está en el enlace de esa celda, no en la columna
// "Título" (que suele repetir algo genérico como "Primera División"): "Campeonato Metropolitano
// 1975 (Argentina)" -> "Campeonato Metropolitano".
function tituloEspecifico(celdaAnio) {
  const titulo = celdaAnio?.enlace?.title ?? '';
  const m = /^(.+?)\s+\d{4}(?:[-/]\d{2,4})?\s*(?:\([^)]*\))?$/.exec(titulo);
  return m ? m[1].trim() : null;
}

// ───────────── Frases idiomáticas para los títulos con la selección ─────────────

// Ojo: normalizar() también saca los guiones ("Sub-20" -> "sub 20"), así que estos patrones van sin "-".
const FRASES_SELECCION = [
  [/copa mundial.*sub ?20|copa mundial.*juvenil/, 'Campeón del Mundo Sub-20'],
  [/copa mundial.*sub ?17/, 'Campeón del Mundo Sub-17'],
  [/copa mundial de futbol sala/, 'Campeón del Mundo de Futsal'],
  [/^copa mundial( de futbol)?( de la fifa)?$/, 'Campeón del Mundo'],
  [/copa america/, 'Campeón de América'],
  [/juegos olimpicos|torneo olimpico/, 'Campeón Olímpico'],
  [/copa confederaciones/, 'Campeón de la Copa Confederaciones'],
  [/eurocopa|campeonato europeo/, 'Campeón de Europa'],
];

export function fraseCampeon(titulo) {
  const t = normalizar(titulo);
  const conocida = FRASES_SELECCION.find(([patron]) => patron.test(t));
  return conocida ? conocida[1] : `Campeón de la ${titulo}`;
}

// ───────────── De la grilla a los ítems ─────────────

// Un ítem crudo, antes de agrupar por años: a qué categoría pertenece (para el orden final), el
// texto ya armado salvo los años, y la clave para agrupar, y el año de esa fila.
function itemsDeTablaEquipo(grilla, forma, esInternacional) {
  const items = [];
  for (const fila of grilla) {
    if (!fila) continue;
    const celdaTitulo = fila[forma.iTitulo];
    const celdaEquipo = fila[forma.iEquipo];
    const celdaAnio = fila[forma.iAnio];
    if (!celdaTitulo?.texto || !celdaEquipo?.texto) continue;
    const anio = anioDe(celdaAnio?.texto);
    if (!anio) continue;

    const seleccion = esSeleccion(celdaEquipo);
    const anioLimpio = /^\d{4}/.test((celdaAnio?.texto ?? '').trim());
    const titulo = (!anioLimpio && tituloEspecifico(celdaAnio)) || celdaTitulo.texto;
    const equipo = seleccion ? nombreDeSeleccion(celdaEquipo) : celdaEquipo.texto;
    if (!equipo) continue;

    const juvenil = seleccion && /sub-\d+/i.test(`${celdaEquipo?.enlace?.href ?? ''} ${celdaEquipo?.texto ?? ''}`);
    const categoria = seleccion ? (juvenil ? 'seleccionJuvenil' : 'seleccionAbsoluta') : esInternacional ? 'internacional' : 'nacional';
    items.push({ categoria, titulo, equipo, anio, seleccion });
  }
  return items;
}

function itemsDeTablaDistinciones(grilla, forma) {
  const items = [];
  for (const fila of grilla) {
    if (!fila) continue;
    const celda = fila[forma.iDistincion];
    if (!celda?.texto) continue;
    const anio = forma.iAnio >= 0 ? anioDe(fila[forma.iAnio]?.texto) : null;
    items.push({ categoria: 'individual', titulo: celda.texto, equipo: null, anio });
  }
  return items;
}

// Agrupa por (categoría, título, equipo) uniendo los años, y arma el texto final de cada ítem.
function agruparYFormatear(items) {
  const grupos = new Map();
  const orden = [];
  for (const item of items) {
    const clave = `${item.categoria}\u0000${item.titulo}\u0000${item.equipo ?? ''}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, { ...item, anios: new Set() });
      orden.push(clave);
    }
    if (item.anio) grupos.get(clave).anios.add(item.anio);
  }
  return orden.map((clave) => {
    const g = grupos.get(clave);
    const anios = [...g.anios].sort().join(', ');
    if (g.categoria === 'individual') return anios ? `${g.titulo} (${anios})` : g.titulo;
    const frase = g.seleccion ? fraseCampeon(g.titulo) : g.titulo;
    return anios ? `${frase} con ${g.equipo} (${anios})` : `${frase} con ${g.equipo}`;
  });
}

// ───────────── Punto de entrada ─────────────

// `html`: el documento completo (como lo devuelve la REST API). Devuelve un array de hasta
// MAX_ITEMS strings, en este orden: selección absoluta, selección juvenil/olímpica, torneos
// internacionales de club, títulos nacionales (y regionales), distinciones individuales.
export function extraerPalmares(html) {
  const root = parse(html, { comment: false });
  const h2 = root.querySelectorAll('h2').find((h) => textoLimpio(h).startsWith('Palmarés'));
  if (!h2) return [];
  const seccion = h2.closest('section') ?? h2.parentNode;
  if (!seccion) return [];

  const porCategoria = { seleccionAbsoluta: [], seleccionJuvenil: [], internacional: [], nacional: [], individual: [] };
  for (const tabla of seccion.querySelectorAll('table')) {
    const filas = tabla.querySelectorAll('tbody > tr');
    if (!filas.length) continue;
    const encabezados = filas[0].querySelectorAll('th, td').map((c) => textoLimpio(c));
    const forma = formaDeTabla(encabezados);
    if (!forma) continue;

    const grilla = normalizarFilas(tabla).slice(1); // la primera fila ya se usó como encabezado
    let items;
    if (forma.tipo === 'distinciones') {
      items = itemsDeTablaDistinciones(grilla, forma);
    } else {
      const encabezadoSeccion = tabla.closest('section')?.querySelector('h2, h3, h4, h5, h6');
      const esInternacional = /internacional/.test(normalizar(encabezadoSeccion ? textoLimpio(encabezadoSeccion) : ''));
      items = itemsDeTablaEquipo(grilla, forma, esInternacional);
    }
    for (const item of items) porCategoria[item.categoria].push(item);
  }

  const items = [
    ...agruparYFormatear(porCategoria.seleccionAbsoluta),
    ...agruparYFormatear(porCategoria.seleccionJuvenil),
    ...agruparYFormatear(porCategoria.internacional),
    ...agruparYFormatear(porCategoria.nacional),
    ...agruparYFormatear(porCategoria.individual),
  ];
  return items.slice(0, MAX_ITEMS);
}
