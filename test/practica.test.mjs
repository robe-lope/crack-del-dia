// Modo práctica contra el servidor real, con datos que traen nacionalidad (inventada, solo para probar).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const PUERTO = 3198;
const BASE = `http://localhost:${PUERTO}`;
const dir = mkdtempSync(join(tmpdir(), 'crack-practica-'));

// Datos de prueba: se reparten países de forma fija según el grupo con el que se bajó cada jugador.
const SUR = ['br', 'uy', 'co', 'cl', 'py'];
const EUR = ['it', 'es', 'de', 'fr', 'gb-eng'];
const lista = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url), 'utf8'));
lista.forEach((j, i) => {
  const codigo = j.origen === 'Argentinos' ? 'ar' : j.origen === 'Sudamericanos' ? SUR[i % SUR.length] : EUR[i % EUR.length];
  j.nacionalidad = { codigo, nombre: codigo.toUpperCase() };
});
const archivo = join(dir, 'players.json');
writeFileSync(archivo, JSON.stringify(lista));

const entorno = {
  ...process.env,
  PORT: String(PUERTO),
  PLAYERS_FILE: archivo,
  TURSO_DATABASE_URL: `file:${join(dir, 'prueba.db')}`,
  SEMILLA: 'semilla-de-prueba',
};
Object.assign(process.env, { PLAYERS_FILE: archivo, SEMILLA: entorno.SEMILLA });

const { datos } = await import('../lib/datos.js');
const { pozoDe } = await import('../lib/practica.js');
const { continenteDe } = await import('../lib/continentes.js');

const T1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const T2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
let servidor;

async function api(ruta, { token, cuerpo } = {}) {
  const r = await fetch(`${BASE}${ruta}`, {
    method: cuerpo ? 'POST' : 'GET',
    headers: { ...(token ? { 'X-Token': token } : {}), ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, datos: await r.json() };
}

// Jugadores que seguro NO son la respuesta: los de un país que no está en el grupo de la partida.
const ajenos = (excluirCodigos) => datos().lista.filter((j) => !excluirCodigos.includes(j.nacionalidad.codigo));

// Gasta los intentos con nombres equivocados y devuelve la última vista.
async function perder(token, partida, equivocados) {
  let v;
  for (const j of equivocados.slice(0, 3)) {
    v = (await api('/api/practica/adivinar', { token, cuerpo: { partida, id: j.id } })).datos;
  }
  return v;
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
    /* carpeta temporal */
  }
});

test('el estado inicial ofrece grupos con cantidad y no hay partida en curso', async () => {
  const r = await api('/api/practica/estado', { token: T1 });
  assert.equal(r.status, 200);
  assert.equal(r.datos.partida, null);
  assert.deepEqual(r.datos.grupos.map((g) => g.id), ['todos', 'argentina', 'sudamerica', 'europa']);
  for (const g of r.datos.grupos) assert.ok(g.cantidad > 0, `el grupo ${g.id} tiene jugadores`);
  assert.ok(r.datos.grupos[0].cantidad >= r.datos.grupos[1].cantidad);
});

test('una práctica nueva muestra las básicas y ninguna pista pedida, sin filtrar quién es', async () => {
  const r = await api('/api/practica/nueva', { token: T1, cuerpo: { grupo: 'europa', dificultad: 'facil' } });
  assert.equal(r.status, 200);
  const v = r.datos;
  assert.equal(v.modo, 'practica');
  assert.equal(v.estado, 'jugando');
  assert.ok(v.basicas.length >= 3);
  assert.deepEqual(v.reveladas, []);
  assert.equal(v.pedidas, 0);
  assert.equal(v.puntajeActual, 1000);
  assert.equal(v.intentosMax, 3);
  assert.equal(v.pais.codigo.length > 0, true);
  assert.equal(continenteDe(v.pais.codigo), 'europa', 'el jugador pertenece al grupo pedido');
  assert.equal(v.resultado, undefined);
  assert.ok(!('jugador' in v));
  assert.ok(!('numero' in v) && !('racha' in v), 'sin número de día ni racha');
});

test('se recupera la práctica en curso y solo la ve su dueño', async () => {
  const e = await api('/api/practica/estado', { token: T1 });
  assert.equal(e.datos.partida.grupo, 'europa');
  const id = e.datos.partida.partida;

  const ajeno = await api('/api/practica/adivinar', { token: T2, cuerpo: { partida: id, texto: 'Messi' } });
  assert.equal(ajeno.status, 404);
  const otroEstado = await api('/api/practica/estado', { token: T2 });
  assert.equal(otroEstado.datos.partida, null);
});

