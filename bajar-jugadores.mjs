// bajar-jugadores.mjs
// Baja jugadores de fútbol desde Wikidata y genera players.json
// Uso:  node bajar-jugadores.mjs      (requiere Node 18 o más nuevo, sin instalar nada)
//
// Si se corta o falla a la mitad, volvé a ejecutarlo: lo ya descargado queda en ./cache y retoma desde ahí.
// Para empezar de cero, borrá la carpeta ./cache.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// ───────────────────────── CONFIGURACIÓN (tocá acá) ─────────────────────────
const CONFIG = {
  // Qué jugadores bajar. "minSitelinks" = en cuántos idiomas de Wikipedia existe el artículo.
  // Más idiomas = jugador más conocido. Subí el número para tener menos jugadores (más famosos),
  // bajalo para tener más (incluye menos conocidos).
  filtros: [
    { nombre: 'Argentinos', paises: ['Q414'], minSitelinks: 20 },
    {
      nombre: 'Sudamericanos',
      // Uruguay, Brasil, Chile, Colombia, Paraguay, Perú, Ecuador, Bolivia, Venezuela
      paises: ['Q77', 'Q155', 'Q298', 'Q739', 'Q733', 'Q419', 'Q736', 'Q750', 'Q717'],
      minSitelinks: 45,
    },
    { nombre: 'Estrellas mundiales', paises: null, minSitelinks: 80 }, // cualquier nacionalidad
  ],
  // Se consulta por rango de año de nacimiento para que cada consulta sea chica y no se corte por tiempo.
  rangos: [
    [1880, 1950], [1950, 1960], [1960, 1970], [1970, 1980], [1980, 1985],
    [1985, 1990], [1990, 1995], [1995, 2000], [2000, 2005], [2005, 2013],
  ],
  tamanioLote: 60,        // jugadores por consulta de carreras
  pausaMs: 1200,          // pausa entre consultas (cortesía con Wikidata)
  edadRetiroSupuesto: 41, // si tiene un club sin fecha de fin y es mayor a esto, se lo considera retirado
};
// ─────────────────────────────────────────────────────────────────────────────

const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'juego-futbolistas-script/0.1 (proyecto personal, uso no comercial)';
const ANIO_ACTUAL = new Date().getFullYear();

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const qid = (uri) => uri.split('/').pop();
const anio = (s) => {
  if (!s) return null;
  const m = /^(-?\d{4})/.exec(String(s).replace(/^\+/, ''));
  return m ? Number(m[1]) : null;
};

async function sparql(query, intentos = 4) {
  for (let i = 1; i <= intentos; i++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          Accept: 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
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
      await dormir(CONFIG.pausaMs);
      return json.results.bindings;
    } catch (e) {
      const codigo = e.cause?.code ? ` ${e.cause.code}` : '';
      if (i === intentos) {
        if (e instanceof TypeError) e.esRed = true; // falla de conexión, no de la consulta
        throw e;
      }
      console.log(`  reintento ${i}/${intentos - 1} (${e.message}${codigo})`);
      await dormir(5000 * i);
    }
  }
  throw new Error('Wikidata no respondió');
}

async function conCache(nombre, fn) {
  const ruta = `cache/${nombre}.json`;
  if (existsSync(ruta)) return JSON.parse(await readFile(ruta, 'utf8'));
  const datos = await fn();
  await writeFile(ruta, JSON.stringify(datos));
  return datos;
}

// ───────────────────────── Consultas ─────────────────────────
function queryLista(filtro, a, b) {
  const paises = filtro.paises
    ? `VALUES ?pais { ${filtro.paises.map((q) => 'wd:' + q).join(' ')} } ?p wdt:P27 ?pais .`
    : '';
  return `
SELECT ?p ?label ?nac ?sl ?img WHERE {
  ${paises}
  ?p wdt:P106 wd:Q937857 ; wikibase:sitelinks ?sl ; wdt:P569 ?nac .
  FILTER(?sl >= ${filtro.minSitelinks})
  FILTER(YEAR(?nac) >= ${a} && YEAR(?nac) < ${b})
  OPTIONAL { ?p wdt:P18 ?img }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". ?p rdfs:label ?label . }
}`;
}

const valores = (lote) => lote.map((id) => 'wd:' + id).join(' ');

