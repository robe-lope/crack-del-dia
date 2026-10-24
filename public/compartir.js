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

// ───────────── Tarjeta para stories (canvas) ─────────────
// dibujarTarjeta toca un CanvasRenderingContext2D de verdad: no es "pura" en sentido estricto, pero
// no decide nada por su cuenta, todo lo que pinta ya viene resuelto en `datos` (el mismo objeto de
// datosParaCompartir) y `url`. Por eso no tiene test (necesita DOM); lo que sí se testea es `datos`.

export const TARJETA_ANCHO = 1080;
export const TARJETA_ALTO = 1920;
const MARGEN_SEGURO = 250; // arriba y abajo: ahí tapa la interfaz de Instagram en un story

const COLOR = {
  fondoA: '#1a3a2b', // --tablero
  fondoB: '#0c1b14', // más oscuro que --pizarra, para que el degradé se note
  tiza: '#eaf1ec',
  tizaSuave: '#9db5a6',
  linea: 'rgba(234, 241, 236, 0.26)',
  sol: '#f4b223',
  rojo: '#f0786f',
  verde: '#6fd39a',
};
const FUENTE_DISPLAY = '"Big Shoulders", "Arial Narrow", Impact, sans-serif';
const FUENTE_TEXTO = '"Schibsted", system-ui, sans-serif';

function rectangulo(ctx, x, y, lado, color) {
  const r = 12;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + lado, y, x + lado, y + lado, r);
  ctx.arcTo(x + lado, y + lado, x, y + lado, r);
  ctx.arcTo(x, y + lado, x, y, r);
  ctx.arcTo(x, y, x + lado, y, r);
  ctx.closePath();
  if (color) {
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    ctx.strokeStyle = COLOR.tizaSuave;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

// Una fila de cuadraditos centrada (como las paletas del tablero), en varias líneas si no entran en
// el ancho disponible. `colores`: un color por cuadrado, o null para uno vacío (sin usar).
function filaDeCuadrados(ctx, y, colores, { lado = 70, gap = 20, margen = 110 } = {}) {
  if (!colores.length) return y;
  const porFila = Math.max(1, Math.floor((TARJETA_ANCHO - margen * 2 + gap) / (lado + gap)));
  let fy = y;
  for (let i = 0; i < colores.length; i += porFila) {
    const fila = colores.slice(i, i + porFila);
    const anchoFila = fila.length * lado + (fila.length - 1) * gap;
    let x = TARJETA_ANCHO / 2 - anchoFila / 2;
    for (const color of fila) {
      rectangulo(ctx, x, fy, lado, color);
      x += lado + gap;
    }
    fy += lado + gap;
  }
  return fy + 30;
}

// Dibuja la tarjeta completa en `ctx` (ya con el tamaño TARJETA_ANCHO×TARJETA_ALTO). Nada del
// jugador: ni nombre, ni foto, ni silueta, ni club, ni nacionalidad — solo números y el resultado.
export function dibujarTarjeta(ctx, datos, url) {
  const w = TARJETA_ANCHO;
  const h = TARJETA_ALTO;

  const fondo = ctx.createLinearGradient(0, 0, 0, h);
  fondo.addColorStop(0, COLOR.fondoA);
  fondo.addColorStop(1, COLOR.fondoB);
  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  let y = MARGEN_SEGURO + 110;

  ctx.fillStyle = COLOR.tiza;
  ctx.font = `800 96px ${FUENTE_DISPLAY}`;
  ctx.fillText(NOMBRE_JUEGO, w / 2, y);
  y += 70;

  ctx.fillStyle = COLOR.tizaSuave;
  ctx.font = `600 44px ${FUENTE_TEXTO}`;
  ctx.fillText(`Nº ${datos.numero} · ${formatearFecha(datos.fecha)}`, w / 2, y);
  y += 100;

  ctx.strokeStyle = COLOR.linea;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 160, y);
  ctx.lineTo(w / 2 + 160, y);
  ctx.stroke();
  y += 110;

  // Resultado
  ctx.fillStyle = datos.gano ? COLOR.sol : COLOR.tiza;
  ctx.font = `800 64px ${FUENTE_DISPLAY}`;
  ctx.fillText(datos.resultado, w / 2, y);
  y += 100;

  // Pistas pedidas
  ctx.fillStyle = COLOR.tizaSuave;
  ctx.font = `600 36px ${FUENTE_TEXTO}`;
  ctx.fillText(datos.pistas > 0 ? 'Pistas pedidas' : 'Sin pistas pedidas', w / 2, y);
  y += 60;
  const coloresPistas = Array.from({ length: datos.pistas }, () => COLOR.sol);
  y = filaDeCuadrados(ctx, y, coloresPistas);
  y += datos.pistas > 0 ? 40 : 80;

  // Intentos
  ctx.fillStyle = COLOR.tizaSuave;
  ctx.font = `600 36px ${FUENTE_TEXTO}`;
  ctx.fillText('Intentos', w / 2, y);
  y += 60;
  const vacios = Math.max(0, datos.intentosMax - datos.intentosUsados.length);
  const coloresIntentos = [
    ...datos.intentosUsados.map((u) => (u === 'acierto' ? COLOR.verde : COLOR.rojo)),
    ...Array.from({ length: vacios }, () => null),
  ];
  y = filaDeCuadrados(ctx, y, coloresIntentos);
  y += 70;

  // Puntaje y racha
  ctx.fillStyle = COLOR.sol;
  ctx.font = `800 80px ${FUENTE_DISPLAY}`;
  ctx.fillText(`${datos.puntaje} puntos`, w / 2, y);
  y += 60;
  if (datos.racha > 0) {
    ctx.fillStyle = COLOR.tizaSuave;
    ctx.font = `600 40px ${FUENTE_TEXTO}`;
    ctx.fillText(`Racha ${datos.racha}`, w / 2, y);
  }

  // URL, pegada al margen seguro de abajo
  ctx.fillStyle = COLOR.tizaSuave;
  ctx.font = `600 38px ${FUENTE_TEXTO}`;
  ctx.fillText(url, w / 2, h - MARGEN_SEGURO - 50);
}