test('equivocarse gasta intentos sin revelar pistas, y a la tercera se pierde', async () => {
  const e = await api('/api/practica/estado', { token: T1 });
  const id = e.datos.partida.partida; // grupo europa
  const equivocados = ajenos([...EUR]);

  let r = await api('/api/practica/pista', { token: T1, cuerpo: { partida: id, categoria: 'carrera' } });
  assert.equal(r.datos.pedidas, 1);
  assert.equal(r.datos.puntajeActual, 900);

  r = await api('/api/practica/adivinar', { token: T1, cuerpo: { partida: id, id: equivocados[0].id } });
  assert.equal(r.datos.estado, 'jugando');
  assert.equal(r.datos.intentos.length, 1);
  assert.equal(r.datos.pedidas, 1, 'equivocarse no revela pistas');
  assert.equal(r.datos.puntajeActual, 900);

  r = await perder(T1, id, equivocados.slice(1));
  assert.equal(r.estado, 'perdido');
  assert.equal(r.puntaje, 0);
  const era = datos().lista.find((j) => j.nombre === r.resultado.nombre);
  assert.equal(continenteDe(era.nacionalidad.codigo), 'europa');
  // La práctica también revela la foto al terminar (mismo contrato que el diario).
  assert.equal(r.resultado.foto, era.foto ?? null);
  assert.equal(r.resultado.fotoPagina, era.fotoPagina ?? null);
});

test('pedir una categoría inexistente en práctica falla igual que en el diario', async () => {
  const r = await api('/api/practica/nueva', { token: T2, cuerpo: { grupo: 'todos', dificultad: 'todas' } });
  const id = r.datos.partida;
  const mala = await api('/api/practica/pista', { token: T2, cuerpo: { partida: id, categoria: 'inventada' } });
  assert.equal(mala.status, 422);
  assert.equal(mala.datos.error, 'categoria');
});

test('una partida terminada no cambia aunque se siga mandando', async () => {
  let r = await api('/api/practica/nueva', { token: T1, cuerpo: { grupo: 'argentina', dificultad: 'todas' } });
  const id = r.datos.partida;
  const perdida = await perder(T1, id, ajenos(['ar']));
  assert.equal(perdida.estado, 'perdido');
  const era = datos().lista.find((j) => j.nombre === perdida.resultado.nombre);
  assert.equal(era.nacionalidad.codigo, 'ar');

  const otra = await api('/api/practica/adivinar', { token: T1, cuerpo: { partida: id, id: era.id } });
  assert.equal(otra.datos.estado, 'perdido', 'ya terminó: acertar después no la reabre');
  assert.equal(otra.datos.puntaje, 0);
});

test('la práctica no toca el ranking, la racha ni la partida diaria', async () => {
  const hoy = await api('/api/hoy', { token: T1 });
  assert.equal(hoy.datos.estado, 'jugando');
  assert.equal(hoy.datos.racha, 0);
  const ranking = await api('/api/ranking?tipo=dia', { token: T1 });
  assert.equal(ranking.datos.filas.length, 0);
});

test('una práctica nueva abandona la anterior y rechaza opciones inválidas', async () => {
  const a = await api('/api/practica/nueva', { token: T2, cuerpo: { grupo: 'todos', dificultad: 'todas' } });
  const b = await api('/api/practica/nueva', { token: T2, cuerpo: { grupo: 'sudamerica', dificultad: 'dificil' } });
  const e = await api('/api/practica/estado', { token: T2 });
  assert.equal(e.datos.partida.partida, b.datos.partida);
  assert.notEqual(a.datos.partida, b.datos.partida);

  const mala = await api('/api/practica/nueva', { token: T2, cuerpo: { grupo: 'marte', dificultad: 'todas' } });
  assert.equal(mala.status, 422);
});

test('la dificultad se mide dentro del grupo: fácil es más famoso que difícil', () => {
  for (const grupo of ['todos', 'argentina', 'sudamerica', 'europa']) {
    const media = (lista) => lista.reduce((s, j) => s + (j.popularidad ?? 0), 0) / lista.length;
    const facil = pozoDe(grupo, 'facil');
    const dificil = pozoDe(grupo, 'dificil');
    assert.ok(facil.length && dificil.length, `${grupo} tiene jugadores en fácil y difícil`);
    assert.ok(media(facil) >= media(dificil), `${grupo}: fácil no puede ser menos famoso que difícil`);
    const ids = new Set(facil.map((j) => j.id));
    assert.ok(dificil.every((j) => !ids.has(j.id)), 'fácil y difícil no se pisan');
    assert.equal(facil.length + pozoDe(grupo, 'medio').length + dificil.length, pozoDe(grupo, 'todas').length);
  }
});
