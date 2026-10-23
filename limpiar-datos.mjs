// limpiar-datos.mjs
// Toma el players.json que baja bajar-jugadores.mjs y deja uno listo para el juego.
// No necesita internet. Uso:   node limpiar-datos.mjs players.json data/players.json
//
// Qué corrige:
//  - Años imposibles (por ejemplo el año "1" de Roberto Carlos).
//  - Pasos por clubes de cuando eran chicos (Maradona en Argentinos desde los 9 años) y por equipos filiales (Benfica B).
//  - Pasos que arrancan a los 46 años o más: son errores de Wikidata (un paso por Unión en 2026 para un jugador de 52).
//  - Recalcula debut, retiro y si sigue en actividad con lo que quedó.
//  - Reclasifica la posición (guardameta, lateral, volante...).
//  - Acorta los nombres de los clubes ("Club Atlético River Plate" -> "River Plate").
//  - Marca con "excluir" a quienes no conviene que salgan como jugador del día.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [entrada = 'players.json', salida = 'data/players.json'] = process.argv.slice(2);

const ANIO_ACTUAL = new Date().getFullYear();
const EDAD_ACTIVO_MAXIMA = 41; // si tiene un club sin fecha de fin y es más joven que esto, sigue en actividad
const EDAD_MINIMA_PRIMER_CLUB = 15;
const EDAD_MAXIMA_INICIO_PASO = 45;

// ───────────── Nombres de clubes ─────────────
// Lo que la regla general no resuelve bien. Agregá acá los que veas raros.
const CLUBES_MANUAL = {
  'Racing Club': 'Racing',
  'Fútbol Club Oporto': 'Porto',
  'Grêmio Foot-Ball Porto Alegrense': 'Grêmio',
  'Sport Lisboa e Benfica': 'Benfica',
  'Club de Regatas Vasco da Gama': 'Vasco da Gama',
  'Clube de Regatas do Flamengo': 'Flamengo',
  'Botafogo de Futebol e Regatas': 'Botafogo',
  'Sport Club Corinthians Paulista': 'Corinthians',
  'Real Club Deportivo Espanyol de Barcelona': 'Espanyol',
  'Real Club Deportivo de A Coruña': 'Deportivo La Coruña',
  'Sporting Clube de Portugal': 'Sporting CP',
  'Ajax de Ámsterdam': 'Ajax',
  'Deportivo Independiente Medellín': 'Independiente Medellín',
  'Club Atlas de Guadalajara': 'Atlas',
  'Instituto Atlético Central Córdoba': 'Instituto',
  'Tigres de la UANL': 'Tigres',
  'Associação Portuguesa de Desportos': 'Portuguesa',
  'Barcelona Sporting Club': 'Barcelona de Guayaquil',
  'Real Betis Balompié': 'Betis',
  'Bayer 04 Leverkusen': 'Bayer Leverkusen',
  'F. C. Bayern Múnich': 'Bayern Múnich',
  'A.C. Milan': 'Milan',
  'Genoa Cricket & Football Club': 'Genoa',
  'Associazione Calcio ChievoVerona': 'Chievo',
  'Montpellier Hérault Sport Club': 'Montpellier',
  'Royal Sporting Club Anderlecht': 'Anderlecht',
  'Real Sporting de Gijón': 'Sporting de Gijón',
  'Sporting Clube de Braga': 'Braga',
  'Vitória Sport Clube': 'Vitória de Guimarães',
  'Asociación Mutual Social y Deportiva Atlético de Rafaela': 'Atlético de Rafaela',
  'Clube de Futebol Os Belenenses': 'Belenenses',
  'Athletic Club Ajaccien': 'Ajaccio',
  'Athletic Club Sparta Praga': 'Sparta Praga',
  'Stade Français Football': 'Stade Français',
  'Association Sportive de Cannes Football': 'Cannes',
  'Nacional Fast Clube': 'Nacional (AM)',
  'Levante Unión Deportiva': 'Levante',
  'Association Sportive Nancy-Lorraine': 'Nancy',
  'Swansea City Association': 'Swansea City',
  'Leeds United Association': 'Leeds United',
  'Union Sportive de Boulogne': 'Boulogne',
  'Sociedad Deportiva Eibar': 'Eibar',
  'F. K. Partizan Belgrado': 'Partizan',
  'Association de la Jeunesse Auxerroise': 'Auxerre',
  'Beşiktaş Jimnastik Kulübü': 'Beşiktaş',
  'Sociedad Deportiva Aucas': 'Aucas',
  'Liga Deportiva Universitaria de Quito': 'LDU de Quito',
  'Associação Atlética Ponte Preta': 'Ponte Preta',
  'Associação Atlética Portuguesa': 'Portuguesa',
  'Futebol Clube de Alverca': 'Alverca',
};

