// Funciones puras de bajar-extras.mjs, con respuestas de Wikidata simuladas (sin red).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { armarExtras, armarLugarNacimiento, elegirApodo, elegirDorsal, limpiarLista, palmaresDeMundiales } from '../lib/extras.js';

test('elegirApodo prefiere español, después inglés, y descarta el propio nombre', () => {
  assert.equal(
    elegirApodo([{ idioma: 'en', valor: 'The Rocket' }, { idioma: 'es', valor: 'El Cohete' }], 'Juan Pérez'),
    'El Cohete',
  );
  assert.equal(elegirApodo([{ idioma: 'en', valor: 'The Rocket' }], 'Juan Pérez'), 'The Rocket');
  assert.equal(elegirApodo([{ idioma: 'fr', valor: 'La Fusée' }], 'Juan Pérez'), 'La Fusée');
  assert.equal(elegirApodo([{ idioma: 'es', valor: 'Juan Pérez' }], 'Juan Pérez'), null, 'es el mismo nombre');
  assert.equal(elegirApodo([{ idioma: 'es', valor: '  ' }], 'Juan Pérez'), null, 'vacío');
  assert.equal(elegirApodo([], 'Juan Pérez'), null);
  assert.equal(elegirApodo(null, 'Juan Pérez'), null);
});

test('limpiarLista saca vacíos y repetidos (comparando sin tildes ni mayúsculas) y mantiene el orden', () => {
  assert.deepEqual(limpiarLista(['Copa América 1991', '  ', 'COPA AMÉRICA 1991', 'Mundial 1986', null]), [
    'Copa América 1991',
    'Mundial 1986',
  ]);
  assert.deepEqual(limpiarLista(undefined), []);
});

test('armarLugarNacimiento junta ciudad y país, y se arregla si falta uno', () => {
  assert.equal(armarLugarNacimiento('Rosario', 'Argentina'), 'Rosario, Argentina');
  assert.equal(armarLugarNacimiento('Rosario', null), 'Rosario');
  assert.equal(armarLugarNacimiento(null, 'Argentina'), 'Argentina');
  assert.equal(armarLugarNacimiento(null, null), null);
  assert.equal(armarLugarNacimiento('', ''), null);
  // Algunas ciudades-estado de Wikidata tienen el mismo nombre para la ciudad y el país.
  assert.equal(armarLugarNacimiento('Singapur', 'Singapur'), 'Singapur');
});

test('elegirDorsal se queda con el número más repetido y, si empatan, el primero', () => {
  assert.equal(elegirDorsal(['10', '10', '7']), 10);
  assert.equal(elegirDorsal(['7', '10']), 7, 'empate: gana el primero');
  assert.equal(elegirDorsal(['abc', '-1', '300', '10']), 10, 'descarta valores que no son un dorsal válido');
  assert.equal(elegirDorsal([]), null);
  assert.equal(elegirDorsal(null), null);
});

test('palmaresDeMundiales marca "Campeón" solo si el ganador de esa edición coincide con su selección', () => {
  const eventos = [
    { anio: 2014, ganador: 'selección de fútbol de Alemania' },
    { anio: 2010, ganador: 'selección de fútbol de España' },
  ];
  assert.deepEqual(palmaresDeMundiales(eventos, ['selección de fútbol de España']), [
    'Campeón del Mundial 2010',
    'Mundial 2014',
  ]);
});

test('palmaresDeMundiales: orden cronológico y sin duplicar ediciones repetidas', () => {
  const eventos = [
    { anio: 2014, ganador: 'Alemania' },
    { anio: 2010, ganador: 'España' },
    { anio: 2010, ganador: 'España' }, // declarado dos veces en Wikidata
  ];
  assert.deepEqual(palmaresDeMundiales(eventos, ['selección de fútbol de España']), [
    'Campeón del Mundial 2010',
    'Mundial 2014',
  ]);
  assert.deepEqual(palmaresDeMundiales(eventos, []), ['Mundial 2010', 'Mundial 2014']);
  assert.deepEqual(palmaresDeMundiales([{ anio: null, ganador: 'España' }], []), [], 'sin año no se puede listar');
});

// ───────────── armarExtras: la fusión completa ─────────────

const JUGADOR = { id: 'Q1', nombre: 'Juan Pérez', selecciones: [{ equipo: 'selección de fútbol de España' }] };

test('armarExtras combina lo bajado de Wikidata y solo deja los campos con algo', () => {
  const bajado = {
    apodos: [{ idioma: 'es', valor: 'El Rifle' }],
    premios: ['Balón de Oro 2010'],
    ciudadNacimiento: 'Madrid',
    paisNacimiento: 'España',
    dorsales: ['9', '9'],
    mundiales: [{ anio: 2010, ganador: 'España' }],
  };
  const extras = armarExtras(JUGADOR, bajado, {});
  assert.deepEqual(extras, {
    apodo: 'El Rifle',
    palmares: ['Balón de Oro 2010', 'Campeón del Mundial 2010'],
    lugarNacimiento: 'Madrid, España',
    dorsal: 9,
  });
});

test('armarExtras sin nada bajado y sin manual no agrega ningún campo', () => {
  assert.deepEqual(armarExtras(JUGADOR, undefined, {}), {});
  assert.deepEqual(armarExtras(JUGADOR, { apodos: [], premios: [], dorsales: [], mundiales: [] }, {}), {});
});

test('armarExtras: la corrección manual gana, incluso para vaciar un campo (string vacío lo omite)', () => {
  const bajado = { apodos: [{ idioma: 'es', valor: 'El Rifle' }], premios: ['Balón de Oro 2010'] };
  const manual = { Q1: { apodo: 'El Matador', palmares: ['Recopa 1999'] } };
  const extras = armarExtras(JUGADOR, bajado, manual);
  assert.equal(extras.apodo, 'El Matador');
  assert.deepEqual(extras.palmares, ['Recopa 1999']);

  const vaciar = armarExtras(JUGADOR, bajado, { Q1: { apodo: '' } });
  assert.ok(!('apodo' in vaciar), 'un apodo manual vacío lo saca del todo');
});

test('armarExtras suma curiosidades solo desde el archivo manual (nunca se bajan de Wikidata)', () => {
  const manual = { Q1: { curiosidades: ['Metió un gol de arco a arco.', 'Metió un gol de arco a arco.', '  '] } };
  const extras = armarExtras(JUGADOR, {}, manual);
  assert.deepEqual(extras.curiosidades, ['Metió un gol de arco a arco.']);
});
