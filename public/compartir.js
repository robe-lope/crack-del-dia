// Arma lo que se comparte del resultado del diario: el texto (navigator.share o portapapeles) y,
// más abajo, la tarjeta para stories. Solo diario (la práctica no se comparte) y nunca nada que
// identifique al jugador: ni nombre, ni foto, ni club, ni nacionalidad, en ningún campo ni texto.
// Funciones puras (sin DOM): así se testean con datos de prueba, sin navegador.

export const NOMBRE_JUEGO = 'Crack del Día';

// "2026-10-24" -> "24/10/2026". Si no viene con esa forma, se devuelve tal cual.
export function formatearFecha(fechaISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fechaISO ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(fechaISO ?? '');
}

// A partir de la vista del servidor (la misma que ya tiene la pantalla), arma un resumen chico para
// compartir: números y textos ya resueltos, nada del jugador. Lo usan tanto el texto como la tarjeta.
export function datosParaCompartir(v) {
  const gano = v.estado === 'ganado';
  const errores = v.intentos.length;
  const intentosUsados = Array.from({ length: errores }, () => 'fallido');
  if (gano) intentosUsados.push('acierto');
  return {
    numero: v.numero,
    fecha: v.fecha,
    gano,
    resultado: gano ? `Lo saqué en ${intentosUsados.length} intento${intentosUsados.length === 1 ? '' : 's'}` : 'No lo saqué',
    pistas: v.pedidas,
    intentosUsados,
    intentosMax: v.intentosMax,
    puntaje: v.puntaje,
    racha: v.racha,
  };
}

// El texto para compartir. `url` aparte (no se lee location.origin acá) para poder testear sin DOM.
export function textoParaCompartir(datos, url) {
  const pistas = datos.pistas > 0 ? '🟨'.repeat(datos.pistas) : 'sin pistas';
  const vacios = Math.max(0, datos.intentosMax - datos.intentosUsados.length);
  const intentos = datos.intentosUsados.map((u) => (u === 'acierto' ? '🟩' : '🟥')).join('') + '⬜'.repeat(vacios);
  const puntaje = datos.racha > 0 ? `${datos.puntaje} puntos · racha ${datos.racha}` : `${datos.puntaje} puntos`;
  return [`${NOMBRE_JUEGO} Nº${datos.numero}`, datos.resultado, `Pistas: ${pistas}`, `Intentos: ${intentos}`, puntaje, url].join('\n');
}

