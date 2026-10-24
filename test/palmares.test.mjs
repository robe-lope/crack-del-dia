// Parser de palmarés (lib/palmares.js), sin red: contra HTML guardado. Los fixtures reales en
// test/fixtures/palmares/*.html son recortes de la sección "Palmarés" de artículos reales de
// es.wikipedia.org (bajados con la REST API), limpiados de imágenes y banderas.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'node-html-parser';
import { test } from 'node:test';
import { esSeleccion, extraerPalmares, fraseCampeon, nombreDeSeleccion, normalizarFilas } from '../lib/palmares.js';

const fixture = (nombre) => readFileSync(new URL(`fixtures/palmares/${nombre}.html`, import.meta.url), 'utf8');

// ───────────── Los 6 jugadores reales ─────────────

test('Ubaldo Fillol: el Mundial 78 aparece como selección, y Metropolitano/Nacional se agrupan por años', () => {
  const items = extraerPalmares(fixture('fillol'));
  assert.deepEqual(items, [
    'Campeón del Mundo con Argentina (1978)',
    'Supercopa Sudamericana con Racing Club (1988)',
    'Taça Guanabara con C. R. Flamengo (1984)',
    'Taça Río con C. R. Flamengo (1985)',
    'Campeonato Metropolitano con C. A. River Plate (1975, 1977, 1979)',
    'Campeonato Nacional con C. A. River Plate (1975, 1979, 1981)',
    'Campeonato de Primera División con C. A. River Plate (1980)',
    'Supercopa de España con Atlético de Madrid (1985)',
  ]);
});

test('Diego Maradona: selección (absoluta y sub-20) primero, después clubes, con tope de 10', () => {
  const items = extraerPalmares(fixture('maradona'));
  assert.equal(items.length, 10);
  assert.equal(items[0], 'Campeón del Mundo con Argentina (1986)');
  assert.ok(items.slice(0, 3).includes('Campeón del Mundo Sub-20 con Argentina (1979)'));
  assert.ok(items.some((i) => i.startsWith('Serie A con SSC Napoli')));
  // Las distinciones individuales (goleador, Balón de Oro juvenil...) quedan afuera: ya se llenaron
  // los 10 con selección y clubes, y las individuales van últimas en la prioridad.
  assert.ok(!items.some((i) => i.includes('goleador')));
});

test('Lionel Messi: dos Copa América (2021 y 2024) se agrupan aunque una fila no tenga wikilink', () => {
  const items = extraerPalmares(fixture('messi'));
  assert.equal(items[0], 'Campeón de América con Argentina (2021, 2024)');
  assert.equal(items[2], 'Campeón del Mundo con Argentina (2022)');
  assert.ok(!items.some((i) => i.includes('Selección de Argentina')), 'el nombre del equipo se limpia a "Argentina"');
});

test('Ángel Di María: también campeón del mundo 2022 (el caso que faltaba en Wikidata)', () => {
  const items = extraerPalmares(fixture('dimaria'));
  assert.ok(items.includes('Campeón del Mundo con Argentina (2022)'));
  assert.ok(items.includes('Campeón de América con Argentina (2021, 2024)'));
});

test('Roberto Carlos: campeón del mundo 2002 y de América, con las ediciones sub-20/olímpica separadas', () => {
  const items = extraerPalmares(fixture('robertocarlos'));
  assert.ok(items.includes('Campeón del Mundo con Brasil (2002)'));
  assert.equal(items[0], 'Campeón de América con Brasil (1997, 1999)');
  const iSub20 = items.findIndex((i) => i.includes('Sub-20'));
  const iClub = items.findIndex((i) => i.includes('Real Madrid'));
  assert.ok(iSub20 >= 0 && iClub >= 0 && iSub20 < iClub, 'selección va antes que los clubes');
});

test('Garrincha: campeón del mundo 1958 y 1962 agrupados en un solo ítem', () => {
  const items = extraerPalmares(fixture('garrincha'));
  assert.equal(items[0], 'Campeón del Mundo con Brasil (1958, 1962)');
  assert.ok(items.some((i) => i.startsWith('Campeonato Carioca con Botafogo')));
});

// ───────────── Casos generales ─────────────

test('sin sección "Palmarés" en la página, devuelve una lista vacía (no inventa nada)', () => {
  assert.deepEqual(extraerPalmares('<!doctype html><title>x</title><h2 id="Biografía">Biografía</h2><p>...</p>'), []);
  assert.deepEqual(extraerPalmares(''), []);
});

test('una tabla sin las columnas esperadas se descarta en vez de romper', () => {
  const html = `<!doctype html><title>x</title>
    <section><h2 id="Palmarés">Palmarés</h2>
      <section><h3>Rareza</h3>
        <table><tbody>
          <tr><th>Torneo</th><th>Resultado</th></tr>
          <tr><td>Algo</td><td>Finalista</td></tr>
        </tbody></table>
      </section>
    </section>`;
  assert.deepEqual(extraerPalmares(html), []);
});

test('nunca devuelve más de MAX_ITEMS (10), incluso con muchísimos títulos', () => {
  const filas = Array.from(
    { length: 15 },
    (_, i) => `<tr><td>Título ${i}</td><td>Club ${i}</td><td>País</td><td>${2000 + i}</td></tr>`,
  ).join('');
  const html = `<!doctype html><title>x</title>
    <section><h2 id="Palmarés">Palmarés</h2>
      <section><h3>Campeonatos nacionales</h3>
        <table><tbody>
          <tr><th>Título</th><th>Club</th><th>País</th><th>Año</th></tr>
          ${filas}
        </tbody></table>
      </section>
    </section>`;
  assert.equal(extraerPalmares(html).length, 10);
});

