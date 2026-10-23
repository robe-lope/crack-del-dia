// Pool del diario (argentinos o jugoEnArgentina) y checkbox de práctica ("Pasaron por Argentina"),
// con una lista de jugadores inventada (sin red, sin tocar data/players.json).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const PUERTO = 3197;
const BASE = `http://localhost:${PUERTO}`;
const dir = mkdtempSync(join(tmpdir(), 'crack-argentina-'));

// Piso de fama por defecto (lib/datos.js): Argentinos 35, Sudamericanos 55, Estrellas mundiales 80.
const BASICAS = { posicion: 'Delantero', alturaCm: 180, debut: 2000, retiro: 2018 };
const carrera = (...clubes) => clubes.map((club, i) => ({ club, desde: 2000 + i * 2, hasta: 2002 + i * 2 }));

const jugadores = [
  // Argentino que nunca jugó en Argentina (como Messi): elegible en el diario, no en el checkbox.
  {
    id: 'Q_MESSI',
    nombre: 'Messi de Prueba',
    alias: [],
    ...BASICAS,
    popularidad: 90,
    origen: 'Argentinos',
    nacionalidad: { codigo: 'ar', nombre: 'Argentina' },
    jugoEnArgentina: false,
    carrera: carrera('Club Europeo A', 'Club Europeo B'),
    jugable: true,
  },
  // Argentino que sí jugó acá: elegible en ambos lados.
  {
    id: 'Q_AR2',
    nombre: 'Argentino Con Argentina',
    alias: [],
    ...BASICAS,
    popularidad: 40,
    origen: 'Argentinos',
    nacionalidad: { codigo: 'ar', nombre: 'Argentina' },
    jugoEnArgentina: true,
    clubesArgentinos: ['Club Argentino X'],
    carrera: carrera('Club Argentino X'),
    jugable: true,
  },
  // Uruguayo que jugó en Argentina y supera el piso de Sudamericanos (55): elegible en el diario.
  {
    id: 'Q_UY_OK',
    nombre: 'Uruguayo Con Piso',
    alias: [],
    ...BASICAS,
    popularidad: 60,
    origen: 'Sudamericanos',
    nacionalidad: { codigo: 'uy', nombre: 'Uruguay' },
    jugoEnArgentina: true,
    clubesArgentinos: ['Club Argentino Y'],
    carrera: carrera('Club Argentino Y'),
    jugable: true,
  },
  // Uruguayo que jugó en Argentina pero NO supera el piso: afuera del diario, adentro de la práctica.
  {
    id: 'Q_UY_LOW',
    nombre: 'Uruguayo Sin Piso',
    alias: [],
    ...BASICAS,
    popularidad: 40,
    origen: 'Sudamericanos',
    nacionalidad: { codigo: 'uy', nombre: 'Uruguay' },
    jugoEnArgentina: true,
    clubesArgentinos: ['Club Argentino Z'],
    carrera: carrera('Club Argentino Z'),
    jugable: true,
  },
  // Uruguayo que supera el piso pero NUNCA jugó en Argentina: afuera del diario (a pesar del piso).
  {
    id: 'Q_UY_NO',
    nombre: 'Uruguayo Sin Argentina',
    alias: [],
    ...BASICAS,
    popularidad: 70,
    origen: 'Sudamericanos',
    nacionalidad: { codigo: 'uy', nombre: 'Uruguay' },
    jugoEnArgentina: false,
    carrera: carrera('Club Europeo C'),
    jugable: true,
  },
  // Estrella mundial (piso 80) que jugó en Argentina y lo supera: elegible en el diario.
  // Nacionalidad fuera de Europa y Sudamérica a propósito: así el grupo "europa" + el checkbox
  // queda sin nadie (ver el test de combinación vacía).
  {
    id: 'Q_WORLD_OK',
    nombre: 'Estrella Con Argentina',
    alias: [],
    ...BASICAS,
    popularidad: 85,
    origen: 'Estrellas mundiales',
    nacionalidad: { codigo: 'jp', nombre: 'Japón' },
    jugoEnArgentina: true,
    clubesArgentinos: ['Club Argentino W'],
    carrera: carrera('Club Argentino W'),
    jugable: true,
  },
  // Estrella mundial muy famosa (como Cristiano Ronaldo) que NUNCA jugó en Argentina: afuera del
  // diario a pesar de la fama, y afuera de la práctica con el checkbox.
  {
    id: 'Q_WORLD_NO',
    nombre: 'Estrella Sin Argentina',
    alias: [],
    ...BASICAS,
    popularidad: 95,
    origen: 'Estrellas mundiales',
    nacionalidad: { codigo: 'pt', nombre: 'Portugal' },
    jugoEnArgentina: false,
    carrera: carrera('Club Europeo D', 'Club Europeo E'),
    jugable: true,
  },
];

