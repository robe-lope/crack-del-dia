// bajar-palmares.mjs
// Arma el campo "palmares" (array de strings) de cada jugador a partir de la sección "Palmarés" de
// su artículo en Wikipedia en español: "Campeón del Mundo con Argentina (1978)", "Campeonato
// Metropolitano con River Plate (1975, 1979, 1980)". Hoy ese campo sale de Wikidata (premios, P166)
// y cubre bastante menos jugadores, con huecos (campeones del mundo que no figuran como tales).
//
// Uso:  node bajar-palmares.mjs data/players.json
//       node bajar-palmares.mjs data/players.json --solo-manual   (sin internet: solo extras-manual.json)
// Requiere Node 18 o más nuevo. Tarda bastante (una consulta a Wikipedia por jugador, con pausa de
// cortesía): se puede cortar con Ctrl+C en cualquier momento y retomar después, por el caché en
// cache/palmares-html/.
//
// Proceso:
//   1. Resuelve el título del artículo de cada jugador con una consulta a Wikidata (sitelink a
//      eswiki), en lotes. Sin artículo en español, prueba en inglés (el parser es específico de las
//      tablas en español, así que de un artículo en inglés casi nunca sale nada, pero no está de más
//      intentarlo: si no hay nada en ningún idioma, el jugador queda con el palmarés que ya tenía).
//   2. Baja el HTML de cada artículo con la REST API de MediaWiki, con pausas de ~400 ms entre
//      pedidos y caché en disco (si ya está en caché, no vuelve a pedirlo).
//   3. Prioriza a los jugadores jugables y no excluidos, ordenados por fama (así lo más importante
//      queda cubierto primero si hay que cortar a mitad de camino).
//   4. Parsea la sección "Palmarés" con lib/palmares.js.
//   5. Si Wikipedia no da nada para un jugador, se conserva el palmarés que ya tenía (de Wikidata o
//      de una corrida anterior de este mismo script). extras-manual.json (el mismo que usa
//      bajar-extras.mjs) tiene prioridad sobre todo esto: si un jugador está ahí con "palmares",
//      ese valor gana siempre, aunque sea un array vacío.
//
// Wikipedia es CC BY-SA: por eso el pie de página del juego y el README atribuyen también a
// Wikipedia, no solo a Wikidata.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { extraerPalmares } from './lib/palmares.js';

const args = process.argv.slice(2);
const soloManual = args.includes('--solo-manual');
const archivo = args.find((a) => !a.startsWith('--')) || 'data/players.json';

const WIKIDATA = 'https://query.wikidata.org/sparql';
const UA = 'juego-futbolistas-script/0.1 (proyecto personal, uso no comercial)';
const CACHE_DIR = 'cache/palmares-html';
const LOTE_WIKIDATA = 150;
const PAUSA_WIKIPEDIA_MS = 400;
const PAUSA_WIKIDATA_MS = 1000;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function sparql(query, intentos = 4) {
  for (let i = 1; i <= intentos; i++) {
    try {
      const res = await fetch(WIKIDATA, {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ query }),
      });
      if (res.status === 429) {
        const espera = Number(res.headers.get('retry-after') || 30);
        console.log(`  Wikidata pide esperar ${espera}s...`);
        await dormir(espera * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      await dormir(PAUSA_WIKIDATA_MS);
      return json.results.bindings;
    } catch (e) {
      if (i === intentos) {
        if (e instanceof TypeError) console.error('\nNo se pudo conectar con Wikidata. Si estás en una red de trabajo, probá desde otra conexión.');
        throw e;
      }
      console.log(`  reintento ${i}/${intentos - 1} (${e.message}${e.cause?.code ? ' ' + e.cause.code : ''})`);
      await dormir(5000 * i);
    }
  }
}

// Baja el HTML de un artículo de Wikipedia (REST API). Devuelve null si no existe (404) o es una
// página de desambiguación.
async function paginaWikipedia(dominio, titulo, intentos = 4) {
  const url = `https://${dominio}.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(titulo)}`;
  for (let i = 1; i <= intentos; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 404) return null;
      if (res.status === 429) {
        const espera = Number(res.headers.get('retry-after') || 15);
        console.log(`  ${dominio}.wikipedia.org pide esperar ${espera}s...`);
        await dormir(espera * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      // Página de desambiguación: no es el artículo del jugador, tratarla como "no encontrado".
      if (/mw:PageProp\/disambiguation/.test(html)) return null;
      return html;
    } catch (e) {
      if (i === intentos) {
        if (e instanceof TypeError) console.error(`\nNo se pudo conectar con ${dominio}.wikipedia.org.`);
        throw e;
      }
      console.log(`  reintento ${i}/${intentos - 1} (${e.message})`);
      await dormir(3000 * i);
    }
  }
  return null;
}

async function leerJson(ruta, porDefecto) {
  return existsSync(ruta) ? JSON.parse(await readFile(ruta, 'utf8')) : porDefecto;
}

async function conCache(ruta, fn) {
  if (existsSync(ruta)) return readFile(ruta, 'utf8');
  const contenido = await fn();
  if (contenido != null) await writeFile(ruta, contenido);
  return contenido;
}

// ───────────────────────── 1) Cargar datos ─────────────────────────

const jugadores = await leerJson(archivo, null);
if (!Array.isArray(jugadores)) {
  console.error(`No encontré ${archivo}. Uso: node bajar-palmares.mjs data/players.json`);
  process.exit(1);
}
const manual = await leerJson('extras-manual.json', {});

