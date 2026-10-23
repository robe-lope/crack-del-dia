// Base de datos: SQLite vía libSQL.
// En tu máquina usa un archivo local (data/juego.db). En Vercel usa Turso: definí TURSO_DATABASE_URL y TURSO_AUTH_TOKEN.
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || 'file:data/juego.db';

if (process.env.VERCEL && url.startsWith('file:')) {
  throw new Error('Falta configurar TURSO_DATABASE_URL (y TURSO_AUTH_TOKEN) en las variables de entorno de Vercel.');
}

const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });

// Columnas agregadas después de la primera versión. CREATE TABLE IF NOT EXISTS no las suma a una
// base que ya existe (como la de producción en Turso), así que van con ALTER TABLE: si ya están,
// SQLite se queja de columna duplicada y se ignora. Correrlo mil veces da el mismo resultado.
const COLUMNAS_AGREGADAS = [
  `ALTER TABLE partidas ADD COLUMN pedidas TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE practicas ADD COLUMN pedidas TEXT NOT NULL DEFAULT '[]'`,
];

// Crea las tablas y aplica las migraciones. Es idempotente: se puede llamar cuantas veces se quiera.
export async function crearEsquema() {
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS usuarios (
         token TEXT PRIMARY KEY,
         apodo TEXT,
         creado INTEGER NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS partidas (
         fecha TEXT NOT NULL,
         token TEXT NOT NULL,
         pistas INTEGER NOT NULL,
         pedidas TEXT NOT NULL DEFAULT '[]',
         fallos TEXT NOT NULL,
         estado TEXT NOT NULL,
         puntaje INTEGER NOT NULL,
         inicio INTEGER NOT NULL,
         fin INTEGER,
         PRIMARY KEY (fecha, token)
       )`,
      `CREATE TABLE IF NOT EXISTS practicas (
         id TEXT PRIMARY KEY,
         token TEXT NOT NULL,
         jugador TEXT NOT NULL,
         grupo TEXT NOT NULL,
         dificultad TEXT NOT NULL,
         pistas INTEGER NOT NULL,
         pedidas TEXT NOT NULL DEFAULT '[]',
         fallos TEXT NOT NULL,
         estado TEXT NOT NULL,
         puntaje INTEGER NOT NULL,
         inicio INTEGER NOT NULL,
         fin INTEGER
       )`,
      'CREATE INDEX IF NOT EXISTS idx_practicas_token ON practicas (token, inicio DESC)',
      'CREATE INDEX IF NOT EXISTS idx_partidas_fecha ON partidas (fecha, puntaje DESC)',
      'CREATE INDEX IF NOT EXISTS idx_partidas_token ON partidas (token, fecha)',
    ],
    'write',
  );

  for (const sql of COLUMNAS_AGREGADAS) {
    try {
      await db.execute(sql);
    } catch (e) {
      if (!/duplicate column/i.test(String(e?.message ?? e))) throw e;
    }
  }
}

let iniciada;
function listo() {
  iniciada ??= crearEsquema();
  return iniciada;
}

// Las partidas que venían de la mecánica vieja no tienen `pedidas`: valen como 0 pistas pedidas.
function leerPedidas(valor) {
  try {
    const lista = JSON.parse(valor ?? '[]');
    return Array.isArray(lista) ? lista.filter((c) => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

const aPartida = (f) => ({
  fecha: f.fecha,
  token: f.token,
  pedidas: leerPedidas(f.pedidas),
  fallos: JSON.parse(f.fallos),
  estado: f.estado,
  puntaje: Number(f.puntaje),
  inicio: Number(f.inicio),
  fin: f.fin == null ? null : Number(f.fin),
});

export async function crearPartida(fecha, token, ahora) {
  await listo();
  await db.execute({
    sql: `INSERT OR IGNORE INTO partidas (fecha, token, pistas, pedidas, fallos, estado, puntaje, inicio)
          VALUES (?, ?, 0, '[]', '[]', 'jugando', 0, ?)`,
    args: [fecha, token, ahora],
  });
}

export async function obtenerPartida(fecha, token) {
  await listo();
  const r = await db.execute({ sql: 'SELECT * FROM partidas WHERE fecha = ? AND token = ?', args: [fecha, token] });
  return r.rows[0] ? aPartida(r.rows[0]) : null;
}

// Solo actualiza partidas que siguen en juego: si dos pedidos llegan a la vez, el segundo no pisa al primero.
// Devuelve false si la partida ya estaba terminada.
export async function guardarPartida(p) {
  await listo();
  // `pistas` se mantiene al día (= cuántas pistas se pidieron) porque el ranking y el historial la leen.
  const r = await db.execute({
    sql: `UPDATE partidas SET pistas = ?, pedidas = ?, fallos = ?, estado = ?, puntaje = ?, fin = ?
          WHERE fecha = ? AND token = ? AND estado = 'jugando'`,
    args: [
      p.pedidas.length,
      JSON.stringify(p.pedidas),
      JSON.stringify(p.fallos),
      p.estado,
      p.puntaje,
      p.fin ?? null,
      p.fecha,
      p.token,
    ],
  });
  return r.rowsAffected > 0;
}

export async function fijarApodo(token, apodo) {
  await listo();
  await db.execute({
    sql: `INSERT INTO usuarios (token, apodo, creado) VALUES (?, ?, ?)
          ON CONFLICT(token) DO UPDATE SET apodo = excluded.apodo`,
    args: [token, apodo, Date.now()],
  });
}

export async function obtenerApodo(token) {
  await listo();
  const r = await db.execute({ sql: 'SELECT apodo FROM usuarios WHERE token = ?', args: [token] });
  return r.rows[0]?.apodo ?? null;
}

export async function historial(token) {
  await listo();
  const r = await db.execute({
    sql: `SELECT fecha, estado FROM partidas WHERE token = ? AND estado != 'jugando' ORDER BY fecha DESC LIMIT 400`,
    args: [token],
  });
  return r.rows.map((f) => ({ fecha: f.fecha, estado: f.estado }));
}

export async function rankingDia(fecha, limite = 50) {
  await listo();
  const r = await db.execute({
    sql: `SELECT p.token, u.apodo, p.puntaje, p.pistas, p.estado, (p.fin - p.inicio) AS ms
          FROM partidas p LEFT JOIN usuarios u ON u.token = p.token
          WHERE p.fecha = ? AND p.estado != 'jugando'
          ORDER BY p.puntaje DESC, ms ASC LIMIT ?`,
    args: [fecha, limite],
  });
  return r.rows.map((f) => ({
    token: f.token,
    apodo: f.apodo,
    puntaje: Number(f.puntaje),
    pistas: Number(f.pistas),
    estado: f.estado,
  }));
}

export async function rankingAcumulado(desde, hasta, limite = 50) {
  await listo();
  const r = await db.execute({
    sql: `SELECT p.token, u.apodo, SUM(p.puntaje) AS total, COUNT(*) AS dias,
                 SUM(CASE WHEN p.estado = 'ganado' THEN 1 ELSE 0 END) AS ganados
          FROM partidas p LEFT JOIN usuarios u ON u.token = p.token
          WHERE p.fecha BETWEEN ? AND ? AND p.estado != 'jugando'
          GROUP BY p.token
          ORDER BY total DESC, ganados DESC LIMIT ?`,
    args: [desde, hasta, limite],
  });
  return r.rows.map((f) => ({
    token: f.token,
    apodo: f.apodo,
    puntaje: Number(f.total),
    dias: Number(f.dias),
    ganados: Number(f.ganados),
  }));
}

// ───────────── Práctica: partidas sueltas, sin ranking ni racha ─────────────

const aPractica = (f) => ({
  id: f.id,
  token: f.token,
  jugador: f.jugador,
  grupo: f.grupo,
  dificultad: f.dificultad,
  pedidas: leerPedidas(f.pedidas),
  fallos: JSON.parse(f.fallos),
  estado: f.estado,
  puntaje: Number(f.puntaje),
  inicio: Number(f.inicio),
  fin: f.fin == null ? null : Number(f.fin),
});

export async function crearPractica(p) {
  await listo();
  await db.batch(
    [
      // Si había una sin terminar, se abandona: solo cuenta la última.
      { sql: `UPDATE practicas SET estado = 'abandonada' WHERE token = ? AND estado = 'jugando'`, args: [p.token] },
      {
        sql: `INSERT INTO practicas (id, token, jugador, grupo, dificultad, pistas, pedidas, fallos, estado, puntaje, inicio)
              VALUES (?, ?, ?, ?, ?, 0, '[]', '[]', 'jugando', 0, ?)`,
        args: [p.id, p.token, p.jugador, p.grupo, p.dificultad, p.inicio],
      },
    ],
    'write',
  );
}

export async function obtenerPractica(id, token) {
  await listo();
  const r = await db.execute({ sql: 'SELECT * FROM practicas WHERE id = ? AND token = ?', args: [id, token] });
  return r.rows[0] ? aPractica(r.rows[0]) : null;
}

export async function practicaEnCurso(token) {
  await listo();
  const r = await db.execute({
    sql: `SELECT * FROM practicas WHERE token = ? AND estado = 'jugando' ORDER BY inicio DESC LIMIT 1`,
    args: [token],
  });
  return r.rows[0] ? aPractica(r.rows[0]) : null;
}

export async function guardarPractica(p) {
  await listo();
  const r = await db.execute({
    sql: `UPDATE practicas SET pistas = ?, pedidas = ?, fallos = ?, estado = ?, puntaje = ?, fin = ?
          WHERE id = ? AND token = ? AND estado = 'jugando'`,
    args: [
      p.pedidas.length,
      JSON.stringify(p.pedidas),
      JSON.stringify(p.fallos),
      p.estado,
      p.puntaje,
      p.fin ?? null,
      p.id,
      p.token,
    ],
  });
  return r.rowsAffected > 0;
}

// Jugadores de las últimas práctica de esta persona, para no repetirlos enseguida.
export async function jugadoresPracticados(token, limite = 150) {
  await listo();
  const r = await db.execute({
    sql: 'SELECT jugador FROM practicas WHERE token = ? ORDER BY inicio DESC LIMIT ?',
    args: [token, limite],
  });
  return r.rows.map((f) => f.jugador);
}
