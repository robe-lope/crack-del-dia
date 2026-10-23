// bajar-argentina.mjs
// Marca qué jugadores de un players.json pasaron por un club argentino (jugaron en el fútbol de Argentina),
// usando el país de cada club en Wikidata. Agrega a cada jugador:
//   "jugoEnArgentina": true | false
//   "clubesArgentinos": ["Boca Juniors", "River Plate"]   (solo si jugó en alguno)
//
// Uso:  node bajar-argentina.mjs data/players.json
//       node bajar-argentina.mjs data/players.json --solo-manual     (sin internet: solo aplica argentina-manual.json)
// Requiere Node 18 o más nuevo; no instala nada. Son ~7 consultas.
//
// Qué cuenta como "jugó en Argentina":
//   - un paso por un club cuyo país (o cuya liga) es Argentina en Wikidata;
//   - sin contar selecciones, juveniles, reservas ni filiales;
//   - sin contar pasos que empezaron antes de los 15 años (inferiores: Messi en Newell's no cuenta);
//   - un paso sin ninguna fecha solo cuenta si ese club figura también en la carrera del jugador (ya limpia).
//
// Correcciones a mano (opcional): argentina-manual.json
//   { "Q615": true, "Q12345": false }     // true = jugó en Argentina, false = no
// y volvé a correr el comando.
//
// La primera vez guarda una copia de seguridad: <archivo>.sin-argentina.bak

import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const soloManual = args.includes('--solo-manual');
const archivo = args.find((a) => !a.startsWith('--')) || 'data/players.json';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'juego-futbolistas-script/0.1 (proyecto personal, uso no comercial)';
const LOTE = 100;
const PAUSA_MS = 1200;
const EDAD_MINIMA = 15; // mismo criterio que limpiar-datos.mjs

// Nombres que NO son un club de primera: selecciones, juveniles, reservas y filiales.
const RE_NO_CLUB =
  /\bselecci[oó]n\b|national team|\bol[ií]mpic|olympic|\bsub[- ]?\d{2}\b|\bU[- ]?\d{2}\b|\breserva(s)?\b|\bdivisiones inferiores\b|\binferiores\b|\bjuveniles?\b|\byouth\b|\bacademy\b|\bprimavera\b|\breserves?\b|(\s["“]?(B|C|II|III)["”]?)$/i;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (t) =>
  String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const anio = (s) => {
  const m = /^(-?\d{4})/.exec(String(s ?? '').replace(/^\+/, ''));
  return m ? Number(m[1]) : null;
};

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
        if (e instanceof TypeError) console.error('\nNo se pudo conectar con Wikidata. Si estás en una red de trabajo, probá desde otra conexión.');
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
  console.error(`No encontré ${archivo}. Uso: node bajar-argentina.mjs data/players.json`);
  process.exit(1);
}
const manual = await leerJson('argentina-manual.json', {});

// id de jugador -> [{ club, inicio, fin }]  (pasos por clubes argentinos, tal como los devuelve Wikidata)
const pasos = new Map();
for (let i = 0; !soloManual && i < jugadores.length; i += LOTE) {
  const lote = jugadores.slice(i, i + LOTE).map((j) => j.id);
  console.log(`Clubes argentinos, jugadores ${i + 1}-${i + lote.length} de ${jugadores.length}...`);
  const filas = await sparql(`
    SELECT ?p ?club ?clubLabel ?inicio ?fin WHERE {
      VALUES ?p { ${lote.map((id) => `wd:${id}`).join(' ')} }
      ?p p:P54 ?paso .
      ?paso ps:P54 ?club .
      { ?club wdt:P17 wd:Q414 } UNION { ?club wdt:P118 ?liga . ?liga wdt:P17 wd:Q414 }
      FILTER NOT EXISTS { ?club wdt:P31 wd:Q6979593 }
      OPTIONAL { ?paso pq:P580 ?inicio }
      OPTIONAL { ?paso pq:P582 ?fin }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
    }`);
  for (const f of filas) {
    const id = f.p.value.split('/').pop();
    const lista = pasos.get(id) ?? [];
    lista.push({ club: f.clubLabel?.value ?? '', inicio: anio(f.inicio?.value), fin: anio(f.fin?.value) });
    pasos.set(id, lista);
  }
}

// ¿El club de Wikidata ("Club Atlético Boca Juniors") es alguno de la carrera ya limpia ("Boca Juniors")?
function figuraEnLaCarrera(clubWikidata, jugador) {
  const w = norm(clubWikidata);
  return (jugador.carrera ?? []).some((c) => {
    const n = norm(c.club);
    return n.length >= 3 && (w.includes(n) || n.includes(w));
  });
}

