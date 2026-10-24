// Parser de palmarés (lib/palmares.js), sin red: contra HTML guardado. Los fixtures reales en
// test/fixtures/palmares/*.html son recortes de la sección "Palmarés" de artículos reales de
// es.wikipedia.org (bajados con la REST API), limpiados de imágenes y banderas.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'node-html-parser';
import { test } from 'node:test';
import { MAX_ITEMS, esSeleccion, extraerPalmares, fraseCampeon, nombreDeSeleccion, normalizarFilas } from '../lib/palmares.js';

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

test('Diego Maradona: selección (absoluta y sub-20) primero, con tope de 12 y sin perder sus Balón de Oro', () => {
  const items = extraerPalmares(fixture('maradona'));
  assert.equal(items.length, 12);
  assert.equal(items[0], 'Campeón del Mundo con Argentina (1986)');
  assert.ok(items.slice(0, 3).includes('Campeón del Mundo Sub-20 con Argentina (1979)'));
  assert.ok(items.some((i) => i.startsWith('Copa de la UEFA con SSC Napoli')));
  // Los Balón/Bota de Oro no se pierden entre los títulos de club, aunque una lista tan larga como la
  // de Maradona igual deja afuera distinciones menores (máximo goleador de un campeonato local, etc.).
  assert.ok(items.some((i) => i.startsWith('Balón de Oro de la Copa Mundial de Fútbol (')));
  assert.ok(!items.some((i) => i.startsWith('Máximo goleador del')));
});

test('Lionel Messi: dos Copa América (2021 y 2024) se agrupan aunque una fila no tenga wikilink', () => {
  const items = extraerPalmares(fixture('messi'));
  assert.equal(items[0], 'Campeón de la Copa América con Argentina (2021, 2024)');
  assert.equal(items[2], 'Campeón del Mundo con Argentina (2022)');
  assert.ok(!items.some((i) => i.includes('Selección de Argentina')), 'el nombre del equipo se limpia a "Argentina"');
  // Con 8 Balones de Oro, a Messi no se le pueden perder entre los títulos de club.
  assert.ok(items.some((i) => i.startsWith('Balón de Oro (')), 'el Balón de Oro "de siempre" sobrevive al tope');
});

test('Ángel Di María: también campeón del mundo 2022 (el caso que faltaba en Wikidata) y la Finalissima', () => {
  const items = extraerPalmares(fixture('dimaria'));
  assert.ok(items.includes('Campeón del Mundo con Argentina (2022)'));
  assert.ok(items.includes('Campeón de la Copa América con Argentina (2021, 2024)'));
  assert.ok(items.includes('Campeón de la Finalissima con Argentina (2022)'));
});

test('Roberto Carlos: campeón del mundo 2002 y de América, con artículo correcto en sub-20/preolímpico', () => {
  const items = extraerPalmares(fixture('robertocarlos'));
  assert.ok(items.includes('Campeón del Mundo con Brasil (2002)'));
  assert.equal(items[0], 'Campeón de la Copa América con Brasil (1997, 1999)');
  assert.ok(items.includes('Campeón del Sudamericano Sub-20 con Brasil (1991)'), '"del", no "de la Sudamericano"');
  assert.ok(items.includes('Campeón del Preolímpico Sudamericano con Brasil (1996)'));
  const iSub20 = items.findIndex((i) => i.includes('Sudamericano Sub-20'));
  const iClub = items.findIndex((i) => i.includes('Real Madrid'));
  assert.ok(iSub20 >= 0 && iClub >= 0 && iSub20 < iClub, 'selección va antes que los clubes');
});

