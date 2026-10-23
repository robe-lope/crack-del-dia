// Modo práctica: un jugador al azar según el grupo y la dificultad elegidos. No tiene ranking ni racha.
import { randomInt, randomUUID } from 'node:crypto';
import { continenteDe } from './continentes.js';
import { datos } from './datos.js';
import { ErrorHttp } from './http.js';
import { esElegible } from './juego.js';
import { aplicarIntento, aplicarPista, resolverElegido, vistaBase } from './partida.js';
import * as store from './store.js';

export const GRUPOS = [
  { id: 'todos', nombre: 'Todos' },
  { id: 'argentina', nombre: 'Argentinos' },
  { id: 'sudamerica', nombre: 'Sudamérica' },
  { id: 'europa', nombre: 'Europa' },
];

export const DIFICULTADES = [
  { id: 'facil', nombre: 'Fácil', detalle: 'Los más famosos' },
  { id: 'medio', nombre: 'Medio', detalle: 'Los conocidos' },
  { id: 'dificil', nombre: 'Difícil', detalle: 'Los que cuestan' },
  { id: 'todas', nombre: 'Mezcla', detalle: 'De todo un poco' },
];

function perteneceAlGrupo(j, grupo) {
  const codigo = j.nacionalidad?.codigo;
  if (grupo === 'todos') return true;
  if (grupo === 'argentina') return codigo ? codigo === 'ar' : j.origen === 'Argentinos';
  if (grupo === 'sudamerica') return continenteDe(codigo) === 'sudamerica';
  if (grupo === 'europa') return continenteDe(codigo) === 'europa';
  return false;
}

let cachePozos;
export function pozoDe(grupo, dificultad) {
  const clave = `${grupo}|${dificultad}`;
  cachePozos ??= new Map();
  if (cachePozos.has(clave)) return cachePozos.get(clave);

  // Cualquier jugador con datos suficientes, sin el piso de fama del diario.
  const base = datos().lista
    .filter((j) => esElegible(j, 0) && perteneceAlGrupo(j, grupo))
    .sort((a, b) => (b.popularidad ?? 0) - (a.popularidad ?? 0) || a.id.localeCompare(b.id));

  // La dificultad se mide dentro del grupo elegido: tercio más famoso, del medio y menos famoso.
  let pozo = base;
  if (dificultad !== 'todas' && base.length >= 3) {
    const t = Math.ceil(base.length / 3);
    pozo = dificultad === 'facil' ? base.slice(0, t) : dificultad === 'medio' ? base.slice(t, 2 * t) : base.slice(2 * t);
  }
  cachePozos.set(clave, pozo);
  return pozo;
}

export function opciones() {
  return {
    grupos: GRUPOS.map((g) => ({ ...g, cantidad: pozoDe(g.id, 'todas').length })),
    dificultades: DIFICULTADES,
  };
}

function vistaPractica(p) {
  const jugador = datos().porId.get(p.jugador);
  return {
    ...vistaBase(jugador, p),
    modo: 'practica',
    partida: p.id,
    grupo: p.grupo,
    dificultad: p.dificultad,
  };
}

export async function estado(token) {
  const actual = await store.practicaEnCurso(token);
  return { partida: actual ? vistaPractica(actual) : null, ...opciones() };
}

export async function nueva(token, { grupo = 'todos', dificultad = 'todas' }) {
  if (!GRUPOS.some((g) => g.id === grupo) || !DIFICULTADES.some((d) => d.id === dificultad)) {
    throw new ErrorHttp(422, 'opcion', 'Elegí un grupo y una dificultad de la lista.');
  }
  const pozo = pozoDe(grupo, dificultad);
  if (!pozo.length) throw new ErrorHttp(422, 'sin_jugadores', 'No hay jugadores con esa combinación. Probá con otra.');

  const vistos = new Set(await store.jugadoresPracticados(token));
  const nuevos = pozo.filter((j) => !vistos.has(j.id));
  const candidatos = nuevos.length ? nuevos : pozo; // si ya los jugó a todos, vuelven a salir
  const jugador = candidatos[randomInt(candidatos.length)];

  const p = { id: randomUUID(), token, jugador: jugador.id, grupo, dificultad, inicio: Date.now() };
  await store.crearPractica(p);
  return vistaPractica(await store.obtenerPractica(p.id, token));
}

async function cargar(id, token) {
  const p = typeof id === 'string' ? await store.obtenerPractica(id, token) : null;
  if (!p) throw new ErrorHttp(404, 'no_existe', 'Esa partida de práctica ya no existe. Empezá otra.');
  return p;
}

async function guardar(nueva, token) {
  return (await store.guardarPractica(nueva)) ? nueva : store.obtenerPractica(nueva.id, token);
}

export async function adivinar(token, { partida: id, ...entrada }) {
  let p = await cargar(id, token);
  if (p.estado === 'jugando') {
    const nueva = aplicarIntento(p, datos().porId.get(p.jugador), resolverElegido(entrada));
    p = await guardar(nueva, token);
  }
  return vistaPractica(p);
}

export async function pedirPista(token, { partida: id, categoria }) {
  let p = await cargar(id, token);
  if (p.estado === 'jugando') {
    p = await guardar(aplicarPista(p, datos().porId.get(p.jugador), categoria), token);
  }
  return vistaPractica(p);
}
