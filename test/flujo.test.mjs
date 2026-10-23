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
const { basicasDe, categoriasDe, puntaje } = await import('../lib/juego.js');

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

// El jugador del 1 de noviembre con la semilla de prueba, y sus clubes.
const DIA = '2026-11-01';
const clubesDelDia = () => categoriasDe(jugadorDelDia(DIA)).get('carrera') ?? [];

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

test('al empezar se ven todas las básicas, ninguna pista pedida y nada de lo que no se pidió', async () => {
  const dia = jugadorDelDia(DIA);
  const r = await api('/api/hoy', { token: TOKEN_A });
  assert.equal(r.status, 200);
  assert.equal(r.datos.estado, 'jugando');

  // Todas las básicas se ven de entrada, en el orden del programa.
  assert.deepEqual(r.datos.basicas, basicasDe(dia));
  assert.ok(r.datos.basicas.length >= 3, 'un jugador del día tiene al menos 3 básicas');

  assert.deepEqual(r.datos.reveladas, []);
  assert.equal(r.datos.pedidas, 0);
  assert.equal(r.datos.puntajeActual, 1000);
  assert.equal(r.datos.puntajeSiguiente, 900);
  assert.equal(r.datos.costoPista, 100);
  assert.equal(r.datos.intentosMax, 3);
  assert.equal(r.datos.todas, undefined, 'mientras se juega no viajan todas las pistas');
  assert.equal(r.datos.resultado, undefined);
  assert.ok('pais' in r.datos, 'la vista trae el país (o null si todavía no hay datos de nacionalidad)');

  // Las categorías viajan sin un solo valor.
  assert.ok(r.datos.disponibles.length > 0);
  for (const d of r.datos.disponibles) {
    assert.deepEqual(Object.keys(d).sort(), ['id', 'nombre', 'quedan']);
    assert.ok(d.quedan > 0);
  }
  assert.equal(
    r.datos.disponibles.find((d) => d.id === 'carrera').quedan,
    clubesDelDia().length,
  );

  // Ni el jugador ni ninguna pista sin pedir.
  const texto = JSON.stringify(r.datos);
  assert.ok(!texto.includes(dia.nombre), 'la respuesta no puede contener el nombre del jugador');
  assert.ok(!texto.includes(dia.id), 'ni su id');
  for (const items of categoriasDe(dia).values()) {
    for (const item of items) assert.ok(!texto.includes(item.valor), `se filtró una pista sin pedir: ${item.valor}`);
  }
});

test('un error gasta un intento pero no revela pistas, repetir no cuesta y un nombre inexistente se rechaza', async () => {
  const dia = jugadorDelDia(DIA);
  const mal = otroJugador(dia.id, 0);
  let r = await api('/api/adivinar', { token: TOKEN_A, cuerpo: { id: mal.id } });
  assert.equal(r.datos.estado, 'jugando');
  assert.equal(r.datos.pedidas, 0, 'equivocarse no revela pistas');
  assert.deepEqual(r.datos.reveladas, []);
  assert.equal(r.datos.puntajeActual, 1000, 'ni baja el puntaje');
  assert.equal(r.datos.intentos.length, 1);
  assert.equal(r.datos.intentos[0].nombre, mal.nombre);

  r = await api('/api/adivinar', { token: TOKEN_A, cuerpo: { id: mal.id } });
  assert.equal(r.status, 409);
  assert.equal(r.datos.error, 'repetido');

  r = await api('/api/adivinar', { token: TOKEN_A, cuerpo: { texto: 'Nadie Existente' } });
  assert.equal(r.status, 422);
  assert.equal(r.datos.error, 'no_encontrado');

  r = await api('/api/hoy', { token: TOKEN_A });
  assert.equal(r.datos.pedidas, 0, 'los rechazos no gastan pistas');
  assert.equal(r.datos.intentos.length, 1, 'ni intentos');
});

test('pedir una categoría revela una pista y baja el puntaje 100', async () => {
  const clubes = clubesDelDia();
  let r = await api('/api/pista', { token: TOKEN_A, cuerpo: { categoria: 'carrera' } });
  assert.equal(r.status, 200);
  assert.equal(r.datos.pedidas, 1);
  assert.equal(r.datos.puntajeActual, 900);
  assert.equal(r.datos.puntajeSiguiente, 800);
  assert.deepEqual(r.datos.reveladas, [
    { categoria: 'carrera', nombre: 'Carrera', etiqueta: clubes[0].etiqueta, valor: clubes[0].valor },
  ]);
  assert.equal(r.datos.disponibles.find((d) => d.id === 'carrera').quedan, clubes.length - 1);

  // La carrera es repetible: cada pedido trae el club siguiente, en orden.
  if (clubes.length > 1) {
    r = await api('/api/pista', { token: TOKEN_A, cuerpo: { categoria: 'carrera' } });
    assert.equal(r.datos.pedidas, 2);
    assert.equal(r.datos.puntajeActual, 800);
    assert.deepEqual(r.datos.reveladas.map((x) => x.valor), [clubes[0].valor, clubes[1].valor]);
  }
});