// Los más largos primero: se usa el primero que coincide.
const PREFIJOS = [
  'Club Social y Deportivo ', 'Club Atlético ', 'Club Atletico ', 'Club Deportivo ', 'Club de Fútbol ', 'Club de Futbol ',
  'Club de ', 'Club ', 'Asociación Atlética ', 'Asociación Deportiva ', 'Associação Desportiva ', 'Clube de Futebol ',
  'Clube Desportivo ', 'Clube ', 'Esporte Clube ', 'Sport Clube ', 'Sport Club ', 'Sociedade Esportiva ',
  'Società Sportiva Calcio ', 'Società Sportiva ', 'Unione Calcio ', 'Unione Sportiva ', 'Associazione Calcio ',
  'Associazione Sportiva ', 'Calcio ', 'Real Club Deportivo ', 'Real Club ', 'Fútbol Club ', 'Football Club ',
  'Unión Deportiva ', '1. FC ', 'F. C. ', 'F.C. ', 'FC ', 'A.C. ', 'AC ', 'ACF ', 'AFC ', 'A.S. ', 'AS ', 'S.S.C. ',
  'SSC ', 'S.S. ', 'U.S. ', 'US ', 'OGC ', 'S.L. ', 'SL ', 'SC ', 'FK ', 'SK ',
];
const SUFIJOS = [
  ' Cricket & Football Club', ' Football Club', ' Foot Ball Club', ' Foot-Ball Club', ' Fútbol Club', ' Futebol Clube',
  ' Esporte Clube', ' Atlético Clube', ' Atlético Club', ' Sporting Club', ' Sports Club', ' Sport Club', ' Soccer Club',
  ' Sport Clube', ' Spor Kulübü', ' Bergamasca Calcio', ' Club de Fútbol', ' Club de Futbol', ' de Football',
  ' de Fútbol', ' Balompié', ' Calcio', ' Clube', ' S.A.D.', ' F.C.', ' F. C.', ' FC', ' CF', ' SC', ' FK',
];

function acortarClub(nombre) {
  if (CLUBES_MANUAL[nombre]) return CLUBES_MANUAL[nombre];
  let n = nombre.trim();
  const prefijo = PREFIJOS.find((p) => n.startsWith(p));
  if (prefijo) n = n.slice(prefijo.length);
  // Clubes italianos con año de fundación: "Bologna Football Club 1909", "Ascoli Calcio 1898".
  if (/\b(Calcio|Football Club|Foot Ball Club|Foot-Ball Club|Sportiva)\b/.test(nombre)) n = n.replace(/\s\d{4}$/, '');
  const sufijo = SUFIJOS.find((s) => n.endsWith(s));
  if (sufijo) n = n.slice(0, -sufijo.length);
  n = n.trim();
  return n.length >= 3 ? n : nombre;
}

// Equipos filiales o juveniles que se colaron en la carrera.
// (también equipos que no son clubes, como selecciones de liga o de colegios)
const RE_FILIAL =
  /(\s["“]?(B|C|II|III)["”]?|\sYouth Sector|\sYouth|\sAcademy|\sPrimavera|\sReserves?|\sJuvenil|\sAtl[eè]tic)$|\bJong\b|Castilla|Mestalla|League XI|Schools|\bSub-?\d{2}\b|\bU-?\d{2}\b/i;

