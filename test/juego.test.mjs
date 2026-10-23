import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CATEGORIAS,
  basicasDe,
  categoriasDe,
  construirIndice,
  elegirDelDia,
  esElegible,
  fechaDeHoy,
  normalizar,
  numeroDeDia,
  puntaje,
  resolverTexto,
} from '../lib/juego.js';

const COMPLETO = {
  posicion: 'Delantero',
  alturaCm: 182,
  debut: 1999,
  retiro: 2012,
  titulo: 'Clausura 2004',
  debutSeleccion: 2001,
  apodo: 'El Pipa',
  palmares: ['Copa Libertadores 2000', 'Clausura 2004'],
  lugarNacimiento: 'Rosario, Argentina',
  dorsal: 9,
  curiosidades: ['Metió un gol de media cancha.'],
  carrera: [
    { club: 'A', desde: 1999, hasta: 2003 },
    { club: 'B', desde: 2003, hasta: 2012 },
  ],
};

test('normalizar ignora tildes, mayúsculas y signos', () => {
  assert.equal(normalizar('Ángel Di María'), 'angel di maria');
  assert.equal(normalizar("  Newell's  Old-Boys "), 'newell s old boys');
  assert.equal(normalizar(null), '');
});

test('el día cambia a las 00:00 de Argentina (UTC-3)', () => {
  assert.equal(fechaDeHoy(Date.parse('2026-10-22T02:59:59Z')), '2026-10-21');
  assert.equal(fechaDeHoy(Date.parse('2026-10-22T03:00:00Z')), '2026-10-22');
});

test('numeroDeDia arranca en 1 y nunca baja de 1', () => {
  assert.equal(numeroDeDia('2026-10-22', '2026-10-22'), 1);
  assert.equal(numeroDeDia('2026-11-01', '2026-10-22'), 11);
  assert.equal(numeroDeDia('2026-01-01', '2026-10-22'), 1);
});

// ───────────── Pistas básicas ─────────────

test('las básicas van en orden y no cuestan: posición, altura, debut, retiro, selección', () => {
  assert.deepEqual(
    basicasDe(COMPLETO).map((b) => b.tipo),
    ['posicion', 'altura', 'debut', 'retiro', 'seleccion'],
  );
  assert.equal(basicasDe(COMPLETO)[1].valor, '1,82');
  // El título dejó de ser una básica: ahora es palmarés.
  assert.ok(!basicasDe(COMPLETO).some((b) => b.tipo === 'titulo'));
});

test('el retiro se omite si está incompleto y la selección si nunca debutó', () => {
  const incompleto = { posicion: 'Volante', alturaCm: 175, debut: 1999, retiro: 2012, retiroIncompleto: true };
  assert.deepEqual(basicasDe(incompleto).map((b) => b.tipo), ['posicion', 'altura', 'debut']);

  const sinSeleccion = { ...COMPLETO, debutSeleccion: null };
  assert.ok(!basicasDe(sinSeleccion).some((b) => b.tipo === 'seleccion'));

  assert.deepEqual(basicasDe({ debut: 1990 }).map((b) => b.tipo), ['debut']);
});

test('un jugador activo muestra "—" en el retiro', () => {
  const b = basicasDe({ debut: 2004, activo: true }).find((x) => x.tipo === 'retiro');
  assert.equal(b.valor, '—');
});

// ───────────── Categorías ─────────────

test('cada categoría devuelve sus ítems y las vacías no aparecen', () => {
  const c = categoriasDe(COMPLETO);
  assert.deepEqual([...c.keys()], ['carrera', 'apodo', 'palmares', 'nacimiento', 'dorsal', 'curiosidades']);
  assert.deepEqual(c.get('apodo'), [{ etiqueta: 'Apodo', valor: 'El Pipa' }]);
  assert.deepEqual(c.get('nacimiento'), [{ etiqueta: 'Nació en', valor: 'Rosario, Argentina' }]);
  assert.deepEqual(c.get('dorsal'), [{ etiqueta: 'Dorsal', valor: '9' }]);
  assert.equal(c.get('curiosidades').length, 1);

  // Solo con carrera: el resto de las categorías no existe para ese jugador.
  const pelado = categoriasDe({ debut: 1990, carrera: [{ club: 'A', desde: 1990, hasta: 2000 }] });
  assert.deepEqual([...pelado.keys()], ['carrera']);
});

test('el palmarés junta el título cargado a mano y no repite', () => {
  const items = categoriasDe(COMPLETO).get('palmares');
  assert.deepEqual(items.map((i) => i.valor), ['Clausura 2004', 'Copa Libertadores 2000']);
  assert.ok(items.every((i) => i.etiqueta === 'Palmarés'));
  // Vacíos y repetidos se descartan.
  assert.equal(categoriasDe({ palmares: ['  ', 'Copa', 'Copa', null] }).get('palmares').length, 1);
});