function queryCarrera(lote) {
  return `
SELECT ?p ?st ?team ?teamLabel ?s ?e ?tipo WHERE {
  VALUES ?p { ${valores(lote)} }
  ?p p:P54 ?st . ?st ps:P54 ?team .
  OPTIONAL { ?st pq:P580 ?s }
  OPTIONAL { ?st pq:P582 ?e }
  OPTIONAL { ?team wdt:P31 ?t . ?t rdfs:label ?tipo . FILTER(LANG(?tipo) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
}`;
}

function queryAlias(lote) {
  return `
SELECT ?p ?alias WHERE {
  VALUES ?p { ${valores(lote)} }
  ?p skos:altLabel ?alias .
  FILTER(LANG(?alias) IN ("es", "en"))
}`;
}

// Posición y altura (la ficha del Tribunero las muestra)
function queryExtra(lote) {
  return `
SELECT ?p ?altura ?posLabel WHERE {
  VALUES ?p { ${valores(lote)} }
  OPTIONAL { ?p wdt:P2048 ?altura }
  OPTIONAL { ?p wdt:P413 ?pos }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
}`;
}

// Si una consulta de rango falla (tiempo), la parte en dos y reintenta.
async function pedirLista(filtro, a, b) {
  try {
    return await sparql(queryLista(filtro, a, b));
  } catch (e) {
    if (e.esRed) throw e; // un problema de conexión no se arregla partiendo el rango
    if (b - a <= 1) {
      console.log(`  ! se omite ${a}-${b - 1}: ${e.message}`);
      return [];
    }
    const m = Math.floor((a + b) / 2);
    console.log(`  rango ${a}-${b - 1} falló, lo parto en dos`);
    return [...(await pedirLista(filtro, a, m)), ...(await pedirLista(filtro, m, b))];
  }
}

// ───────────────────────── Clasificación de equipos ─────────────────────────
const RE_JUVENIL = /under-?\s?\d{2}|\bu-?\d{2}\b|youth|reserve|academy|olympic|\bb team\b|second team/i;
const RE_JUV_NOMBRE = /\b(sub-?\s?\d{2}|u-?\d{2}|juvenil(es)?|reserva|cadetes?|infantiles?|ol[ií]mpic[oa])\b/i;
const RE_SELECCION = /national .*team|national team/i;
const RE_SELEC_NOMBRE = /selecci[oó]n|\bnational\b/i;

function categoria(paso) {
  const tipos = [...paso.tipos];
  if (tipos.some((t) => RE_JUVENIL.test(t)) || RE_JUV_NOMBRE.test(paso.equipo)) return 'juvenil';
  if (tipos.some((t) => RE_SELECCION.test(t)) || RE_SELEC_NOMBRE.test(paso.equipo)) return 'seleccion';
  return 'club';
}

const porFecha = (a, b) =>
  (a.desde ?? 9999) - (b.desde ?? 9999) || (a.hasta ?? 9999) - (b.hasta ?? 9999);

function fotoDe(uri) {
  if (!uri) return { foto: null, fotoPagina: null };
  const archivo = decodeURIComponent(uri.split('/').pop());
  return {
    foto: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(archivo)}?width=800`,
    fotoPagina: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(archivo.replace(/ /g, '_'))}`,
  };
}

// Posición general (Arquero / Defensor / Mediocampista / Delantero) a partir de las etiquetas de Wikidata
function posicionGeneral(etiquetas) {
  const t = etiquetas.join(' | ').toLowerCase();
  if (/portero|arquero|goalkeeper/.test(t)) return 'Arquero';
  if (/delantero|forward|striker|winger|extremo/.test(t)) return 'Delantero';
  if (/centrocampista|mediocampista|medio|midfield/.test(t)) return 'Mediocampista';
  if (/defensa|defensor|defender|back|libero|líbero/.test(t)) return 'Defensor';
  return null;
}

// La altura puede venir en metros (1.82) o en centímetros (182): se normaliza a centímetros.
function normalizarAltura(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const cm = n < 3 ? n * 100 : n;
  return cm >= 140 && cm <= 220 ? Math.round(cm) : null;
}

