// La migración corre sobre la base que ya existe en producción: tiene que ser idempotente
// y no romper las partidas viejas (las que todavía no tienen la columna `pedidas`).
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'crack-store-'));
const archivo = join(dir, 'vieja.db');
process.env.TURSO_DATABASE_URL = `file:${archivo}`;

const TOKEN = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

// El esquema de la versión anterior, sin `pedidas`, con una partida y una práctica en curso.
const viejo = createClient({ url: `file:${archivo}` });

before(async () => {
  await viejo.batch(
    [
      `CREATE TABLE usuarios (token TEXT PRIMARY KEY, apodo TEXT, creado INTEGER NOT NULL)`,
      `CREATE TABLE partidas (
         fecha TEXT NOT NULL, token TEXT NOT NULL, pistas INTEGER NOT NULL, fallos TEXT NOT NULL,
         estado TEXT NOT NULL, puntaje INTEGER NOT NULL, inicio INTEGER NOT NULL, fin INTEGER,
         PRIMARY KEY (fecha, token)
       )`,
      `CREATE TABLE practicas (
         id TEXT PRIMARY KEY, token TEXT NOT NULL, jugador TEXT NOT NULL, grupo TEXT NOT NULL,
         dificultad TEXT NOT NULL, pistas INTEGER NOT NULL, fallos TEXT NOT NULL, estado TEXT NOT NULL,
         puntaje INTEGER NOT NULL, inicio INTEGER NOT NULL, fin INTEGER
       )`,
      {
        sql: `INSERT INTO partidas (fecha, token, pistas, fallos, estado, puntaje, inicio)
              VALUES ('2026-10-30', ?, 3, '[]', 'jugando', 0, 1000)`,
        args: [TOKEN],
      },
      {
        sql: `INSERT INTO practicas (id, token, jugador, grupo, dificultad, pistas, fallos, estado, puntaje, inicio)
              VALUES ('vieja-1', ?, 'Q1', 'todos', 'todas', 2, '[]', 'jugando', 0, 1000)`,
        args: [TOKEN],
      },
    ],
    'write',
  );
  viejo.close();
});

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* carpeta temporal: el sistema la limpia solo */
  }
});

test('el init agrega la columna pedidas y se puede correr dos veces seguidas', async () => {
  const store = await import('../lib/store.js');
  await store.crearEsquema();
  await store.crearEsquema(); // idempotente: la segunda vez no tiene que explotar
  await store.crearEsquema();

  const p = await store.obtenerPartida('2026-10-30', TOKEN);
  assert.deepEqual(p.pedidas, [], 'una partida vieja en curso vale como 0 pistas pedidas');
  assert.equal(p.estado, 'jugando');

  const pr = await store.obtenerPractica('vieja-1', TOKEN);
  assert.deepEqual(pr.pedidas, []);
});

test('al guardar, la columna pistas queda igual a cuántas pistas se pidieron', async () => {
  const store = await import('../lib/store.js');
  const p = await store.obtenerPartida('2026-10-30', TOKEN);
  const guardada = await store.guardarPartida({
    ...p,
    pedidas: ['carrera', 'carrera', 'apodo'],
    estado: 'ganado',
    puntaje: 700,
    fin: 2000,
  });
  assert.equal(guardada, true);

  const vuelta = await store.obtenerPartida('2026-10-30', TOKEN);
  assert.deepEqual(vuelta.pedidas, ['carrera', 'carrera', 'apodo']);

  // El ranking lee la columna `pistas`: tiene que seguir al día.
  const ranking = await store.rankingDia('2026-10-30');
  assert.equal(ranking[0].pistas, 3);
  assert.equal(ranking[0].puntaje, 700);
});

test('una partida nueva arranca sin pistas pedidas', async () => {
  const store = await import('../lib/store.js');
  await store.crearPartida('2026-11-15', TOKEN, 3000);
  const p = await store.obtenerPartida('2026-11-15', TOKEN);
  assert.deepEqual(p.pedidas, []);
  assert.equal(p.estado, 'jugando');
});

test('un pedidas corrupto en la base no voltea el servidor', async () => {
  const store = await import('../lib/store.js');
  const db = createClient({ url: `file:${archivo}` });
  await db.execute({
    sql: `UPDATE partidas SET pedidas = 'esto no es json' WHERE fecha = '2026-11-15' AND token = ?`,
    args: [TOKEN],
  });
  db.close();
  assert.deepEqual((await store.obtenerPartida('2026-11-15', TOKEN)).pedidas, []);
});