const archivo = join(dir, 'players.json');
writeFileSync(archivo, JSON.stringify(jugadores));

const entorno = {
  ...process.env,
  PORT: String(PUERTO),
  PLAYERS_FILE: archivo,
  TURSO_DATABASE_URL: `file:${join(dir, 'prueba.db')}`,
  SEMILLA: 'semilla-de-prueba',
  FECHA_INICIO: '2026-10-22',
};
Object.assign(process.env, { PLAYERS_FILE: archivo, SEMILLA: entorno.SEMILLA, FECHA_INICIO: entorno.FECHA_INICIO });

const { datos } = await import('../lib/datos.js');

const T1 = 'aaaaaaaa-1111-4aaa-8aaa-111111111111';
const T2 = 'bbbbbbbb-2222-4bbb-8bbb-222222222222';
let servidor;

async function api(ruta, { token, cuerpo } = {}) {
  const r = await fetch(`${BASE}${ruta}`, {
    method: cuerpo ? 'POST' : 'GET',
    headers: { ...(token ? { 'X-Token': token } : {}), ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, datos: await r.json() };
}

before(async () => {
  servidor = spawn('node', ['dev-server.mjs'], { env: entorno, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((ok, mal) => {
    servidor.stdout.on('data', (d) => String(d).includes('Listo') && ok());
    servidor.on('exit', (c) => mal(new Error(`el servidor se cerró (${c})`)));
  });
});

after(async () => {
  if (servidor && servidor.exitCode === null) {
    const cerrado = new Promise((ok) => servidor.once('exit', ok));
    servidor.kill();
    await Promise.race([cerrado, new Promise((ok) => setTimeout(ok, 3000))]);
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* carpeta temporal: el sistema la limpia solo */
  }
});

// ───────────── Pool del diario (lib/datos.js) ─────────────

test('el pool del diario: argentinos (jugaron o no en el país) + no-argentinos que jugaron y superan su piso', () => {
  const ids = datos().elegibles.map((j) => j.id).sort();
  assert.deepEqual(ids, ['Q_AR2', 'Q_MESSI', 'Q_UY_OK', 'Q_WORLD_OK'].sort());
});

test('Messi: argentino sin haber jugado en Argentina, elegible igual en el diario', () => {
  assert.ok(datos().elegibles.some((j) => j.id === 'Q_MESSI'));
});

test('un uruguayo que jugó en Argentina y supera el piso de su origen es elegible en el diario', () => {
  assert.ok(datos().elegibles.some((j) => j.id === 'Q_UY_OK'));
});

test('un uruguayo que jugó en Argentina pero no supera el piso de Sudamericanos queda afuera del diario', () => {
  assert.ok(!datos().elegibles.some((j) => j.id === 'Q_UY_LOW'));
});

test('un uruguayo que supera el piso pero nunca jugó en Argentina queda afuera del diario', () => {
  assert.ok(!datos().elegibles.some((j) => j.id === 'Q_UY_NO'));
});

test('una estrella mundial muy famosa que nunca jugó en Argentina queda afuera del diario, aunque supere su piso', () => {
  assert.ok(!datos().elegibles.some((j) => j.id === 'Q_WORLD_NO'));
});

// ───────────── Checkbox de práctica ─────────────

// Pierde a propósito (3 intentos con ids distintos, ajenos al pool) para poder leer quién era.
async function jugadorDePractica(token, partida, idsAjenos) {
  let v;
  for (const id of idsAjenos) v = (await api('/api/practica/adivinar', { token, cuerpo: { partida, id } })).datos;
  return v.resultado.nombre;
}

test('Messi es elegible en el diario pero NO sale en práctica con el checkbox "Pasaron por Argentina"', async () => {
  const sinCheckbox = await api('/api/practica/estado', { token: T1 });
  assert.equal(sinCheckbox.datos.grupos.find((g) => g.id === 'argentina').cantidad, 2, 'Q_MESSI y Q_AR2 son argentinos');

  const conCheckbox = await api('/api/practica/estado?argentina=1', { token: T1 });
  assert.equal(conCheckbox.datos.grupos.find((g) => g.id === 'argentina').cantidad, 1, 'con el checkbox solo queda Q_AR2');

  // Con el checkbox, el grupo "argentina" queda con un solo jugador (Q_AR2): nunca puede salir Messi.
  const ajenos = ['Q_MESSI', 'Q_UY_OK', 'Q_WORLD_NO']; // ninguno es Q_AR2
  for (let i = 0; i < 5; i++) {
    const r = await api('/api/practica/nueva', { token: T1, cuerpo: { grupo: 'argentina', dificultad: 'todas', argentina: true } });
    assert.equal(r.status, 200);
    const nombre = await jugadorDePractica(T1, r.datos.partida, ajenos);
    assert.equal(nombre, 'Argentino Con Argentina');
  }
});

test('un uruguayo con jugoEnArgentina sale en práctica con el checkbox, sin el piso del diario', async () => {
  // El pool con checkbox en "sudamerica" es {Q_UY_OK, Q_UY_LOW}: Q_UY_NO (nunca jugó acá) no entra,
  // y ninguno de los dos necesita superar el piso de fama del diario (Q_UY_LOW está por debajo).
  const ajenos = ['Q_MESSI', 'Q_AR2', 'Q_WORLD_NO']; // ninguno es Q_UY_OK ni Q_UY_LOW
  const vistos = new Set();
  for (let i = 0; i < 10; i++) {
    const r = await api('/api/practica/nueva', { token: T1, cuerpo: { grupo: 'sudamerica', dificultad: 'todas', argentina: true } });
    assert.equal(r.status, 200);
    vistos.add(await jugadorDePractica(T1, r.datos.partida, ajenos));
  }
  // No se repite ninguno hasta jugarlos a todos (lib/practica.js): con 10 vueltas sobre un pool
  // de 2, tienen que haber salido los dos.
  assert.ok(vistos.has('Uruguayo Con Piso'), 'el que supera el piso tiene que poder salir');
  assert.ok(vistos.has('Uruguayo Sin Piso'), 'el que no supera el piso del diario igual sale en práctica');
  assert.ok(!vistos.has('Uruguayo Sin Argentina'), 'el que nunca jugó en Argentina no puede salir con el checkbox');
});

test('una combinación vacía (grupo sin nadie que haya jugado en Argentina) da el error de siempre', async () => {
  // En "europa" solo queda Q_WORLD_NO (Q_WORLD_OK es de Japón) y nunca jugó en Argentina:
  // con el checkbox, el pool de "europa" queda vacío.
  const r = await api('/api/practica/nueva', { token: T2, cuerpo: { grupo: 'europa', dificultad: 'todas', argentina: true } });
  assert.equal(r.status, 422);
  assert.equal(r.datos.error, 'sin_jugadores');
  assert.match(r.datos.mensaje, /jugadores/i);

  // Sin el checkbox, ese mismo grupo sí tiene gente (Q_WORLD_NO).
  const sinCheckbox = await api('/api/practica/nueva', { token: T2, cuerpo: { grupo: 'europa', dificultad: 'todas', argentina: false } });
  assert.equal(sinCheckbox.status, 200);
});

test('los contadores de /api/practica/estado cambian según el checkbox', async () => {
  const sin = (await api('/api/practica/estado', { token: T2 })).datos.grupos;
  const con = (await api('/api/practica/estado?argentina=1', { token: T2 })).datos.grupos;

  const cant = (lista, id) => lista.find((g) => g.id === id).cantidad;
  assert.equal(cant(sin, 'todos'), 7); // los 7 jugadores inventados
  assert.equal(cant(con, 'todos'), 4); // Q_AR2, Q_UY_OK, Q_UY_LOW, Q_WORLD_OK: los jugoEnArgentina: true

  assert.equal(cant(sin, 'argentina'), 2);
  assert.equal(cant(con, 'argentina'), 1);

  // "sudamerica" incluye a Argentina (continentes.js no los separa): Q_MESSI, Q_AR2, UY_OK, UY_LOW, UY_NO.
  assert.equal(cant(sin, 'sudamerica'), 5);
  assert.equal(cant(con, 'sudamerica'), 3); // Q_AR2, UY_OK, UY_LOW (los jugoEnArgentina: true)

  assert.equal(cant(sin, 'europa'), 1); // solo WORLD_NO (WORLD_OK es de Japón, no es de Europa)
  assert.equal(cant(con, 'europa'), 0); // WORLD_NO nunca jugó en Argentina: queda vacío
});

test('el flag viaja en la vista de la partida de práctica', async () => {
  const r = await api('/api/practica/nueva', { token: T2, cuerpo: { grupo: 'todos', dificultad: 'todas', argentina: true } });
  assert.equal(r.datos.argentina, true);
  const sinCheckbox = await api('/api/practica/nueva', { token: T2, cuerpo: { grupo: 'todos', dificultad: 'todas', argentina: false } });
  assert.equal(sinCheckbox.datos.argentina, false);
});