// ───────────── Posición ─────────────
function clasificarPosicion(etiqueta) {
  const t = String(etiqueta).toLowerCase();
  if (/portero|arquero|guardameta|goalkeeper/.test(t)) return 'Arquero';
  if (/media punta|mediapunta|segundo delantero/.test(t)) return 'Delantero';
  if (/centrocamp|mediocamp|mediocentro|volante|enganche|creador|pivote|interior|midfield|organizador/.test(t)) return 'Mediocampista';
  if (/defens|lateral|l[ií]bero|zaguero|carrilero|\bback\b|defender|stopper/.test(t)) return 'Defensor';
  if (/delantero|extremo|atacante|alero|punta|striker|forward|winger/.test(t)) return 'Delantero';
  return null;
}

// Gana la posición que más se repite. Si empatan, se prefiere la más ofensiva (Messi figura como "centrocampista, delantero").
const PRIORIDAD = ['Arquero', 'Delantero', 'Mediocampista', 'Defensor'];
function posicionGeneral(etiquetas) {
  const clases = (etiquetas ?? []).map(clasificarPosicion).filter(Boolean);
  if (!clases.length) return null;
  const votos = {};
  for (const c of clases) votos[c] = (votos[c] ?? 0) + 1;
  const maximo = Math.max(...Object.values(votos));
  return PRIORIDAD.find((c) => votos[c] === maximo);
}

// ───────────── Limpieza de cada jugador ─────────────
const anioValido = (a) => (Number.isInteger(a) && a >= 1850 && a <= ANIO_ACTUAL + 1 ? a : null);

function limpiar(j) {
  const nac = anioValido(j.nacimiento);
  const motivos = [];
  const descartados = { juvenil: 0, filial: 0, imposible: 0, sinAnio: 0 };

  const pasos = [];
  for (const p of j.carrera ?? []) {
    let desde = anioValido(p.desde);
    let hasta = anioValido(p.hasta);
    if (hasta != null && hasta > ANIO_ACTUAL) hasta = null; // fin de contrato a futuro: sigue ahí
    if (RE_FILIAL.test(p.club)) { descartados.filial++; continue; }
    if (desde == null && hasta == null) { descartados.sinAnio++; continue; } // sin ninguna fecha: no aporta y confunde el retiro
    if (desde != null && nac) {
      const edad = desde - nac;
      if (edad < EDAD_MINIMA_PRIMER_CLUB) { descartados.juvenil++; continue; }
      if (edad > EDAD_MAXIMA_INICIO_PASO) { descartados.imposible++; continue; }
    }
    pasos.push({ club: acortarClub(p.club), desde, hasta });
  }
  // Orden cronológico. Si a un paso le falta el inicio, se lo ubica según el año en que terminó.
  const orden = (p) => p.desde ?? (p.hasta != null ? p.hasta - 0.5 : 9999);
  pasos.sort((a, b) => orden(a) - orden(b));

  const conInicio = pasos.filter((p) => p.desde != null);
  const debut = conInicio.length ? Math.min(...conInicio.map((p) => p.desde)) : null;
  const edadHoy = nac ? ANIO_ACTUAL - nac : null;
  const haySinFin = pasos.some((p) => p.hasta == null);
  const activo = haySinFin && edadHoy != null && edadHoy < EDAD_ACTIVO_MAXIMA;
  const fines = pasos.map((p) => p.hasta).filter((x) => x != null);
  let retiro = activo ? null : fines.length ? Math.max(...fines) : null;
  let retiroIncompleto = !activo && haySinFin; // retirado pero con algún club sin fecha de fin: el año no es confiable

  const seleccionesLimpias = (j.selecciones ?? [])
    .map((s) => ({ equipo: s.equipo, desde: anioValido(s.desde), hasta: anioValido(s.hasta) }))
    .filter((s) => !(s.desde != null && nac && (s.desde - nac < 15 || s.desde - nac > 45)));
  const desdeSel = seleccionesLimpias.map((s) => s.desde).filter((x) => x != null);

  if (nac && debut != null && debut - nac > 28) motivos.push('debut recién a los ' + (debut - nac) + ' (¿dato erróneo?)');
  // Solo se juzga el retiro si es confiable (si ya era dudoso, la pista se omite y listo).
  if (!activo && retiro != null && nac && !retiroIncompleto) {
    const edadRetiro = retiro - nac;
    if (edadRetiro > 45) retiroIncompleto = true; // año imposible: la pista se omite
    // Retirado muy joven y sin selección: casi seguro es un entrenador (Mourinho, Bielsa). Con selección se deja (Tostão).
    else if (edadRetiro < 28 && !desdeSel.length) motivos.push('se retiró a los ' + edadRetiro + ' y nunca jugó en una selección (¿entrenador?)');
  }
  if (!nac) motivos.push('sin año de nacimiento');

  const alias = [...new Set((j.alias ?? []).filter((a) => a && a !== j.nombre && a.length <= 40))].slice(0, 8);

  const limpio = {
    ...j,
    alias,
    posicion: posicionGeneral(j.posiciones),
    debut,
    retiro,
    activo,
    retiroIncompleto,
    debutSeleccion: desdeSel.length ? Math.min(...desdeSel) : null,
    carrera: pasos,
    selecciones: seleccionesLimpias,
    jugable: conInicio.length >= 1,
    excluir: motivos.length > 0 || conInicio.length === 0,
    motivoExclusion: conInicio.length === 0 && !motivos.length ? 'sin pasos por clubes con año' : motivos.join('; ') || undefined,
  };
  if (!limpio.excluir) delete limpio.motivoExclusion;
  return { limpio, descartados };
}