const antes = jugadores.filter((j) => j.palmares?.length).length;

// ───────────────────────── 2) Títulos de Wikipedia (es, con en de respaldo) ─────────────────────────

// id de jugador -> { dominio: 'es'|'en', titulo }
const titulos = new Map();

async function resolverTitulos(ids, dominio) {
  for (let i = 0; i < ids.length; i += LOTE_WIKIDATA) {
    const lote = ids.slice(i, i + LOTE_WIKIDATA);
    console.log(`Títulos en ${dominio}.wikipedia, jugadores ${i + 1}-${i + lote.length} de ${ids.length}...`);
    const filas = await sparql(`
      SELECT ?p ?articulo WHERE {
        VALUES ?p { ${lote.map((id) => `wd:${id}`).join(' ')} }
        ?articulo schema:about ?p ; schema:isPartOf <https://${dominio}.wikipedia.org/> .
      }`);
    for (const f of filas) {
      const id = f.p.value.split('/').pop();
      const titulo = decodeURIComponent(f.articulo.value.split('/wiki/')[1]);
      titulos.set(id, { dominio, titulo });
    }
  }
}

if (!soloManual) {
  const todosLosIds = jugadores.map((j) => j.id);
  await resolverTitulos(todosLosIds, 'es');
  const sinEspanol = todosLosIds.filter((id) => !titulos.has(id));
  if (sinEspanol.length) await resolverTitulos(sinEspanol, 'en');
}

// ───────────────────────── 3) Bajar y parsear, por orden de fama ─────────────────────────

await mkdir(CACHE_DIR, { recursive: true });

const prioridad = jugadores
  .filter((j) => j.jugable && !j.excluir)
  .sort((a, b) => (b.popularidad ?? 0) - (a.popularidad ?? 0));
const resto = jugadores.filter((j) => !(j.jugable && !j.excluir));
const orden = [...prioridad, ...resto];

const encontrados = new Map(); // id -> items[]
let procesados = 0;
let conResultado = 0;

for (const j of orden) {
  if (soloManual) break;
  const destino = titulos.get(j.id);
  if (!destino) continue; // sin artículo en ningún idioma: se deja como estaba

  const rutaCache = `${CACHE_DIR}/${j.id}.html`;
  let html;
  try {
    html = await conCache(rutaCache, async () => {
      const pagina = await paginaWikipedia(destino.dominio, destino.titulo);
      await dormir(PAUSA_WIKIPEDIA_MS);
      return pagina;
    });
  } catch {
    console.log(`  ${j.nombre}: no se pudo bajar, se deja para la próxima corrida.`);
    continue;
  }
  procesados++;
  if (procesados % 25 === 0) console.log(`...${procesados} jugadores revisados (${conResultado} con palmarés nuevo)`);
  if (!html) continue;

  let items;
  try {
    items = extraerPalmares(html);
  } catch (e) {
    console.log(`  ${j.nombre}: no se pudo leer la página (${e.message}), se deja como estaba.`);
    continue;
  }
  if (items.length) {
    encontrados.set(j.id, items);
    conResultado++;
  }
}

// ───────────────────────── 4) Fusionar y guardar ─────────────────────────

for (const j of jugadores) {
  const m = manual[j.id];
  if (m && 'palmares' in m) {
    if (Array.isArray(m.palmares) && m.palmares.length) j.palmares = m.palmares;
    else delete j.palmares;
    continue;
  }
  const nuevo = encontrados.get(j.id);
  if (nuevo?.length) j.palmares = nuevo;
  // si no hay nada nuevo, se deja tal cual estaba (de Wikidata o de una corrida anterior)
}

const copia = `${archivo}.sin-palmares.bak`;
if (!existsSync(copia)) await copyFile(archivo, copia);
await writeFile(archivo, JSON.stringify(jugadores, null, 1));

const despues = jugadores.filter((j) => j.palmares?.length).length;

console.log(`\n──────── Resumen ────────`);
console.log(`Jugadores con palmarés antes:   ${antes} de ${jugadores.length}`);
console.log(`Jugadores con palmarés después: ${despues} de ${jugadores.length}`);
console.log(`Revisados en esta corrida: ${procesados} (${conResultado} con algo nuevo en Wikipedia)`);
if (!soloManual && orden.some((j) => !titulos.has(j.id))) {
  const sinArticulo = orden.filter((j) => !titulos.has(j.id)).length;
  console.log(`Sin artículo en es/en (quedaron con lo que tenían): ${sinArticulo}`);
}

// Resultado para los jugadores que se pidieron revisar a mano.
const nombresAVerificar = [
  'Ubaldo Fillol', 'Diego Armando Maradona', 'Lionel Messi', 'Ángel Di María',
  'Paulo Dybala', 'Roberto Carlos', 'Garrincha', 'Edinson Cavani',
];
const normalizarNombre = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

console.log(`\n──────── Verificación ────────`);
for (const nombre of nombresAVerificar) {
  const clave = normalizarNombre(nombre).split(' ').pop(); // el apellido alcanza para encontrarlo
  const j = jugadores.find(
    (x) => normalizarNombre(x.nombre).includes(clave) || (x.alias ?? []).some((a) => normalizarNombre(a).includes(clave)),
  );
  if (!j) {
    console.log(`${nombre}: no está en ${archivo}`);
    continue;
  }
  console.log(`${j.nombre}:`);
  if (j.palmares?.length) j.palmares.forEach((p) => console.log(`  - ${p}`));
  else console.log('  (sin palmarés)');
}
