import assert from 'node:assert/strict';
import test from 'node:test';
import { elegirNacionalidad } from '../lib/nacionalidad.js';

const sel = (...equipos) => equipos.map((equipo) => ({ equipo }));

test('con una sola ciudadanía, es esa', () => {
  const n = elegirNacionalidad([{ codigo: 'AR', nombre: 'Argentina' }], { id: 'Q1', selecciones: sel('selección de fútbol de Argentina') });
  assert.deepEqual(n, { codigo: 'ar', nombre: 'Argentina' });
});

test('con varias, gana la selección en la que jugó (Diego Costa: Brasil y España)', () => {
  const n = elegirNacionalidad(
    [{ codigo: 'BR', nombre: 'Brasil' }, { codigo: 'ES', nombre: 'España' }],
    { id: 'Q2', selecciones: sel('selección de fútbol de Brasil', 'selección de fútbol de España') },
  );
  assert.equal(n.codigo, 'br', 'si jugó en las dos, queda la primera ciudadanía que coincide');
  const soloEspana = elegirNacionalidad(
    [{ codigo: 'BR', nombre: 'Brasil' }, { codigo: 'ES', nombre: 'España' }],
    { id: 'Q2', selecciones: sel('selección de fútbol de España') },
  );
  assert.equal(soloEspana.codigo, 'es');
});

test('sin selección, un argentino queda argentino aunque tenga otra ciudadanía', () => {
  const n = elegirNacionalidad(
    [{ codigo: 'IT', nombre: 'Italia' }, { codigo: 'AR', nombre: 'Argentina' }],
    { id: 'Q3', origen: 'Argentinos', selecciones: [] },
  );
  assert.equal(n.codigo, 'ar');
});

test('Reino Unido se resuelve por la selección: Inglaterra, Escocia, Gales o Irlanda del Norte', () => {
  const gb = [{ codigo: 'GB', nombre: 'Reino Unido' }];
  assert.equal(elegirNacionalidad(gb, { id: 'Q4', selecciones: sel('selección de fútbol de Inglaterra') }).codigo, 'gb-eng');
  assert.equal(elegirNacionalidad(gb, { id: 'Q5', selecciones: sel('selección de fútbol de Escocia') }).nombre, 'Escocia');
  assert.equal(elegirNacionalidad(gb, { id: 'Q6', selecciones: sel('selección de fútbol de Gales') }).codigo, 'gb-wls');
  assert.equal(elegirNacionalidad(gb, { id: 'Q7', selecciones: sel('selección de fútbol de Irlanda del Norte') }).codigo, 'gb-nir');
  assert.equal(elegirNacionalidad(gb, { id: 'Q8', selecciones: [] }).codigo, 'gb');
});

test('un país sin código (Yugoslavia) deja al jugador sin bandera, y el archivo manual lo arregla', () => {
  const cand = [{ codigo: null, nombre: 'Yugoslavia' }];
  assert.equal(elegirNacionalidad(cand, { id: 'Q9', selecciones: [] }), null);
  assert.deepEqual(elegirNacionalidad(cand, { id: 'Q9', selecciones: [] }, { Q9: ['rs', 'Serbia'] }), { codigo: 'rs', nombre: 'Serbia' });
});