// ───────────── normalizarFilas: rowspan y colspan ─────────────

test('normalizarFilas repite una celda con rowspan en cada fila que ocupa', () => {
  const html = `<table><tbody>
    <tr><td rowspan="3">River Plate</td><td>1975</td></tr>
    <tr><td>1979</td></tr>
    <tr><td>1980</td></tr>
  </tbody></table>`;
  const tabla = parse(html).querySelector('table');
  const grilla = normalizarFilas(tabla);
  assert.equal(grilla.length, 3);
  assert.equal(grilla[0][0].texto, 'River Plate');
  assert.equal(grilla[1][0].texto, 'River Plate');
  assert.equal(grilla[2][0].texto, 'River Plate');
  assert.deepEqual(grilla.map((f) => f[1].texto), ['1975', '1979', '1980']);
});

test('normalizarFilas reparte una celda con colspan en varias columnas', () => {
  const html = `<table><tbody><tr><td colspan="2">Finalista</td><td>2010</td></tr></tbody></table>`;
  const tabla = parse(html).querySelector('table');
  const [fila] = normalizarFilas(tabla);
  assert.equal(fila[0].texto, 'Finalista');
  assert.equal(fila[1].texto, 'Finalista');
  assert.equal(fila[2].texto, '2010');
});

test('normalizarFilas descarta una fila divisora (un solo <th> dentro del cuerpo)', () => {
  const html = `<table><tbody>
    <tr><td>Premio A</td><td>2020</td></tr>
    <tr><th colspan="2">Sección</th></tr>
    <tr><td>Premio B</td><td>2021</td></tr>
  </tbody></table>`;
  const tabla = parse(html).querySelector('table');
  const grilla = normalizarFilas(tabla);
  assert.deepEqual(grilla.map((f) => (f ? f[0].texto : null)), ['Premio A', null, 'Premio B']);
});

test('normalizarFilas saca las notas al pie del texto', () => {
  const html = `<table><tbody><tr><td>Boca Juniors<sup class="mw-ref reference">[3]</sup></td></tr></tbody></table>`;
  const tabla = parse(html).querySelector('table');
  assert.equal(normalizarFilas(tabla)[0][0].texto, 'Boca Juniors');
});

// ───────────── Selección vs. club ─────────────

test('esSeleccion detecta el wikilink a la selección aunque el texto visible sea el nombre del país', () => {
  const celda = { texto: 'Argentina', enlace: { href: './Selección_de_fútbol_de_Argentina', title: 'Selección de fútbol de Argentina' } };
  assert.equal(esSeleccion(celda), true);
  assert.equal(esSeleccion({ texto: 'Boca Juniors', enlace: { href: './Club_Atlético_Boca_Juniors', title: 'Club Atlético Boca Juniors' } }), false);
});

test('esSeleccion también reconoce una celda sin wikilink, por el texto', () => {
  assert.equal(esSeleccion({ texto: 'Selección de Argentina', enlace: null }), true);
  assert.equal(esSeleccion({ texto: 'River Plate', enlace: null }), false);
});

// Regresión: en la página real, antes del wikilink a la selección va el de la banderita
// (<a href="./Archivo:Flag_of_Argentina...">), porque el ícono de la bandera también es un enlace.
// normalizarFilas tiene que saltarlo y quedarse con el enlace de contenido.
test('normalizarFilas no confunde el enlace de la banderita con el de la selección', () => {
  const html = `<table><tbody><tr><td>
      <span class="flagicon"><a href="./Archivo:Flag_of_Argentina.svg" title="Bandera de Argentina"><img/></a></span>
      <a href="./Selección_de_fútbol_de_Argentina" title="Selección de fútbol de Argentina">Argentina</a>
    </td></tr></tbody></table>`;
  const celda = normalizarFilas(parse(html).querySelector('table'))[0][0];
  assert.equal(celda.enlace.href, './Selección_de_fútbol_de_Argentina');
  assert.equal(esSeleccion(celda), true);
  assert.equal(nombreDeSeleccion(celda), 'Argentina');
});

test('nombreDeSeleccion saca el país del título del enlace, con o sin sub-categoría', () => {
  assert.equal(
    nombreDeSeleccion({ texto: 'Argentina', enlace: { title: 'Selección de fútbol de Argentina' } }),
    'Argentina',
  );
  assert.equal(
    nombreDeSeleccion({ texto: 'Argentina Sub-20', enlace: { title: 'Selección de fútbol sub-20 de Argentina' } }),
    'Argentina',
  );
  assert.equal(nombreDeSeleccion({ texto: 'Selección de Brasil', enlace: null }), 'Brasil');
});

// ───────────── Frases idiomáticas ─────────────

test('fraseCampeon reconoce los torneos de selección más comunes', () => {
  assert.equal(fraseCampeon('Copa Mundial de la FIFA'), 'Campeón del Mundo');
  assert.equal(fraseCampeon('Copa Mundial de Fútbol'), 'Campeón del Mundo');
  assert.equal(fraseCampeon('Copa Mundial Sub-20'), 'Campeón del Mundo Sub-20');
  assert.equal(fraseCampeon('Copa América'), 'Campeón de América');
  assert.equal(fraseCampeon('Juegos Olímpicos de Pekín'), 'Campeón Olímpico');
});

test('fraseCampeon cae a una frase genérica para un torneo que no está en la lista', () => {
  assert.equal(fraseCampeon('Copa Artemio Franchi'), 'Campeón de la Copa Artemio Franchi');
});
