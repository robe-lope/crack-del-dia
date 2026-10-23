import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  construirIndice,
  elegirDelDia,
  esElegible,
  fechaDeHoy,
  normalizar,
  numeroDeDia,
  pistasDe,
  puntaje,
  resolverTexto,
} from '../lib/juego.js';

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

test('el puntaje baja parejo: 1000 con la primera pista, 1000/N con la última', () => {
  assert.equal(puntaje(1, 10), 1000);
  assert.equal(puntaje(10, 10), 100);
  assert.ok(puntaje(4, 10) > puntaje(5, 10));
});

test('las pistas siguen el orden del programa y se omiten si falta el dato', () => {
  const completo = {
    posicion: 'Delantero', alturaCm: 182, debut: 1999, retiro: 2012, titulo: 'Clausura 2004', debutSeleccion: 2001,
    carrera: [{ club: 'A', desde: 1999, hasta: 2003 }, { club: 'B', desde: 2003, hasta: 2012 }],
  };
  assert.deepEqual(
    pistasDe(completo).map((p) => p.tipo),
    ['posicion', 'altura', 'debut', 'retiro', 'titulo', 'seleccion', 'club', 'club'],
  );
  assert.equal(pistasDe(completo)[1].valor, '1,82');

  const incompleto = { debut: 1999, retiro: 2012, retiroIncompleto: true, carrera: [{ club: 'A', desde: 1999, hasta: 2003 }] };
  assert.deepEqual(pistasDe(incompleto).map((p) => p.tipo), ['debut', 'club']);
});

test('un jugador activo muestra "—" en el retiro', () => {
  const p = pistasDe({ debut: 2004, activo: true, carrera: [] }).find((x) => x.tipo === 'retiro');
  assert.equal(p.valor, '—');
});

test('los pasos por un mismo club se juntan en una sola pista', () => {
  const p = pistasDe({
    debut: 1996,
    carrera: [{ club: 'Boca', desde: 1996, hasta: 2002 }, { club: 'Villarreal', desde: 2003, hasta: 2007 }, { club: 'Boca', desde: 2007, hasta: 2014 }],
  }).filter((x) => x.tipo === 'club');
  assert.equal(p.length, 2);
  assert.equal(p[0].valor, 'Boca 1996–2002 y 2007–2014');
});

test('solo sale como jugador del día quien tiene datos suficientes', () => {
  const bueno = { jugable: true, debut: 1990, popularidad: 50, posicion: 'Defensor', alturaCm: 180, retiro: 2005, carrera: [{ club: 'A', desde: 1990, hasta: 2005 }] };
  assert.ok(esElegible(bueno));
  assert.ok(!esElegible({ ...bueno, jugable: false }));
  assert.ok(!esElegible(bueno, 60));
  assert.ok(!esElegible({ ...bueno, posicion: null, alturaCm: null, carrera: [] }));
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

test('esElegible descarta a los jugadores marcados como excluidos', async () => {
  const { esElegible } = await import('../lib/juego.js');
  const base = { jugable: true, debut: 2000, popularidad: 50, posicion: 'Delantero', alturaCm: 180, retiro: 2015, debutSeleccion: 2002, carrera: [{ club: 'A', desde: 2000, hasta: 2005 }, { club: 'B', desde: 2005, hasta: 2010 }] };
  assert.equal(esElegible(base), true);
  assert.equal(esElegible({ ...base, excluir: true }), false);
});
