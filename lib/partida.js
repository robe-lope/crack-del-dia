// Lo que pasa en una partida diaria. El servidor es el único que sabe quién es el jugador del día:
// al navegador solo le llegan las pistas básicas y las que ya se pidieron.
import { datos, jugadorDelDia, CONFIG } from './datos.js';
import { ErrorHttp } from './http.js';
import {
  COSTO_PISTA,
  INTENTOS_MAX,
  basicasDe,
  categoriasDe,
  diaAnterior,
  nombreCategoria,
  numeroDeDia,
  puntaje,
  resolverTexto,
} from './juego.js';
import * as store from './store.js';

async function cargar(fecha, token) {
  await store.crearPartida(fecha, token, Date.now());
  return store.obtenerPartida(fecha, token);
}

async function calcularRacha(token, fecha) {
  const ganadas = new Set((await store.historial(token)).filter((h) => h.estado === 'ganado').map((h) => h.fecha));
  let dia = ganadas.has(fecha) ? fecha : diaAnterior(fecha);
  let racha = 0;
  while (ganadas.has(dia)) {
    racha++;
    dia = diaAnterior(dia);
  }
  return racha;
}

// Lo que ve el navegador de una partida (diaria o de práctica).
// Nunca incluye el valor de una pista que no se pidió: mientras se juega, solo van las básicas
// (gratis) y los ítems ya revelados. De las categorías solo viaja cuántas pistas quedan.
export function vistaBase(jugador, partida) {
  const { porId, ejemplo } = datos();
  const dia = jugador;
  const pedidas = partida.pedidas ?? [];
  const categorias = categoriasDe(dia);
  const terminada = partida.estado !== 'jugando';

  // Cada pedido revela el próximo ítem de esa categoría, en el orden en el que se pidieron.
  const gastado = new Map();
  const reveladas = [];
  for (const id of pedidas) {
    const usados = gastado.get(id) ?? 0;
    const item = categorias.get(id)?.[usados];
    gastado.set(id, usados + 1);
    if (item) reveladas.push({ categoria: id, nombre: nombreCategoria(id), etiqueta: item.etiqueta, valor: item.valor });
  }

  const vista = {
    ejemplo,
    estado: partida.estado,
    basicas: basicasDe(dia),
    reveladas,
    // Para el modal: nombre y cuántas quedan, sin un solo valor. Las agotadas van con quedan: 0.
    disponibles: [...categorias].map(([id, items]) => ({
      id,
      nombre: nombreCategoria(id),
      quedan: items.length - (gastado.get(id) ?? 0),
    })),
    pedidas: pedidas.length,
    costoPista: COSTO_PISTA,
    intentos: partida.fallos.map((id) => ({ id, nombre: porId.get(id)?.nombre ?? '?' })),
    intentosMax: INTENTOS_MAX,
    // Nacionalidad: se ve desde el principio, no es una pista que se pida.
    pais: dia.nacionalidad ?? null,
    puntajeActual: terminada ? null : puntaje(pedidas.length),
    puntaje: terminada ? partida.puntaje : null,
  };

  if (terminada) {
    // Terminada la partida se muestra todo, marcando lo que no se llegó a usar.
    vista.todas = [...categorias].flatMap(([id, items]) =>
      items.map((item, i) => ({
        categoria: id,
        nombre: nombreCategoria(id),
        etiqueta: item.etiqueta,
        valor: item.valor,
        usada: i < (gastado.get(id) ?? 0),
      })),
    );
    vista.resultado = { nombre: dia.nombre, foto: dia.foto ?? null, fotoPagina: dia.fotoPagina ?? null };
  }
  return vista;
}

async function armarVista(fecha, token, partida) {
  return {
    ...vistaBase(jugadorDelDia(fecha), partida),
    fecha,
    numero: numeroDeDia(fecha, CONFIG.fechaInicio),
    apodo: await store.obtenerApodo(token),
    racha: await calcularRacha(token, fecha),
  };
}

// Interpreta lo que mandó la persona (un id de la lista o texto libre) y devuelve el id del jugador.
export function resolverElegido({ id, texto }) {
  const { porId, indice } = datos();
  if (typeof id === 'string' && id) {
    if (!porId.has(id)) throw new ErrorHttp(422, 'desconocido', 'Ese jugador no está en la lista.');
    return id;
  }
  const r = resolverTexto(texto, indice);
  if (r.tipo === 'ninguno') {
    throw new ErrorHttp(422, 'no_encontrado', 'No encontramos a ese jugador. Elegí uno de la lista que aparece al escribir.');
  }
  if (r.tipo === 'ambiguo') {
    throw new ErrorHttp(422, 'ambiguo', 'Hay más de un jugador con ese nombre. Elegí el que corresponde de la lista.');
  }
  return r.id;
}

// Aplica un intento a una partida en juego y devuelve la partida nueva (sin guardarla).
export function aplicarIntento(partida, jugador, elegido, ahora = Date.now()) {
  if (partida.fallos.includes(elegido)) throw new ErrorHttp(409, 'repetido', 'Ya probaste con ese jugador.');
  const pedidas = partida.pedidas ?? [];
  const nueva = { ...partida, pedidas: [...pedidas], fallos: [...partida.fallos] };
  if (elegido === jugador.id) {
    Object.assign(nueva, { estado: 'ganado', puntaje: puntaje(pedidas.length), fin: ahora });
  } else {
    // Equivocarse gasta un intento pero no revela pistas: eso solo lo hace el botón de pedir pista.
    nueva.fallos.push(elegido);
    if (nueva.fallos.length >= INTENTOS_MAX) Object.assign(nueva, { estado: 'perdido', puntaje: 0, fin: ahora });
  }
  return nueva;
}

// Revela la próxima pista de una categoría en una partida en juego (sin guardarla).
export function aplicarPista(partida, jugador, categoria) {
  const items = typeof categoria === 'string' ? categoriasDe(jugador).get(categoria) : null;
  if (!items) {
    throw new ErrorHttp(422, 'categoria', 'Esa categoría de pistas no existe para este jugador. Elegí una de la lista.');
  }
  const pedidas = partida.pedidas ?? [];
  if (pedidas.filter((c) => c === categoria).length >= items.length) {
    throw new ErrorHttp(409, 'agotada', `Ya pediste todas las pistas de ${nombreCategoria(categoria)}. Probá con otra categoría.`);
  }
  return { ...partida, pedidas: [...pedidas, categoria] };
}

export async function estadoDelDia(fecha, token) {
  return armarVista(fecha, token, await cargar(fecha, token));
}

export async function adivinar(fecha, token, entrada) {
  let partida = await cargar(fecha, token);
  if (partida.estado !== 'jugando') return armarVista(fecha, token, partida);

  const elegido = resolverElegido(entrada);
  const nueva = aplicarIntento(partida, jugadorDelDia(fecha), elegido);
  partida = (await store.guardarPartida(nueva)) ? nueva : await store.obtenerPartida(fecha, token);
  return armarVista(fecha, token, partida);
}

export async function pedirPista(fecha, token, categoria) {
  let partida = await cargar(fecha, token);
  if (partida.estado === 'jugando') {
    const nueva = aplicarPista(partida, jugadorDelDia(fecha), categoria);
    partida = (await store.guardarPartida(nueva)) ? nueva : await store.obtenerPartida(fecha, token);
  }
  return armarVista(fecha, token, partida);
}
