// Prueba el flujo completo contra el servidor real (api + base de datos), con una base temporal.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const PUERTO = 3199;
const BASE = `http://localhost:${PUERTO}`;
const dir = mkdtempSync(join(tmpdir(), 'crack-'));
const entorno = {
  ...process.env,
  PORT: String(PUERTO),
  TURSO_DATABASE_URL: `file:${join(dir, 'prueba.db')}`,
  SEMILLA: 'semilla-de-prueba',
  FECHA_INICIO: '2026-10-22',
};
Object.assign(process.env, { SEMILLA: entorno.SEMILLA, FECHA_INICIO: entorno.FECHA_INICIO });

// Mismos datos y misma semilla que el servidor: así sabemos quién es el jugador de cada día.
const { jugadorDelDia, datos } = await import('../lib/datos.js');
const { pistasDe, puntaje } = await import('../lib/juego.js');

const TOKEN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOKEN_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let servidor;

async function api(ruta, { token, cuerpo, fecha = '2026-11-01' } = {}) {
  const url = `${BASE}${ruta}${ruta.includes('?') ? '&' : '?'}fecha=${fecha}`;
  const r = await fetch(url, {
    method: cuerpo ? 'POST' : 'GET',
    headers: { ...(token ? { 'X-Token': token } : {}), ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, datos: await r.json(), texto: null };
}

const otroJugador = (excluidoId, n = 0) => datos().lista.filter((j) => j.id !== excluidoId)[n];

before(async () => {
  servidor = spawn('node', ['dev-server.mjs'], { env: entorno, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((ok, mal) => {
    servidor.stdout.on('data', (d) => String(d).includes('Listo') && ok());
    servidor.on('exit', (c) => mal(new Error(`el servidor se cerró (${c})`)));
  });
});

after(async () => {
  // En Windows la base sigue bloqueada hasta que el servidor termina: se espera su cierre
  // y, si aun así no se puede borrar, no se hace fallar el test por un archivo temporal.
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

test('sin token no se puede jugar', async () => {
  const r = await api('/api/hoy');
  assert.equal(r.status, 401);
});

test('el autocompletado trae a todos los jugadores', async () => {
  const r = await api('/api/jugadores', { token: TOKEN_A });
  assert.equal(r.datos.jugadores.length, datos().lista.length);
});

test('al empezar solo se ve la primera pista y no se filtra quién es', async () => {
  const dia = jugadorDelDia('2026-11-01');
  const total = pistasDe(dia).length;
  const r = await api('/api/hoy', { token: TOKEN_A });
  assert.equal(r.status, 200);
  assert.equal(r.datos.estado, 'jugando');
  assert.equal(r.datos.pistas.length, 1);
  assert.equal(r.datos.pendientes.length, total - 1);
  assert.equal(r.datos.puntajeActual, 1000);
  assert.equal(r.datos.intentosMax, 3);
  assert.ok('pais' in r.datos, 'la vista trae el país (o null si todavía no hay datos de nacionalidad)');
  assert.equal(r.datos.resultado, undefined);
  assert.ok(!JSON.stringify(r.datos).includes(dia.nombre), 'la respuesta no puede contener el nombre del jugador');
  assert.ok(!JSON.stringify(r.datos).includes(dia.id));
});

test('un error gasta un intento pero no abre pista, repetir no cuesta y un nombre inexistente se rechaza', async () => {
  const dia = jugadorDelDia('2026-11-01');
  const mal = otroJugador(dia.id, 0);
  let r = await api('/api/adivinar', { token: TOKEN_A, cuerpo: { id: mal.id } });
  assert.equal(r.datos.estado, 'jugando');
  assert.equal(r.datos.pistas.length, 1, 'equivocarse no abre pistas');
  assert.equal(r.datos.intentos.length, 1);
  assert.equal(r.datos.intentosMax, 3);
  assert.equal(r.datos.intentos[0].nombre, mal.nombre);

  r = await api('/api/adivinar', { token: TOKEN_A, cuerpo: { id: mal.id } });
  assert.equal(r.status, 409);
  assert.equal(r.datos.error, 'repetido');

  r = await api('/api/adivinar', { token: TOKEN_A, cuerpo: { texto: 'Nadie Existente' } });
  assert.equal(r.status, 422);
  assert.equal(r.datos.error, 'no_encontrado');

  r = await api('/api/hoy', { token: TOKEN_A });
  assert.equal(r.datos.pistas.length, 1, 'los rechazos no gastan pistas');
  assert.equal(r.datos.intentos.length, 1, 'ni intentos');
});

test('pedir una pista abre la siguiente y baja el puntaje posible', async () => {
  const r = await api('/api/pista', { token: TOKEN_A, cuerpo: {} });
  assert.equal(r.datos.pistas.length, 2);
  assert.ok(r.datos.puntajeActual < 1000);
});

test('acertar escribiendo el nombre sin tildes termina la partida con el puntaje correcto', async () => {
  const dia = jugadorDelDia('2026-11-01');
  const total = pistasDe(dia).length;
  const sinTildes = dia.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const r = await api('/api/adivinar', { token: TOKEN_A, cuerpo: { texto: sinTildes } });
  assert.equal(r.datos.estado, 'ganado');
  assert.equal(r.datos.puntaje, puntaje(2, total));
  assert.equal(r.datos.resultado.nombre, dia.nombre);
  assert.equal(r.datos.pistas.length, total, 'al terminar se muestran todas las pistas');

  const otra = await api('/api/adivinar', { token: TOKEN_A, cuerpo: { id: otroJugador(dia.id).id } });
  assert.equal(otra.datos.estado, 'ganado');
  assert.equal(otra.datos.puntaje, puntaje(2, total), 'no se puede seguir jugando una partida terminada');
});

test('al tercer nombre equivocado la partida termina en 0 puntos, con pistas sin abrir', async () => {
  const dia = jugadorDelDia('2026-11-01');
  let r;
  for (let n = 0; n < 2; n++) {
    r = await api('/api/adivinar', { token: TOKEN_C, cuerpo: { id: otroJugador(dia.id, n).id } });
    assert.equal(r.datos.estado, 'jugando');
    assert.equal(r.datos.intentos.length, n + 1);
    assert.equal(r.datos.pistas.length, 1);
  }
  r = await api('/api/adivinar', { token: TOKEN_C, cuerpo: { id: otroJugador(dia.id, 2).id } });
  assert.equal(r.datos.estado, 'perdido');
  assert.equal(r.datos.puntaje, 0);
  assert.equal(r.datos.resultado.nombre, dia.nombre);
});

test('con todas las pistas abiertas se sigue jugando hasta gastar los 3 intentos', async () => {
  const dia = jugadorDelDia('2026-11-01');
  const total = pistasDe(dia).length;
  for (let i = 1; i < total; i++) await api('/api/pista', { token: TOKEN_B, cuerpo: {} });
  let r = await api('/api/pista', { token: TOKEN_B, cuerpo: {} });
  assert.equal(r.status, 409);
  assert.equal(r.datos.error, 'sin_pistas');

  for (let n = 0; n < 2; n++) {
    r = await api('/api/adivinar', { token: TOKEN_B, cuerpo: { id: otroJugador(dia.id, n).id } });
    assert.equal(r.datos.estado, 'jugando');
  }
  r = await api('/api/adivinar', { token: TOKEN_B, cuerpo: { id: otroJugador(dia.id, 2).id } });
  assert.equal(r.datos.estado, 'perdido');
  assert.equal(r.datos.puntaje, 0);
  assert.equal(r.datos.resultado.nombre, dia.nombre);
});

test('el apodo se valida y el ranking marca solo tu fila, sin mostrar tokens', async () => {
  let r = await api('/api/apodo', { token: TOKEN_A, cuerpo: { apodo: 'x' } });
  assert.equal(r.status, 422);
  r = await api('/api/apodo', { token: TOKEN_A, cuerpo: { apodo: '  Robe   10 ' } });
  assert.equal(r.datos.apodo, 'Robe 10');

  r = await api('/api/ranking?tipo=dia', { token: TOKEN_A });
  assert.equal(r.datos.filas.length, 3);
  assert.equal(r.datos.filas[0].apodo, 'Robe 10');
  assert.equal(r.datos.filas[0].yo, true);
  assert.equal(r.datos.filas[1].yo, false);
  assert.match(r.datos.filas[1].apodo, /^Anónimo /);
  assert.ok(r.datos.filas[0].puntaje > r.datos.filas[1].puntaje);
  assert.ok(!JSON.stringify(r.datos).includes(TOKEN_B));

  r = await api('/api/ranking?tipo=acumulado', { token: TOKEN_B });
  assert.equal(r.datos.filas.length, 3);
  assert.equal(r.datos.filas.find((f) => f.yo).apodo.startsWith('Anónimo'), true);
});

test('la racha cuenta días seguidos ganados y se corta si falta uno', async () => {
  const ganar = async (fecha) => {
    const dia = jugadorDelDia(fecha);
    return api('/api/adivinar', { token: TOKEN_A, cuerpo: { id: dia.id }, fecha });
  };
  assert.equal((await api('/api/hoy', { token: TOKEN_A })).datos.racha, 1);
  assert.equal((await ganar('2026-11-02')).datos.racha, 2);
  assert.equal((await ganar('2026-11-04')).datos.racha, 1, 'el 3 no se jugó: la racha vuelve a 1');
});