// Decide si un paso por un club argentino cuenta como "jugó en Argentina".
function cuenta(paso, jugador) {
  if (!paso.club || RE_NO_CLUB.test(paso.club)) return false;
  const nac = jugador.nacimiento;
  if (paso.inicio != null && nac && paso.inicio - nac < EDAD_MINIMA) return false; // inferiores
  if (paso.inicio == null && paso.fin != null && nac && paso.fin - nac < EDAD_MINIMA) return false;
  if (paso.inicio == null && paso.fin == null) return figuraEnLaCarrera(paso.club, jugador);
  return true;
}

const resultado = {};
const dudosos = [];
for (const j of jugadores) {
  if (typeof manual[j.id] === 'boolean') {
    j.jugoEnArgentina = manual[j.id];
    if (!manual[j.id]) delete j.clubesArgentinos;
    else j.clubesArgentinos ??= [];
    resultado[j.id] = { jugoEnArgentina: j.jugoEnArgentina, clubesArgentinos: j.clubesArgentinos ?? [] };
    continue;
  }
  if (soloManual) {
    if (typeof j.jugoEnArgentina === 'boolean') resultado[j.id] = { jugoEnArgentina: j.jugoEnArgentina, clubesArgentinos: j.clubesArgentinos ?? [] };
    continue;
  }
  const contados = (pasos.get(j.id) ?? []).filter((p) => cuenta(p, j));
  const clubes = [...new Set(contados.map((p) => p.club))];
  j.jugoEnArgentina = clubes.length > 0;
  if (clubes.length) j.clubesArgentinos = clubes;
  else delete j.clubesArgentinos;
  resultado[j.id] = { jugoEnArgentina: j.jugoEnArgentina, clubesArgentinos: clubes };
  // Pasos que Wikidata ubica en Argentina pero descartamos por ser de inferiores: se listan por si algo no cierra.
  const descartados = (pasos.get(j.id) ?? []).filter((p) => !cuenta(p, j) && p.club && !RE_NO_CLUB.test(p.club));
  if (!clubes.length && descartados.length) dudosos.push(`${j.nombre} (${j.id}): ${[...new Set(descartados.map((p) => p.club))].join(', ')}`);
}

const copia = `${archivo}.sin-argentina.bak`;
if (!existsSync(copia)) await copyFile(archivo, copia);
await writeFile(archivo, JSON.stringify(jugadores, null, 1));
await writeFile('argentina.json', JSON.stringify(resultado, null, 1));

const si = jugadores.filter((j) => j.jugoEnArgentina);
const jugables = jugadores.filter((j) => j.jugable && !j.excluir);
const esArg = (j) => j.origen === 'Argentinos' || j.nacionalidad?.codigo === 'ar';
const juegoDiario = jugables.filter((j) => esArg(j) || j.jugoEnArgentina);
console.log(`\nListo: ${si.length} de ${jugadores.length} jugadores pasaron por un club argentino.`);
console.log(`Argentinos que jugaron en Argentina: ${si.filter(esArg).length} | de otros países: ${si.filter((j) => !esArg(j)).length}`);
console.log(`Jugadores para el diario (argentinos + los que pasaron por Argentina): ${juegoDiario.length} de ${jugables.length} jugables.`);

const otros = si.filter((j) => !esArg(j)).sort((a, b) => (b.popularidad ?? 0) - (a.popularidad ?? 0)).slice(0, 25);
console.log(`\nDe otros países que pasaron por Argentina (los más famosos; revisá que tengan sentido):`);
for (const j of otros) console.log(`  ${j.nombre} — ${(j.clubesArgentinos ?? []).join(', ')}`);

const argSin = jugables.filter((j) => esArg(j) && !j.jugoEnArgentina).sort((a, b) => (b.popularidad ?? 0) - (a.popularidad ?? 0));
console.log(`\nArgentinos que NO figuran como jugadores en Argentina (${argSin.length}; sirve para chequear, ej. Messi):`);
for (const j of argSin.slice(0, 25)) console.log(`  ${j.nombre}`);
if (dudosos.length) {
  console.log(`\nSolo con pasos de inferiores/sin fecha en clubes argentinos (${dudosos.length}). Si alguno debería contar, ponelo en argentina-manual.json:`);
  for (const d of dudosos.slice(0, 40)) console.log('  ' + d);
}
