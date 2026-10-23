// Carga los jugadores (data/players.json, o el archivo de ejemplo si todavía no existe) y elige el del día.
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { construirIndice, elegirDelDia, esElegible, numeroDeDia } from './juego.js';

const DIR = new URL('../data/', import.meta.url);
// Para pruebas: PLAYERS_FILE=/ruta/a/otro.json usa ese archivo en lugar de data/players.json.
const ARCHIVO = process.env.PLAYERS_FILE ? pathToFileURL(process.env.PLAYERS_FILE) : null;

export const CONFIG = {
  // Secreta: define el orden de los jugadores. En producción ponela como variable de entorno.
  semilla: process.env.SEMILLA || 'semilla-de-desarrollo',
  // Día del Nº 1.
  fechaInicio: process.env.FECHA_INICIO || '2026-10-22',
  // Mínimo de idiomas de Wikipedia para que un jugador pueda salir como jugador del día.
  minPopularidad: Number(process.env.MIN_POPULARIDAD || 0),
  // Piso de fama según el grupo del jugador: así el del día es alguien que se pueda reconocer.
  // Los que quedan debajo siguen en el autocompletado. Ajustalo con MIN_POP_ARGENTINOS / _SUDAMERICANOS / _MUNDIALES.
  minPorOrigen: {
    Argentinos: Number(process.env.MIN_POP_ARGENTINOS || 35),
    Sudamericanos: Number(process.env.MIN_POP_SUDAMERICANOS || 55),
    'Estrellas mundiales': Number(process.env.MIN_POP_MUNDIALES || 80),
  },
};

const pisoDe = (j) => Math.max(CONFIG.minPopularidad, CONFIG.minPorOrigen[j.origen] ?? 0);

let cache;

export function datos() {
  if (cache) return cache;
  const real = ARCHIVO ?? new URL('players.json', DIR);
  const usaReal = existsSync(real);
  const lista = JSON.parse(readFileSync(usaReal ? real : new URL('players.sample.json', DIR), 'utf8'));
  cache = {
    lista,
    porId: new Map(lista.map((j) => [j.id, j])),
    indice: construirIndice(lista),
    elegibles: lista.filter((j) => esElegible(j, pisoDe(j))),
    ejemplo: !usaReal,
  };
  return cache;
}

export function jugadorDelDia(fecha) {
  const { elegibles } = datos();
  const jugador = elegirDelDia(elegibles, numeroDeDia(fecha, CONFIG.fechaInicio), CONFIG.semilla);
  if (!jugador) throw new Error('No hay jugadores elegibles en los datos.');
  return jugador;
}
