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
  paleta: '#0f2018', // --paleta: la caja oscura de la silueta en el tablero
  tiza: '#eaf1ec',
  tizaSuave: '#9db5a6',
  linea: 'rgba(234, 241, 236, 0.26)',
  sol: '#f4b223',
  rojo: '#f0786f',
  verde: '#6fd39a',
};
const FUENTE_DISPLAY = '"Big Shoulders", "Arial Narrow", Impact, sans-serif';
const FUENTE_TEXTO = '"Schibsted", system-ui, sans-serif';

// Dibuja `img` cubriendo todo el ancho×alto, recortado al centro, sin deformar (como CSS object-fit:
// cover). Para fotos reales (siempre con medidas propias); no se usa para la bandera (ver abajo).
function dibujarCover(ctx, img, w, h) {
  const anchoImg = img.naturalWidth || img.width;
  const altoImg = img.naturalHeight || img.height;
  if (!anchoImg || !altoImg) return;
  const escala = Math.max(w / anchoImg, h / altoImg);
  const anchoDestino = anchoImg * escala;
  const altoDestino = altoImg * escala;
  ctx.drawImage(img, (w - anchoDestino) / 2, (h - altoDestino) / 2, anchoDestino, altoDestino);
}

// La misma silueta genérica del tablero (el <svg viewBox="0 0 64 64"> de la cabecera): una cabeza y
// los hombros, siempre igual para cualquier jugador. Se dibuja a mano (no hace falta cargar nada).
function dibujarSilueta(ctx, cx, cy, tamano, color) {
  const escala = tamano / 64;
  ctx.save();
  ctx.translate(cx - tamano / 2, cy - tamano / 2);
  ctx.scale(escala, escala);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(32, 24, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8, 64);
  ctx.bezierCurveTo(9, 49, 18, 41, 32, 41);
  ctx.bezierCurveTo(46, 41, 55, 49, 56, 64);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// La caja con la silueta (y la banderita superpuesta en la esquina, como en el tablero). `bandera`
// es un <img> ya cargado del SVG de /banderas/ (o null si no había país, no cargó o tardó de más).
// Los SVG de flag-icons no declaran width/height en el <svg> (son solo viewBox): por eso acá siempre
// se dibuja con un ancho/alto fijo en vez de confiar en el tamaño "natural" de la imagen.
function dibujarSiluetaConBandera(ctx, cx, y, bandera) {
  const lado = 260;
  const x = cx - lado / 2;
  rectangulo(ctx, x, y, lado, COLOR.paleta);
  dibujarSilueta(ctx, cx, y + lado * 0.58, lado * 0.62, '#27493a'); // mismo verde que .silueta svg

  if (bandera) {
    const bAncho = 86;
    const bAlto = 64; // tamaño fijo (4:3), no el "natural" del SVG
    const bx = x + lado - bAncho - 14;
    const by = y + lado - bAlto - 14;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 10;
    try {
      ctx.drawImage(bandera, bx, by, bAncho, bAlto);
    } catch {
      /* si el navegador no puede dibujar este SVG en canvas, se sigue sin bandera */
    }
    ctx.restore();
  }
  return y + lado;
}

// `alto` opcional: por defecto dibuja un cuadrado de lado `ancho` (como las paletas del tablero);
// el panel oscuro detrás del contenido, en cambio, es un rectángulo y pasa su propio alto.
function rectangulo(ctx, x, y, ancho, color, alto = ancho) {
  const r = 12;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + ancho, y, x + ancho, y + alto, r);
  ctx.arcTo(x + ancho, y + alto, x, y + alto, r);
  ctx.arcTo(x, y + alto, x, y, r);
  ctx.arcTo(x, y, x + ancho, y, r);
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
// jugador: ni nombre, ni foto real, ni club, ni nacionalidad del tipo "Argentina" en texto — solo la
// silueta genérica (igual para todos) y la bandera, que ya se ven así desde que arranca la partida.
// `imagenes` son <img> ya cargadas (o null si no había, no cargaron o tardaron de más):
//   - fondo: /story-fondo.jpg, de fondo con efecto "cover". Si no hay, se usa el degradé de siempre.
//   - bandera: el SVG de /banderas/<código>.svg del país del jugador del día.
export function dibujarTarjeta(ctx, datos, url, imagenes = {}) {
  const w = TARJETA_ANCHO;
  const h = TARJETA_ALTO;
  const { fondo: fondoImg, bandera: banderaImg } = imagenes;

  if (fondoImg) {
    dibujarCover(ctx, fondoImg, w, h);
    // Capa oscura para que el texto se lea siempre, un poco más fuerte detrás del bloque de
    // contenido (el panel de abajo) que en los bordes de la foto.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, w, h);
    rectangulo(ctx, 50, MARGEN_SEGURO - 20, w - 100, 'rgba(0, 0, 0, 0.3)', h - MARGEN_SEGURO * 2 + 40);
  } else {
    const degrade = ctx.createLinearGradient(0, 0, 0, h);
    degrade.addColorStop(0, COLOR.fondoA);
    degrade.addColorStop(1, COLOR.fondoB);
    ctx.fillStyle = degrade;
    ctx.fillRect(0, 0, w, h);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  let y = MARGEN_SEGURO + 30;

  // Silueta + bandera: lo único "visual" del jugador, y es genérico (igual para cualquiera).
  y = dibujarSiluetaConBandera(ctx, w / 2, y, banderaImg) + 65;

  ctx.fillStyle = COLOR.tiza;
  ctx.font = `800 84px ${FUENTE_DISPLAY}`;
  ctx.fillText(NOMBRE_JUEGO, w / 2, y);
  y += 64;

  ctx.fillStyle = COLOR.tizaSuave;
  ctx.font = `600 40px ${FUENTE_TEXTO}`;
  ctx.fillText(`Nº ${datos.numero} · ${formatearFecha(datos.fecha)}`, w / 2, y);
  y += 90;

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
