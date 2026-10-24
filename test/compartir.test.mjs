// Solo la parte que se puede testear sin navegador: armado del texto y del objeto de datos. El
// dibujo en canvas (lib/compartir.js -> dibujarTarjeta) no se testea acá, necesita DOM.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TARJETA_ALTO, TARJETA_ANCHO, datosParaCompartir, formatearFecha, textoParaCompartir } from '../public/compartir.js';

const VISTA_GANADA = {
  numero: 7,
  fecha: '2026-10-24',
  estado: 'ganado',
  intentos: [{ id: 'Q1', nombre: 'Lionel Messi' }, { id: 'Q2', nombre: 'Diego Maradona' }],
  pedidas: 3,
  intentosMax: 3,
  puntaje: 700,
  racha: 5,
  resultado: { nombre: 'Ángel Di María', foto: 'https://x/foto.jpg', fotoPagina: 'https://x' },
};

const VISTA_PERDIDA = {
  numero: 8,
  fecha: '2026-10-25',
  estado: 'perdido',
  intentos: [{ id: 'Q1', nombre: 'Lionel Messi' }, { id: 'Q2', nombre: 'Diego Maradona' }, { id: 'Q3', nombre: 'Pelé' }],
  pedidas: 0,
  intentosMax: 3,
  puntaje: 0,
  racha: 0,
  // Partida de hoy perdida: el servidor ni manda resultado (ver lib/partida.js).
};

test('formatearFecha: ISO a DD/MM/AAAA', () => {
  assert.equal(formatearFecha('2026-10-24'), '24/10/2026');
  assert.equal(formatearFecha('rara'), 'rara');
});

test('datosParaCompartir: ganada, con intentos fallidos antes del acierto', () => {
  const d = datosParaCompartir(VISTA_GANADA);
  assert.equal(d.numero, 7);
  assert.equal(d.fecha, '2026-10-24');
  assert.equal(d.gano, true);
  assert.equal(d.resultado, 'Lo saqué en 3 intentos');
  assert.deepEqual(d.intentosUsados, ['fallido', 'fallido', 'acierto']);
  assert.equal(d.pistas, 3);
  assert.equal(d.puntaje, 700);
  assert.equal(d.racha, 5);
});

test('datosParaCompartir: ganada al primer intento, singular', () => {
  const d = datosParaCompartir({ ...VISTA_GANADA, intentos: [] });
  assert.equal(d.resultado, 'Lo saqué en 1 intento');
  assert.deepEqual(d.intentosUsados, ['acierto']);
});

test('datosParaCompartir: perdida', () => {
  const d = datosParaCompartir(VISTA_PERDIDA);
  assert.equal(d.gano, false);
  assert.equal(d.resultado, 'No lo saqué');
  assert.deepEqual(d.intentosUsados, ['fallido', 'fallido', 'fallido']);
  assert.equal(d.pistas, 0);
});

test('textoParaCompartir: formato completo, con racha', () => {
  const texto = textoParaCompartir(datosParaCompartir(VISTA_GANADA), 'https://crackdeldia.com');
  assert.equal(
    texto,
    [
      'Crack del Día Nº7',
      'Lo saqué en 3 intentos',
      'Pistas: 🟨🟨🟨',
      'Intentos: 🟥🟥🟩',
      '700 puntos · racha 5',
      'https://crackdeldia.com',
    ].join('\n'),
  );
});

test('textoParaCompartir: sin pistas pedidas y sin racha (racha 0 se omite)', () => {
  const texto = textoParaCompartir(datosParaCompartir(VISTA_PERDIDA), 'https://x');
  assert.match(texto, /^Crack del Día Nº8\nNo lo saqué\nPistas: sin pistas\nIntentos: 🟥🟥🟥\n0 puntos\nhttps:\/\/x$/);
  assert.ok(!texto.includes('racha'));
});

test('textoParaCompartir: los intentos no usados quedan en blanco (⬜)', () => {
  const vista = { ...VISTA_PERDIDA, intentos: [{ id: 'Q1', nombre: 'x' }] }; // perdió con 1 solo intento no tiene sentido
  // (no pasa en el juego real, pero sirve para probar el relleno de ⬜ con intentosMax > usados)
  const texto = textoParaCompartir(datosParaCompartir(vista), 'https://x');
  assert.match(texto, /Intentos: 🟥⬜⬜/);
});

test('el texto para compartir nunca incluye el nombre del jugador del día, ni siquiera ganando', () => {
  const texto = textoParaCompartir(datosParaCompartir(VISTA_GANADA), 'https://x');
  assert.ok(!texto.includes('Di María'));
  // Tampoco los nombres de los intentos fallidos (otros jugadores, pero por las dudas).
  assert.ok(!texto.includes('Messi'));
  assert.ok(!texto.includes('Maradona'));
});

test('el objeto de datosParaCompartir nunca trae el nombre/foto del jugador del día', () => {
  const d = datosParaCompartir(VISTA_GANADA);
  const plano = JSON.stringify(d);
  assert.ok(!plano.includes('Di María'));
  assert.ok(!plano.includes('foto'));
  assert.ok(!plano.includes('Messi'), 'ni los nombres de los intentos fallidos');
});

// Tamaño de story de Instagram. dibujarTarjeta no se testea acá (necesita un <canvas> real), pero
// usa estas mismas constantes para el tamaño del lienzo.
test('la tarjeta para stories mide 1080×1920', () => {
  assert.equal(TARJETA_ANCHO, 1080);
  assert.equal(TARJETA_ALTO, 1920);
});