test('Garrincha: campeón del mundo 1958 y 1962 agrupados en un solo ítem, con la Bota de Oro antes que los clubes', () => {
  const items = extraerPalmares(fixture('garrincha'));
  assert.equal(items[0], 'Campeón del Mundo con Brasil (1958, 1962)');
  const iBota = items.findIndex((i) => i.startsWith('Bota de Oro'));
  const iClub = items.findIndex((i) => i.startsWith('Campeonato Carioca con Botafogo'));
  assert.ok(iBota >= 0 && iClub >= 0 && iBota < iClub);
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

test('nunca devuelve más de MAX_ITEMS (12), incluso con muchísimos títulos', () => {
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
  assert.equal(MAX_ITEMS, 12);
  assert.equal(extraerPalmares(html).length, 12);
});

// Un distintivo de inferiores de un club no es un logro futbolístico: no debería aparecer.
test('descarta ítems poco informativos como "Título de Glorias de ..."', () => {
  const html = `<!doctype html><title>x</title>
    <section><h2 id="Palmarés">Palmarés</h2>
      <section><h3>Distinciones individuales</h3>
        <table><tbody>
          <tr><th>Distinción</th><th>Año</th></tr>
          <tr><td>Título de Glorias de Instituto de Córdoba</td><td>1998</td></tr>
          <tr><td>Balón de Oro</td><td>2015</td></tr>
        </tbody></table>
      </section>
    </section>`;
  assert.deepEqual(extraerPalmares(html), ['Balón de Oro (2015)']);
});

// Con un jugador que tiene muchísimos títulos de club, el Balón de Oro no se tiene que quedar afuera
// por el tope: los premios individuales más importantes van antes que los títulos de club.
test('a un jugador con muchos títulos de club no se le pierde el Balón de Oro', () => {
  const titulosDeClub = Array.from(
    { length: 11 },
    (_, i) => `<tr><td>Liga ${i}</td><td>Club Grande</td><td>País</td><td>${2000 + i}</td></tr>`,
  ).join('');
  const html = `<!doctype html><title>x</title>
    <section><h2 id="Palmarés">Palmarés</h2>
      <section><h3>Campeonatos nacionales</h3>
        <table><tbody>
          <tr><th>Título</th><th>Club</th><th>País</th><th>Año</th></tr>
          ${titulosDeClub}
        </tbody></table>
      </section>
      <section><h3>Distinciones individuales</h3>
        <table><tbody>
          <tr><th>Distinción</th><th>Año</th></tr>
          <tr><td>Balón de Oro</td><td>2015</td></tr>
          <tr><td>Máximo goleador de la liga</td><td>2016</td></tr>
        </tbody></table>
      </section>
    </section>`;
  const items = extraerPalmares(html);
  assert.equal(items.length, 12);
  assert.ok(items.includes('Balón de Oro (2015)'));
  assert.ok(!items.includes('Máximo goleador de la liga (2016)'), 'esta distinción menor sí se puede perder');
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
  assert.equal(fraseCampeon('Copa América'), 'Campeón de la Copa América');
  assert.equal(fraseCampeon('Juegos Olímpicos de Pekín'), 'Campeón Olímpico');
  assert.equal(fraseCampeon('Copa de Campeones Conmebol-UEFA'), 'Campeón de la Finalissima');
});

test('fraseCampeon cae a una frase genérica, con el artículo correcto según el nombre del torneo', () => {
  // "Copa X" es femenino: "de la Copa X".
  assert.equal(fraseCampeon('Copa Artemio Franchi'), 'Campeón de la Copa Artemio Franchi');
  // Un torneo nombrado solo (sin "Copa"/"Torneo" adelante) es masculino: "del X".
  assert.equal(fraseCampeon('Sudamericano Sub-20'), 'Campeón del Sudamericano Sub-20');
  assert.equal(fraseCampeon('Preolímpico Sudamericano'), 'Campeón del Preolímpico Sudamericano');
});

// Regresión: Wikipedia numera a mano los títulos repetidos del mismo tipo ("Ligue 1", "Ligue 1 (2)",
// "Ligue 1 (3)"...) en la columna "Título"; sin limpiar eso, cada edición queda como un ítem aparte.
test('títulos repetidos numerados a mano ("Ligue 1 (2)") se agrupan igual que el primero', () => {
  const html = `<!doctype html><title>x</title>
    <section><h2 id="Palmarés">Palmarés</h2>
      <section><h3>Campeonatos nacionales</h3>
        <table><tbody>
          <tr><th>Título</th><th>Club</th><th>País</th><th>Año</th></tr>
          <tr><td>Ligue 1</td><td>París Saint Germain</td><td>Francia</td><td>2013-14</td></tr>
          <tr><td>Ligue 1 (2)</td><td>París Saint Germain</td><td>Francia</td><td>2014-15</td></tr>
          <tr><td>Ligue 1 (3)</td><td>París Saint Germain</td><td>Francia</td><td>2015-16</td></tr>
        </tbody></table>
      </section>
    </section>`;
  assert.deepEqual(extraerPalmares(html), ['Ligue 1 con París Saint Germain (2013, 2014, 2015)']);
});