test('pedir una categoría que el jugador no tiene, o inventada, falla con un mensaje claro', async () => {
  for (const categoria of ['apodo', 'palmares', 'dorsal', 'inventada', '', null]) {
    const r = await api('/api/pista', { token: TOKEN_A, cuerpo: { categoria } });
    assert.equal(r.status, 422, `categoría ${JSON.stringify(categoria)}`);
    assert.equal(r.datos.error, 'categoria');
    assert.match(r.datos.mensaje, /categoría/i);
  }
  // Y no cambió nada.
  const r = await api('/api/hoy', { token: TOKEN_A });
  assert.equal(r.datos.pedidas, Math.min(2, clubesDelDia().length));
});

test('una categoría agotada se rechaza y dice de cuál se trata', async () => {
  const clubes = clubesDelDia();
  let r = await api('/api/hoy', { token: TOKEN_C });
  for (let i = 0; i < clubes.length; i++) {
    r = await api('/api/pista', { token: TOKEN_C, cuerpo: { categoria: 'carrera' } });
    assert.equal(r.status, 200);
  }
  assert.equal(r.datos.pedidas, clubes.length);
  assert.deepEqual(r.datos.reveladas.map((x) => x.valor), clubes.map((c) => c.valor));
  assert.ok(r.datos.disponibles.every((d) => d.quedan === 0), 'ya no queda nada por pedir');
  assert.equal(r.datos.puntajeActual, puntaje(clubes.length));

  r = await api('/api/pista', { token: TOKEN_C, cuerpo: { categoria: 'carrera' } });
  assert.equal(r.status, 409);
  assert.equal(r.datos.error, 'agotada');
  assert.match(r.datos.mensaje, /Carrera/);
});

test('con todas las pistas pedidas se sigue jugando hasta gastar los 3 intentos', async () => {
  const dia = jugadorDelDia(DIA);
  let r;
  for (let n = 0; n < 2; n++) {
    r = await api('/api/adivinar', { token: TOKEN_C, cuerpo: { id: otroJugador(dia.id, n).id } });
    assert.equal(r.datos.estado, 'jugando');
  }
  r = await api('/api/adivinar', { token: TOKEN_C, cuerpo: { id: otroJugador(dia.id, 2).id } });
  assert.equal(r.datos.estado, 'perdido');
  assert.equal(r.datos.puntaje, 0);
  assert.equal(r.datos.resultado.nombre, dia.nombre);
  assert.ok(r.datos.todas.every((t) => t.usada), 'este token había pedido todas');
});

test('acertar escribiendo el nombre sin tildes termina la partida con el puntaje nuevo', async () => {
  const dia = jugadorDelDia(DIA);
  const pedidas = Math.min(2, clubesDelDia().length);
  const sinTildes = dia.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const r = await api('/api/adivinar', { token: TOKEN_A, cuerpo: { texto: sinTildes } });
  assert.equal(r.datos.estado, 'ganado');
  assert.equal(r.datos.puntaje, puntaje(pedidas));
  assert.equal(r.datos.resultado.nombre, dia.nombre);

  // Al terminar se muestran todas, con las que no se usaron marcadas.
  const todosLosItems = [...categoriasDe(dia).values()].flat();
  assert.equal(r.datos.todas.length, todosLosItems.length, 'al terminar se muestran todas las pistas');
  assert.equal(r.datos.todas.filter((t) => t.usada).length, pedidas);
  assert.equal(r.datos.todas.filter((t) => !t.usada).length, todosLosItems.length - pedidas);

  const otra = await api('/api/adivinar', { token: TOKEN_A, cuerpo: { id: otroJugador(dia.id).id } });
  assert.equal(otra.datos.estado, 'ganado');
  assert.equal(otra.datos.puntaje, puntaje(pedidas), 'no se puede seguir jugando una partida terminada');

  const pista = await api('/api/pista', { token: TOKEN_A, cuerpo: { categoria: 'carrera' } });
  assert.equal(pista.datos.estado, 'ganado', 'ni pedir pistas después de terminar');
  assert.equal(pista.datos.puntaje, puntaje(pedidas));
});

test('al tercer nombre equivocado la partida termina en 0 puntos, con pistas sin usar', async () => {
  const dia = jugadorDelDia(DIA);
  let r;
  for (let n = 0; n < 2; n++) {
    r = await api('/api/adivinar', { token: TOKEN_B, cuerpo: { id: otroJugador(dia.id, n).id } });
    assert.equal(r.datos.estado, 'jugando');
    assert.equal(r.datos.intentos.length, n + 1);
    assert.equal(r.datos.pedidas, 0);
  }
  r = await api('/api/adivinar', { token: TOKEN_B, cuerpo: { id: otroJugador(dia.id, 2).id } });
  assert.equal(r.datos.estado, 'perdido');
  assert.equal(r.datos.puntaje, 0);
  assert.equal(r.datos.resultado.nombre, dia.nombre);
  assert.ok(r.datos.todas.length > 0);
  assert.ok(r.datos.todas.every((t) => !t.usada), 'no pidió ninguna: van todas marcadas como sin usar');
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
  assert.equal(r.datos.filas[0].pistas, Math.min(2, clubesDelDia().length), 'el ranking cuenta las pistas pedidas');
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

test('ganar sin pedir una sola pista vale 1000', async () => {
  const fecha = '2026-11-20';
  const dia = jugadorDelDia(fecha);
  const r = await api('/api/adivinar', { token: TOKEN_B, cuerpo: { id: dia.id }, fecha });
  assert.equal(r.datos.estado, 'ganado');
  assert.equal(r.datos.puntaje, 1000);
});