// ───────────────────────── Programa principal ─────────────────────────
// Chequeo inicial: si no hay conexión con Wikidata, lo dice ya mismo y con la causa real.
async function diagnosticar() {
  try {
    const url = `${ENDPOINT}?format=json&query=${encodeURIComponent('ASK{}')}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log('Conexión con Wikidata OK\n');
  } catch (e) {
    const codigo = e.cause?.code ?? e.code ?? '';
    console.error(`\nNo se pudo conectar con Wikidata: ${e.message}${codigo ? ' [' + codigo + ']' : ''}`);
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(codigo)) {
      console.error('Parece una red que inspecciona HTTPS (proxy de empresa o antivirus).');
      console.error('Probá: NODE_EXTRA_CA_CERTS=ruta/al/certificado.pem node bajar-jugadores.mjs');
    } else if (/ENOTFOUND|EAI_AGAIN/.test(codigo)) {
      console.error('Falla el DNS: revisá que tengas internet y que no haya una VPN o filtro bloqueando.');
    } else {
      console.error('Causas comunes (el navegador puede funcionar y Node no):');
      console.error('  1) Estás en una red con proxy (por ejemplo la de la empresa). Node no usa el proxy solo.');
      console.error('     Con Node 22.21 o más nuevo probá: NODE_USE_ENV_PROXY=1 node bajar-jugadores.mjs');
      console.error('     Si no, ejecutalo desde tu casa o con los datos del celular.');
      console.error('  2) Problema con IPv6. Probá: node --dns-result-order=ipv4first bajar-jugadores.mjs');
      console.error('  3) Un antivirus o firewall bloqueando a Node.');
    }
    console.error(`\nTu versión de Node: ${process.version}`);
    process.exit(1);
  }
}

async function main() {
  await diagnosticar();
  await mkdir('cache', { recursive: true });

  // 1) Lista de jugadores
  const jugadores = new Map();
  for (const [fi, f] of CONFIG.filtros.entries()) {
    console.log(`\n[${fi + 1}/${CONFIG.filtros.length}] ${f.nombre} (mínimo ${f.minSitelinks} idiomas)`);
    for (const [a, b] of CONFIG.rangos) {
      const filas = await conCache(`lista_${fi}_${a}_${b}`, () => pedirLista(f, a, b));
      let nuevos = 0;
      for (const r of filas) {
        const id = qid(r.p.value);
        const nombre = r.label?.value ?? id;
        if (jugadores.has(id) || /^Q\d+$/.test(nombre)) continue; // repetido o sin nombre
        jugadores.set(id, {
          id,
          nombre,
          nacimiento: anio(r.nac?.value),
          popularidad: Number(r.sl.value),
          ...fotoDe(r.img?.value),
          origen: f.nombre,
        });
        nuevos++;
      }
      console.log(`  nacidos ${a}-${b - 1}: ${nuevos} jugadores nuevos`);
    }
  }
  console.log(`\nTotal de jugadores en la lista: ${jugadores.size}`);

  // 2) Carreras y alias, por lotes
  const ids = [...jugadores.keys()].sort();
  const carreras = new Map(); // idJugador -> Map(idDeclaracion -> paso)
  const alias = new Map(); // idJugador -> Set
  const extra = new Map(); // idJugador -> { alturas, posiciones }
  for (let i = 0; i < ids.length; i += CONFIG.tamanioLote) {
    const lote = ids.slice(i, i + CONFIG.tamanioLote);
    const clave = `${lote[0]}_${lote.at(-1)}_${lote.length}`;
    console.log(`Carreras y alias: ${Math.min(i + lote.length, ids.length)}/${ids.length}`);

    const filas = await conCache(`carrera_${clave}`, () => sparql(queryCarrera(lote)));
    for (const r of filas) {
      const pid = qid(r.p.value);
      if (!carreras.has(pid)) carreras.set(pid, new Map());
      const mapa = carreras.get(pid);
      let paso = mapa.get(r.st.value);
      if (!paso) {
        paso = {
          equipo: r.teamLabel?.value ?? '',
          desde: anio(r.s?.value),
          hasta: anio(r.e?.value),
          tipos: new Set(),
        };
        mapa.set(r.st.value, paso);
      }
      if (r.tipo) paso.tipos.add(r.tipo.value.toLowerCase());
    }

    const filasAlias = await conCache(`alias_${clave}`, () => sparql(queryAlias(lote)));
    for (const r of filasAlias) {
      const pid = qid(r.p.value);
      if (!alias.has(pid)) alias.set(pid, new Set());
      alias.get(pid).add(r.alias.value);
    }

    const filasExtra = await conCache(`extra_${clave}`, () => sparql(queryExtra(lote)));
    for (const r of filasExtra) {
      const pid = qid(r.p.value);
      if (!extra.has(pid)) extra.set(pid, { alturas: [], posiciones: new Set() });
      const e = extra.get(pid);
      if (r.altura) e.alturas.push(normalizarAltura(r.altura.value));
      if (r.posLabel) e.posiciones.add(r.posLabel.value);
    }
  }

  // 3) Armar cada jugador
  function armar(j) {
    const pasos = [...(carreras.get(j.id)?.values() ?? [])];
    const clubes = pasos.filter((p) => categoria(p) === 'club').sort(porFecha);
    const selecs = pasos.filter((p) => categoria(p) === 'seleccion').sort(porFecha);

    const conInicio = clubes.filter((p) => p.desde != null);
    const debut = conInicio.length ? Math.min(...conInicio.map((p) => p.desde)) : null;
    const edad = j.nacimiento ? ANIO_ACTUAL - j.nacimiento : null;
    const haySinFin = clubes.some((p) => p.hasta == null);
    const activo = haySinFin && edad != null && edad < CONFIG.edadRetiroSupuesto;
    const fines = clubes.map((p) => p.hasta).filter((x) => x != null);
    const retiro = activo ? null : fines.length ? Math.max(...fines) : null;
    // Si está retirado pero algún club no tiene fecha de fin, el año de retiro puede ser incorrecto:
    // el juego no debería usarlo como pista.
    const retiroIncompleto = !activo && haySinFin;
    const selecConInicio = selecs.filter((p) => p.desde != null);
    const ex = extra.get(j.id);
    const alturaCm = ex ? (ex.alturas.find((x) => x != null) ?? null) : null;
    const posiciones = ex ? [...ex.posiciones] : [];

    return {
      id: j.id,
      nombre: j.nombre,
      alias: [...(alias.get(j.id) ?? [])].filter((a) => a !== j.nombre).slice(0, 8),
      nacimiento: j.nacimiento,
      popularidad: j.popularidad,
      origen: j.origen,
      foto: j.foto,
      fotoPagina: j.fotoPagina,
      posicion: posicionGeneral(posiciones),
      posiciones,
      alturaCm,
      debut,
      retiro,
      activo,
      retiroIncompleto,
      debutSeleccion: selecConInicio.length ? Math.min(...selecConInicio.map((p) => p.desde)) : null,
      carrera: clubes.map((p) => ({ club: p.equipo, desde: p.desde, hasta: p.hasta })),
      selecciones: selecs.map((p) => ({ equipo: p.equipo, desde: p.desde, hasta: p.hasta })),
      jugable: conInicio.length >= 2 && debut != null,
    };
  }

  const salida = [...jugadores.values()].map(armar).sort((a, b) => b.popularidad - a.popularidad);
  await writeFile('players.json', JSON.stringify(salida, null, 1));

  // 4) Resumen
  const jugables = salida.filter((j) => j.jugable);
  console.log('\n──────── Resumen ────────');
  console.log(`Jugadores en players.json:        ${salida.length}`);
  console.log(`Jugables (2+ clubes con año):      ${jugables.length}`);
  console.log(`Con foto:                          ${salida.filter((j) => j.foto).length}`);
  console.log(`Con año de retiro confiable:       ${jugables.filter((j) => j.retiro != null && !j.retiroIncompleto).length}`);
  console.log(`Activos:                           ${jugables.filter((j) => j.activo).length}`);
  console.log(`Con posición:                      ${jugables.filter((j) => j.posicion).length}`);
  console.log(`Con altura:                        ${jugables.filter((j) => j.alturaCm).length}`);
  for (const f of CONFIG.filtros) {
    console.log(`  ${f.nombre}: ${jugables.filter((j) => j.origen === f.nombre).length} jugables`);
  }
  console.log('\nListo. El archivo es players.json');
}

main().catch((e) => {
  console.error('\nError:', e.message);
  console.error('Volvé a ejecutar el script: retoma desde la carpeta cache.');
  process.exit(1);
});