test('la carrera junta los pasos por un mismo club y numera los clubes', () => {
  const items = categoriasDe({
    carrera: [
      { club: 'Boca', desde: 1996, hasta: 2002 },
      { club: 'Villarreal', desde: 2003, hasta: 2007 },
      { club: 'Boca', desde: 2007, hasta: 2014 },
    ],
  }).get('carrera');
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { etiqueta: '1°', valor: 'Boca 1996–2002 y 2007–2014' });
  assert.equal(items[1].etiqueta, '2°');
});

test('la carrera corta en 8 clubes', () => {
  const carrera = Array.from({ length: 12 }, (_, i) => ({ club: `C${i}`, desde: 2000 + i, hasta: 2001 + i }));
  assert.equal(categoriasDe({ carrera }).get('carrera').length, 8);
});

test('el catálogo de categorías está en un solo lugar y cada entrada sabe armar sus ítems', () => {
  for (const c of CATEGORIAS) {
    assert.equal(typeof c.id, 'string');
    assert.equal(typeof c.nombre, 'string');
    assert.equal(typeof c.items, 'function');
    assert.deepEqual(c.items({}), [], `${c.id} sin datos no devuelve ítems`);
  }
  assert.equal(new Set(CATEGORIAS.map((c) => c.id)).size, CATEGORIAS.length, 'no hay ids repetidos');
});

// ───────────── Puntaje ─────────────

test('el puntaje es fijo: 1000 sin pistas, -100 por pista, con piso de 100', () => {
  assert.equal(puntaje(0), 1000);
  assert.equal(puntaje(1), 900);
  assert.equal(puntaje(2), 800);
  assert.equal(puntaje(3), 700);
  assert.equal(puntaje(9), 100);
  assert.equal(puntaje(10), 100);
  assert.equal(puntaje(25), 100);
});

// ───────────── Elegibles ─────────────

test('solo sale como jugador del día quien tiene datos suficientes', () => {
  const bueno = {
    jugable: true,
    debut: 1990,
    popularidad: 50,
    posicion: 'Defensor',
    alturaCm: 180,
    retiro: 2005,
    carrera: [{ club: 'A', desde: 1990, hasta: 2005 }],
  };
  assert.ok(esElegible(bueno));
  assert.ok(!esElegible({ ...bueno, jugable: false }));
  assert.ok(!esElegible(bueno, 60), 'no llega al piso de fama');
  assert.ok(!esElegible({ ...bueno, posicion: null, alturaCm: null }), 'le quedan menos de 3 básicas');
  assert.ok(!esElegible({ ...bueno, carrera: [] }), 'sin una sola categoría no habría nada que pedir');
});

test('esElegible descarta a los jugadores marcados como excluidos', () => {
  const base = {
    jugable: true,
    debut: 2000,
    popularidad: 50,
    posicion: 'Delantero',
    alturaCm: 180,
    retiro: 2015,
    debutSeleccion: 2002,
    carrera: [{ club: 'A', desde: 2000, hasta: 2005 }],
  };
  assert.equal(esElegible(base), true);
  assert.equal(esElegible({ ...base, excluir: true }), false);
});

test('el jugador del día es siempre el mismo para la misma fecha y no se repite en toda la vuelta', () => {
  const lista = Array.from({ length: 30 }, (_, i) => ({ id: `Q${i}` }));
  const a = elegirDelDia(lista, 5, 'semilla');
  assert.equal(a.id, elegirDelDia([...lista].reverse(), 5, 'semilla').id);
  const vistos = new Set(Array.from({ length: 30 }, (_, i) => elegirDelDia(lista, i + 1, 'semilla').id));
  assert.equal(vistos.size, 30);
  assert.equal(elegirDelDia(lista, 31, 'semilla').id, elegirDelDia(lista, 1, 'semilla').id);
  const otra = Array.from({ length: 30 }, (_, i) => elegirDelDia(lista, i + 1, 'otra').id);
  const misma = Array.from({ length: 30 }, (_, i) => elegirDelDia(lista, i + 1, 'semilla').id);
  assert.notDeepEqual(otra, misma);
});

test('lo que escribe la persona se resuelve por nombre o apodo, y avisa si es ambiguo', () => {
  const indice = construirIndice([
    { id: 'A', nombre: 'Ángel Di María', alias: ['Fideo'] },
    { id: 'B', nombre: 'Juan Pérez', alias: [] },
    { id: 'C', nombre: 'Juan Perez', alias: [] },
  ]);
  assert.deepEqual(resolverTexto('angel di maria', indice), { tipo: 'uno', id: 'A' });
  assert.deepEqual(resolverTexto('FIDEO', indice), { tipo: 'uno', id: 'A' });
  assert.deepEqual(resolverTexto('juan perez', indice), { tipo: 'ambiguo' });
  assert.deepEqual(resolverTexto('nadie', indice), { tipo: 'ninguno' });
});
