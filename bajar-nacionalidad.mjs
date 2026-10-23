// bajar-nacionalidad.mjs
// Agrega la nacionalidad (código de país + nombre) a cada jugador de un players.json, usando Wikidata (P27).
//
// Uso:  node bajar-nacionalidad.mjs data/players.json
//       (requiere Node 18 o más nuevo; no instala nada; son ~7 consultas)
//       node bajar-nacionalidad.mjs data/players.json --solo-manual   (sin internet: solo aplica las correcciones manuales)
//
// Escribe el mismo archivo con el campo "nacionalidad": { "codigo": "ar", "nombre": "Argentina" }
// y guarda una copia de seguridad en <archivo>.sin-nacionalidad.bak la primera vez.
// También guarda nacionalidades.json: si más tarde volvés a correr limpiar-datos.mjs, lo vuelve a aplicar solo.
//
// Los jugadores que quedan sin bandera se listan al final. Para arreglarlos, creá nacionalidades-manual.json:
//   { "Q12345": ["rs", "Serbia"], "Q67890": ["xk", "Kosovo"] }
// y volvé a correr este mismo comando.

import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { elegirNacionalidad } from './lib/nacionalidad.js';

const args = process.argv.slice(2);
const soloManual = args.includes('--solo-manual'); // no consulta Wikidata: solo aplica nacionalidades-manual.json
const archivo = args.find((a) => !a.startsWith('--')) || 'data/players.json';
const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'juego-futbolistas-script/0.1 (proyecto personal, uso no comercial)';
const LOTE = 120;
const PAUSA_MS = 1200;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function sparql(query, intentos = 4) {
  for (let i = 1; i <= intentos; i++) {
    try {
      const res = await fetch(ENDPOINT, {
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
      await dormir(PAUSA_MS);
      return json.results.bindings;
    } catch (e) {
      if (i === intentos) {
        if (e instanceof TypeError) {
          console.error('\nNo se pudo conectar con Wikidata. Si estás en una red de trabajo, probá desde otra conexión.');
        }
        throw e;
      }
      console.log(`  reintento ${i}/${intentos - 1} (${e.message}${e.cause?.code ? ' ' + e.cause.code : ''})`);
      await dormir(5000 * i);
    }
  }
}

async function leerJson(ruta, porDefecto) {
  return existsSync(ruta) ? JSON.parse(await readFile(ruta, 'utf8')) : porDefecto;
}

const jugadores = await leerJson(archivo, null);
if (!Array.isArray(jugadores)) {
  console.error(`No encontré ${archivo}. Uso: node bajar-nacionalidad.mjs data/players.json`);
  process.exit(1);
}
const manual = await leerJson('nacionalidades-manual.json', {});

// id de jugador -> [{ codigo, nombre }]
const candidatos = new Map();
const ids = jugadores.map((j) => j.id);
for (let i = 0; !soloManual && i < ids.length; i += LOTE) {
  const lote = ids.slice(i, i + LOTE);
  console.log(`Ciudadanías ${i + 1}-${i + lote.length} de ${ids.length}...`);
  const filas = await sparql(`
    SELECT ?p ?pais ?paisLabel ?iso WHERE {
      VALUES ?p { ${lote.map((id) => `wd:${id}`).join(' ')} }
      ?p wdt:P27 ?pais .
      OPTIONAL { ?pais wdt:P297 ?iso . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
    }`);
  for (const f of filas) {
    const id = f.p.value.split('/').pop();
    const lista = candidatos.get(id) ?? [];
    if (!lista.some((c) => c.nombre === f.paisLabel?.value)) {
      lista.push({ codigo: f.iso?.value ?? null, nombre: f.paisLabel?.value ?? '' });
    }
    candidatos.set(id, lista);
  }
}

const mapa = {};
const sinBandera = [];
const sinArchivoDeBandera = new Set();
const hayBanderas = existsSync('public/banderas');
for (const j of jugadores) {
  const n = soloManual && !manual[j.id] ? j.nacionalidad : elegirNacionalidad(candidatos.get(j.id) ?? [], j, manual);
  if (!n) {
    delete j.nacionalidad;
    const vistas = (candidatos.get(j.id) ?? []).map((c) => c.nombre).join(', ');
    sinBandera.push(`${j.nombre} (${j.id})${vistas ? ` — Wikidata dice: ${vistas}` : ''}`);
    continue;
  }
  j.nacionalidad = n;
  mapa[j.id] = n;
  if (hayBanderas && !existsSync(`public/banderas/${n.codigo}.svg`)) sinArchivoDeBandera.add(`${n.codigo} (${n.nombre})`);
}

const copia = `${archivo}.sin-nacionalidad.bak`;
if (!existsSync(copia)) await copyFile(archivo, copia);
await writeFile(archivo, JSON.stringify(jugadores, null, 1));
await writeFile('nacionalidades.json', JSON.stringify(mapa, null, 1));

const conteo = {};
for (const n of Object.values(mapa)) conteo[n.nombre] = (conteo[n.nombre] ?? 0) + 1;
const top = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `${n} ${c}`).join(' | ');
console.log(`\nListo: ${Object.keys(mapa).length} de ${jugadores.length} jugadores con nacionalidad.`);
console.log(`Más frecuentes: ${top}`);
if (sinBandera.length) {
  console.log(`\nSin nacionalidad (${sinBandera.length}). Completalos en nacionalidades-manual.json si querés:`);
  for (const s of sinBandera) console.log('  ' + s);
}
if (sinArchivoDeBandera.size) console.log(`\nSin archivo de bandera en public/banderas: ${[...sinArchivoDeBandera].join(', ')}`);
