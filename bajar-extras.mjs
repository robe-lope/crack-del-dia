// bajar-extras.mjs
// Agrega apodo, palmarés, lugar de nacimiento y dorsal a cada jugador de un players.json, usando Wikidata.
//
// Uso:  node bajar-extras.mjs data/players.json
//       (requiere Node 18 o más nuevo; no instala nada; son unas 5 consultas por lote de 120 jugadores)
//       node bajar-extras.mjs data/players.json --solo-manual   (sin internet: solo aplica extras-manual.json)
//
// Escribe en el mismo archivo los campos "apodo", "palmares", "lugarNacimiento" y "dorsal" (los que
// se consigan) y guarda una copia de seguridad en <archivo>.sin-extras.bak la primera vez.
//
// De Wikidata, con etiqueta en español y, si no hay, en inglés:
//   - apodo:           P1449 (también conocido como)
//   - palmares:        P166 (premio recibido) + los Mundiales en los que jugó (P1344), marcando
//                       "Campeón" si el ganador de esa edición (P1346) coincide con su selección
//   - lugarNacimiento: P19 (lugar de nacimiento), como "Ciudad, País"
//   - dorsal:          P1618 (número de camiseta)
//
// "curiosidades" NO se baja de Wikidata: es un dato de color (un gol épico, una anécdota) que se
// carga a mano en extras-manual.json, igual que nacionalidades-manual.json:
//   { "Q615": { "curiosidades": ["Metió un gol de arco a arco en un Mundial."] } }
// Ese mismo archivo también corrige a mano cualquiera de los otros campos (mismo formato:
// { "Qid": { "apodo": "...", "dorsal": 10 } }); lo que esté ahí gana siempre, incluso un string
// vacío (así se puede "borrar" lo que trajo Wikidata para un jugador puntual).
//
// Los que queden sin alguno de los campos se listan al final.

import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { armarExtras } from './lib/extras.js';

const args = process.argv.slice(2);
const soloManual = args.includes('--solo-manual'); // no consulta Wikidata: solo aplica extras-manual.json
const archivo = args.find((a) => !a.startsWith('--')) || 'data/players.json';
const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'juego-futbolistas-script/0.1 (proyecto personal, uso no comercial)';
const LOTE = 120;
const PAUSA_MS = 1200;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const qid = (uri) => uri.split('/').pop();

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
  console.error(`No encontré ${archivo}. Uso: node bajar-extras.mjs data/players.json`);
  process.exit(1);
}
const manual = await leerJson('extras-manual.json', {});

// id de jugador -> { apodos, premios, ciudadNacimiento, paisNacimiento, dorsales, mundiales }
const bajado = new Map();
const vacio = () => ({ apodos: [], premios: [], ciudadNacimiento: null, paisNacimiento: null, dorsales: [], mundiales: [] });
const de = (id) => {
  if (!bajado.has(id)) bajado.set(id, vacio());
  return bajado.get(id);
};

const ids = jugadores.map((j) => j.id);
for (let i = 0; !soloManual && i < ids.length; i += LOTE) {
  const lote = ids.slice(i, i + LOTE);
  const valores = lote.map((id) => `wd:${id}`).join(' ');
  console.log(`Pistas extra ${i + 1}-${i + lote.length} de ${ids.length}...`);

  const filasApodo = await sparql(`
    SELECT ?p ?apodo WHERE {
      VALUES ?p { ${valores} }
      ?p wdt:P1449 ?apodo .
      FILTER(LANG(?apodo) IN ("es", "en"))
    }`);
  for (const f of filasApodo) {
    de(qid(f.p.value)).apodos.push({ idioma: f.apodo['xml:lang'], valor: f.apodo.value });
  }

  const filasPremio = await sparql(`
    SELECT ?p ?premioLabel WHERE {
      VALUES ?p { ${valores} }
      ?p wdt:P166 ?premio .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
    }`);
  for (const f of filasPremio) {
    if (f.premioLabel?.value) de(qid(f.p.value)).premios.push(f.premioLabel.value);
  }

  const filasNacimiento = await sparql(`
    SELECT ?p ?ciudadLabel ?paisLabel WHERE {
      VALUES ?p { ${valores} }
      ?p wdt:P19 ?ciudad .
      OPTIONAL { ?ciudad wdt:P17 ?pais . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
    }`);
  for (const f of filasNacimiento) {
    const e = de(qid(f.p.value));
    e.ciudadNacimiento ??= f.ciudadLabel?.value ?? null;
    e.paisNacimiento ??= f.paisLabel?.value ?? null;
  }

  const filasDorsal = await sparql(`
    SELECT ?p ?dorsal WHERE {
      VALUES ?p { ${valores} }
      ?p wdt:P1618 ?dorsal .
    }`);
  for (const f of filasDorsal) de(qid(f.p.value)).dorsales.push(f.dorsal.value);

  // Mundiales en los que participó (P1344, filtrando por "instancia de" Copa Mundial de Fútbol, Q19317),
  // con el ganador de esa edición (P1346) para poder marcar "Campeón" si coincide con su selección.
  const filasMundial = await sparql(`
    SELECT ?p ?eventoLabel ?inicio ?ganadorLabel WHERE {
      VALUES ?p { ${valores} }
      ?p wdt:P1344 ?evento .
      ?evento wdt:P31/wdt:P279* wd:Q19317 .
      OPTIONAL { ?evento wdt:P580 ?inicio . }
      OPTIONAL { ?evento wdt:P1346 ?ganador . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
    }`);
  for (const f of filasMundial) {
    const etiqueta = f.eventoLabel?.value ?? '';
    const anioEtiqueta = /(\d{4})/.exec(etiqueta)?.[1];
    const anio = anioEtiqueta ? Number(anioEtiqueta) : f.inicio?.value ? Number(f.inicio.value.slice(0, 4)) : null;
    de(qid(f.p.value)).mundiales.push({ anio, ganador: f.ganadorLabel?.value ?? null });
  }
}

const CAMPOS = ['apodo', 'palmares', 'lugarNacimiento', 'dorsal'];
const faltan = Object.fromEntries(CAMPOS.map((c) => [c, []]));
for (const j of jugadores) {
  const extras = armarExtras(j, bajado.get(j.id), manual);
  for (const campo of CAMPOS) {
    if (campo in extras) j[campo] = extras[campo];
    else delete j[campo];
  }
  if (Array.isArray(extras.curiosidades) && extras.curiosidades.length) j.curiosidades = extras.curiosidades;
  for (const campo of CAMPOS) if (!(campo in extras)) faltan[campo].push(`${j.nombre} (${j.id})`);
}

const copia = `${archivo}.sin-extras.bak`;
if (!existsSync(copia)) await copyFile(archivo, copia);
await writeFile(archivo, JSON.stringify(jugadores, null, 1));

console.log(`\n──────── Resumen (${jugadores.length} jugadores) ────────`);
for (const campo of CAMPOS) {
  console.log(`${campo.padEnd(16)} ${jugadores.length - faltan[campo].length} de ${jugadores.length}`);
}
for (const campo of CAMPOS) {
  const lista = faltan[campo];
  if (!lista.length) continue;
  console.log(`\nSin ${campo} (${lista.length}). Completalos en extras-manual.json si querés:`);
  for (const s of lista.slice(0, 20)) console.log('  ' + s);
  if (lista.length > 20) console.log(`  ... y ${lista.length - 20} más.`);
}