// ───────────── Programa ─────────────
const original = JSON.parse(readFileSync(entrada, 'utf8'));
// Wikidata marca como "futbolista" a gente que no lo es (Camus, Connery, Milei...): sin ningún paso por un club
// con año y, o bien sin posición, o bien con fama de celebridad (80+ idiomas), se la saca del todo.
const NO_FUTBOLISTA_IDIOMAS = 80;
const todos = original.map(limpiar);
const fuera = todos.filter((r) => !r.limpio.jugable && (!r.limpio.posicion || (r.limpio.popularidad ?? 0) >= NO_FUTBOLISTA_IDIOMAS));
const resultado = todos.filter((r) => !fuera.includes(r));
const salidaLista = resultado.map((r) => r.limpio);
// Nacionalidades: las que dejó bajar-nacionalidad.mjs (nacionalidades.json), o las que ya traía el archivo de entrada.
const nacionalidades = existsSync('nacionalidades.json') ? JSON.parse(readFileSync('nacionalidades.json', 'utf8')) : {};
const previas = new Map(original.filter((j) => j.nacionalidad).map((j) => [j.id, j.nacionalidad]));
for (const j of salidaLista) {
  const n = nacionalidades[j.id] ?? previas.get(j.id);
  if (n) j.nacionalidad = n;
}
writeFileSync(salida, JSON.stringify(salidaLista, null, 1));

const cuenta = (arr, f) => arr.filter(f).length;
const suma = (k) => resultado.reduce((a, r) => a + r.descartados[k], 0);
const jug = salidaLista.filter((j) => j.jugable);
console.log(`Entrada: ${original.length} jugadores. Salida: ${salida} (${salidaLista.length})`);
console.log(`Sacados por no ser futbolistas (${fuera.length}): ${fuera.map((r) => r.limpio.nombre).join(', ')}`);
console.log(`Pasos descartados: ${suma('juvenil')} de inferiores, ${suma('filial')} de filiales, ${suma('imposible')} con fecha imposible, ${suma('sinAnio')} sin ningún año.`);
console.log(`Jugables: ${jug.length}. Excluidos como jugador del día: ${cuenta(salidaLista, (j) => j.excluir)}.`);
console.log(`Con posición: ${cuenta(jug, (j) => j.posicion)} | con altura: ${cuenta(jug, (j) => j.alturaCm)} | con foto: ${cuenta(jug, (j) => j.foto)}`);
console.log('Posiciones:', JSON.stringify(jug.reduce((a, j) => ((a[j.posicion ?? 'sin dato'] = (a[j.posicion ?? 'sin dato'] ?? 0) + 1), a), {})));
const excluidos = salidaLista.filter((j) => j.excluir);
if (excluidos.length) {
  console.log('\nExcluidos (siguen en el autocompletado, pero no pueden salir como jugador del día):');
  for (const j of excluidos.slice(0, 40)) console.log(`  ${j.nombre}: ${j.motivoExclusion}`);
  if (excluidos.length > 40) console.log(`  ... y ${excluidos.length - 40} más`);
}
