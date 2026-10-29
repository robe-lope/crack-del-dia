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
// La base de este proceso (para importar lib/partida.js) es otra: no se cruza con la del servidor.
Object.assign(process.env, {
  SEMILLA: entorno.SEMILLA,
  FECHA_INICIO: entorno.FECHA_INICIO,
  TURSO_DATABASE_URL: `file:${join(dir, 'unidad.db')}`,
});

// Mismos datos y misma semilla que el servidor: así sabemos quién es el jugador de cada día.
const { jugadorDelDia, datos } = await import('../lib/datos.js');
const { CATEGORIAS, MAX_PISTAS, PUNTAJE_MINIMO, basicasDe, categoriasDe, diaAnterior, fechaDeHoy, puntaje } = await import(
  '../lib/juego.js'
);
const { vistaBase } = await import('../lib/partida.js');

const TOKEN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOKEN_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOKEN_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TOKEN_E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
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

test('el autocompletado manda solo lo mínimo y se puede revalidar con el ETag', async () => {
  const r = await fetch(`${BASE}/api/jugadores`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'public, s-maxage=86400, stale-while-revalidate=604800');
  const etag = r.headers.get('etag');
  assert.ok(etag);
  const { jugadores, ...resto } = await r.json();
  assert.deepEqual(Object.keys(resto), []);
  for (const j of jugadores) {
    assert.deepEqual(Object.keys(j).filter((k) => !['id', 'n', 'a', 'e'].includes(k)), [], `campos de más en ${j.id}`);
    assert.equal(typeof j.id, 'string');
    assert.equal(typeof j.n, 'string');
    assert.ok(Array.isArray(j.a));
  }
  const otra = await fetch(`${BASE}/api/jugadores`, { headers: { 'If-None-Match': etag } });
  assert.equal(otra.status, 304);
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
  // Categorías del catálogo que este jugador no tiene, más una inventada y valores vacíos:
  // ninguna le puede dar una pista válida.
  const dia = jugadorDelDia(DIA);
  const sinDatos = CATEGORIAS.map((c) => c.id).filter((id) => !categoriasDe(dia).has(id));
  for (const categoria of [...sinDatos, 'inventada', '', null]) {
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
  // Solo se agotó "carrera": otras categorías del jugador (si tiene) pueden seguir con pistas.
  assert.equal(r.datos.disponibles.find((d) => d.id === 'carrera').quedan, 0, 'ya no queda carrera por pedir');
  assert.equal(r.datos.puntajeActual, puntaje(clubes.length));

  r = await api('/api/pista', { token: TOKEN_C, cuerpo: { categoria: 'carrera' } });
  assert.equal(r.status, 409);
  assert.equal(r.datos.error, 'agotada');
  assert.match(r.datos.mensaje, /Carrera/);
});

test('con todas las pistas pedidas se sigue jugando hasta gastar los 3 intentos', async () => {
  const dia = jugadorDelDia(DIA);
  const clubes = clubesDelDia();
  let r;
  for (let n = 0; n < 2; n++) {
    r = await api('/api/adivinar', { token: TOKEN_C, cuerpo: { id: otroJugador(dia.id, n).id } });
    assert.equal(r.datos.estado, 'jugando');
  }
  r = await api('/api/adivinar', { token: TOKEN_C, cuerpo: { id: otroJugador(dia.id, 2).id } });
  assert.equal(r.datos.estado, 'perdido');
  assert.equal(r.datos.puntaje, 0);
  assert.equal(r.datos.resultado.nombre, dia.nombre);
  // Este token solo pidió "carrera" (en el test anterior): esas quedan marcadas como usadas,
  // el resto de las categorías que tenga el jugador (si tiene otras) quedan sin usar.
  const carrera = r.datos.todas.filter((t) => t.categoria === 'carrera');
  assert.equal(carrera.length, clubes.length);
  assert.ok(carrera.every((t) => t.usada), 'pidió todos los clubes');
  assert.ok(r.datos.todas.filter((t) => t.categoria !== 'carrera').every((t) => !t.usada), 'no pidió nada más');
});

test('acertar escribiendo el nombre sin tildes termina la partida con el puntaje nuevo', async () => {
  const dia = jugadorDelDia(DIA);
  const pedidas = Math.min(2, clubesDelDia().length);
  const sinTildes = dia.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const r = await api('/api/adivinar', { token: TOKEN_A, cuerpo: { texto: sinTildes } });
  assert.equal(r.datos.estado, 'ganado');
  assert.equal(r.datos.puntaje, puntaje(pedidas));
  assert.equal(r.datos.resultado.nombre, dia.nombre);
  // El frontend reemplaza la silueta por esta foto al terminar (ganada o perdida): tienen que venir
  // las dos claves, aunque sea con null si el jugador no tiene foto.
  assert.equal(r.datos.resultado.foto, dia.foto ?? null);
  assert.equal(r.datos.resultado.fotoPagina, dia.fotoPagina ?? null);

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
  // La foto se revela también al perder, no solo al ganar.
  assert.equal(r.datos.resultado.foto, dia.foto ?? null);
  assert.equal(r.datos.resultado.fotoPagina, dia.fotoPagina ?? null);
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

// Estos tres usan la fecha real de hoy (no la fija DIA='2026-11-01' del resto del archivo), así que
// van al final: si fueran antes, sus partidas entrarían en la ventana de "últimos 30 días" que
// chequea el ranking acumulado de arriba y le cambiarían el conteo.
test('la partida de hoy perdida no revela al jugador hasta mañana', async () => {
  const hoy = fechaDeHoy();
  const dia = jugadorDelDia(hoy);
  let r;
  for (let n = 0; n < 3; n++) {
    r = await api('/api/adivinar', { token: TOKEN_D, cuerpo: { id: otroJugador(dia.id, n).id }, fecha: hoy });
  }
  assert.equal(r.datos.estado, 'perdido');
  assert.equal(r.datos.puntaje, 0);
  assert.equal(r.datos.resultado, undefined, 'no se manda resultado mientras sea hoy');
  assert.equal(r.datos.todas, undefined, 'tampoco la lista completa de pistas');
  const texto = JSON.stringify(r.datos);
  assert.ok(!texto.includes(dia.nombre), 'el nombre no viaja por ningún lado');
  assert.ok(!texto.includes(dia.id));

  // Sigue oculto en pedidos posteriores (no solo en la respuesta del momento de perder).
  r = await api('/api/hoy', { token: TOKEN_D, fecha: hoy });
  assert.equal(r.datos.resultado, undefined);
  assert.equal(r.datos.todas, undefined);

  // El resto de la vista (básicas, intentos) se sigue viendo normal.
  assert.ok(r.datos.basicas.length > 0);
  assert.equal(r.datos.intentos.length, 3);

  // Ranking y autocompletado no filtran quién era.
  const ranking = await api('/api/ranking?tipo=dia', { token: TOKEN_D, fecha: hoy });
  assert.ok(!JSON.stringify(ranking.datos).includes(dia.nombre));
  const jugadores = await api('/api/jugadores', { token: TOKEN_D, fecha: hoy });
  assert.ok(JSON.stringify(jugadores.datos).includes(dia.nombre), 'el autocompletado sigue listando a todos, como siempre');
});

test('ganar la partida de hoy revela todo igual, aunque sea hoy', async () => {
  const hoy = fechaDeHoy();
  const dia = jugadorDelDia(hoy);
  const r = await api('/api/adivinar', { token: TOKEN_E, cuerpo: { id: dia.id }, fecha: hoy });
  assert.equal(r.datos.estado, 'ganado');
  assert.equal(r.datos.resultado.nombre, dia.nombre);
  assert.ok(r.datos.todas.length > 0);
});

test('/api/hoy siempre manda quién era ayer (null el primer día)', async () => {
  const hoy = fechaDeHoy();
  const r = await api('/api/hoy', { token: TOKEN_D, fecha: hoy });
  const numeroHoy = r.datos.numero;
  if (numeroHoy <= 1) {
    assert.equal(r.datos.ayer, null);
  } else {
    const deAyer = jugadorDelDia(diaAnterior(hoy));
    assert.deepEqual(r.datos.ayer, { numero: numeroHoy - 1, nombre: deAyer.nombre });
  }

  // El primer día de todos (FECHA_INICIO) no tiene ayer.
  const primero = await api('/api/hoy', { token: TOKEN_D, fecha: entorno.FECHA_INICIO });
  assert.equal(primero.datos.ayer, null);
});

// Una fecha cuyo jugador tenga pistas de sobra para llegar al tope.
function fechaConMuchasPistas() {
  for (let i = 0; i < 120; i++) {
    const fecha = new Date(Date.parse('2026-12-01') + i * 86_400_000).toISOString().slice(0, 10);
    const total = [...categoriasDe(jugadorDelDia(fecha)).values()].reduce((n, items) => n + items.length, 0);
    if (total > MAX_PISTAS) return fecha;
  }
  throw new Error('ningún jugador de prueba tiene pistas de sobra');
}

// Pide pistas en el orden del catálogo hasta `cuantas`, sin pasarse de lo que tiene cada categoría.
function ordenDePistas(jugador, cuantas) {
  return [...categoriasDe(jugador)].flatMap(([id, items]) => items.map(() => id)).slice(0, cuantas);
}

test('el tope de pistas sale de la fórmula y deja el puntaje en el piso', () => {
  assert.equal(MAX_PISTAS, 9);
  assert.equal(puntaje(MAX_PISTAS), PUNTAJE_MINIMO);
  assert.ok(puntaje(MAX_PISTAS - 1) > PUNTAJE_MINIMO, 'una pista antes todavía vale más que el piso');
});

test('el servidor rechaza la pista que pasa el tope, aunque queden categorías', async () => {
  const token = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const fecha = fechaConMuchasPistas();
  const orden = ordenDePistas(jugadorDelDia(fecha), MAX_PISTAS + 1);
  let r;
  for (const categoria of orden.slice(0, MAX_PISTAS)) {
    r = await api('/api/pista', { token, fecha, cuerpo: { categoria } });
    assert.equal(r.status, 200);
  }
  assert.equal(r.datos.pedidas, MAX_PISTAS);
  assert.equal(r.datos.puntajeActual, PUNTAJE_MINIMO);
  assert.equal(r.datos.maxPistas, MAX_PISTAS);
  assert.ok(r.datos.disponibles.some((d) => d.quedan > 0), 'todavía hay categorías con pistas');

  r = await api('/api/pista', { token, fecha, cuerpo: { categoria: orden[MAX_PISTAS] } });
  assert.equal(r.status, 409);
  assert.equal(r.datos.error, 'sin_pistas');
  assert.match(r.datos.mensaje, /mínimo de 100 puntos/);
  assert.equal((await api('/api/hoy', { token, fecha })).datos.pedidas, MAX_PISTAS, 'no cambió nada');

  // Acertar en el tope vale el piso.
  r = await api('/api/adivinar', { token, fecha, cuerpo: { id: jugadorDelDia(fecha).id } });
  assert.equal(r.datos.estado, 'ganado');
  assert.equal(r.datos.puntaje, PUNTAJE_MINIMO);
});

test('una partida vieja con más pistas que el tope se sigue mostrando sin romperse', () => {
  const jugador = jugadorDelDia(fechaConMuchasPistas());
  const pedidas = ordenDePistas(jugador, MAX_PISTAS + 1);
  const vieja = { estado: 'jugando', pedidas: [...pedidas, ...pedidas], fallos: [] };
  const v = vistaBase(jugador, vieja);
  assert.equal(v.pedidas, vieja.pedidas.length);
  assert.ok(v.pedidas > v.maxPistas);
  assert.ok(v.reveladas.length >= MAX_PISTAS + 1, 'se ven todas las que ya había pedido');
  assert.equal(v.puntajeActual, PUNTAJE_MINIMO);
  assert.equal(v.puntajeSiguiente, PUNTAJE_MINIMO);
});
