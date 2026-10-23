// Lo que pasa en una partida diaria. El servidor es el único que sabe quién es el jugador del día:
// al navegador solo le llegan las pistas que ya se abrieron.
import { datos, jugadorDelDia, CONFIG } from './datos.js';
import { ErrorHttp } from './http.js';
import { INTENTOS_MAX, diaAnterior, numeroDeDia, pistasDe, puntaje, resolverTexto } from './juego.js';
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

// Lo que ve el navegador de una partida (diaria o de práctica). Solo incluye las pistas ya abiertas.
export function vistaBase(jugador, partida) {
  const { porId, ejemplo } = datos();
  const dia = jugador;
  const pistas = pistasDe(dia);
  const total = pistas.length;
  const usadas = Math.min(partida.pistas, total);
  const terminada = partida.estado !== 'jugando';

  const vista = {
    ejemplo,
    estado: partida.estado,
    totalPistas: total,
    pistasUsadas: usadas,
    pistas: terminada ? pistas : pistas.slice(0, usadas),
    pendientes: terminada ? [] : pistas.slice(usadas).map(({ tipo, etiqueta }) => ({ tipo, etiqueta })),
    intentos: partida.fallos.map((id) => ({ id, nombre: porId.get(id)?.nombre ?? '?' })),
    intentosMax: INTENTOS_MAX,
    // Nacionalidad: se ve desde el principio, no es una pista que se abra.
    pais: dia.nacionalidad ?? null,
    puntajeActual: terminada ? null : puntaje(usadas, total),
    puntaje: terminada ? partida.puntaje : null,
  };

  if (terminada) {
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
  const total = pistasDe(jugador).length;
  const usadas = Math.min(partida.pistas, total);
  const nueva = { ...partida, fallos: [...partida.fallos], pistas: usadas };
  if (elegido === jugador.id) {
    Object.assign(nueva, { estado: 'ganado', puntaje: puntaje(usadas, total), fin: ahora });
  } else {
    // Equivocarse gasta un intento pero no abre pistas: eso solo lo hace el botón de pedir pista.
    nueva.fallos.push(elegido);
    if (nueva.fallos.length >= INTENTOS_MAX) Object.assign(nueva, { estado: 'perdido', puntaje: 0, fin: ahora });
  }
  return nueva;
}

// Abre la próxima pista de una partida en juego (sin guardarla).
export function aplicarPista(partida, jugador) {
  if (partida.pistas >= pistasDe(jugador).length) {
    throw new ErrorHttp(409, 'sin_pistas', 'Ya se abrieron todas las pistas. Arriesgá con lo que tenés.');
  }
  return { ...partida, pistas: partida.pistas + 1 };
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

export async function pedirPista(fecha, token) {
  let partida = await cargar(fecha, token);
  if (partida.estado === 'jugando') {
    const nueva = aplicarPista(partida, jugadorDelDia(fecha));
    partida = (await store.guardarPartida(nueva)) ? nueva : await store.obtenerPartida(fecha, token);
  }
  return armarVista(fecha, token, partida);
}
