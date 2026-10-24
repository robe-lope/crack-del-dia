// Crack del Día: pantalla del juego diario.
// El servidor decide todo (qué pistas se ven, si acertaste, cuántos puntos). Acá solo se dibuja y se escribe.

import { NOMBRE_JUEGO as NOMBRE, datosParaCompartir, textoParaCompartir } from './compartir.js';

const $ = (selector, dentro = document) => dentro.querySelector(selector);

function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto != null) el.textContent = texto;
  return el;
}

const normalizar = (texto) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// ───────────── Estado ─────────────

let token = obtenerToken();
let vista = null; // la partida que se está mostrando (diaria o de práctica)
let vistaDiaria = null; // última respuesta del servidor del día
let vistaPractica = null; // la práctica en curso o la última terminada
let opcionesPractica = null; // grupos y dificultades que ofrece el servidor
let eleccion = leerEleccion(); // lo último que se eligió en Práctica
let pantalla = 'juego'; // 'juego' | 'practica' | 'ranking'
let jugadores = []; // para el autocompletado
let elegido = null; // jugador elegido de la lista
let sugeridos = [];
let activa = -1;
let tipoRanking = 'dia';
let editandoApodo = false;
let reloj = null;

function obtenerToken() {
  try {
    let t = localStorage.getItem('crack:token');
    if (!t) {
      t = crypto.randomUUID();
      localStorage.setItem('crack:token', t);
    }
    return t;
  } catch {
    return crypto.randomUUID(); // sin almacenamiento: funciona, pero la identidad dura lo que dure la pestaña
  }
}

function leerEleccion() {
  try {
    const guardada = JSON.parse(localStorage.getItem('crack:practica') ?? 'null');
    if (guardada?.grupo && guardada?.dificultad) return { ...guardada, argentina: Boolean(guardada.argentina) };
  } catch {
    /* sin almacenamiento */
  }
  return { grupo: 'todos', dificultad: 'todas', argentina: false };
}

function guardarEleccion() {
  try {
    localStorage.setItem('crack:practica', JSON.stringify(eleccion));
  } catch {
    /* sin almacenamiento */
  }
}

async function api(ruta, cuerpo) {
  const respuesta = await fetch(ruta, {
    method: cuerpo ? 'POST' : 'GET',
    headers: { 'X-Token': token, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  let datos = null;
  try {
    datos = await respuesta.json();
  } catch {
    /* respuesta sin cuerpo */
  }
  if (!respuesta.ok) {
    const error = new Error(datos?.mensaje || 'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.');
    error.codigo = datos?.error;
    throw error;
  }
  return datos;
}

// ───────────── Mensajes ─────────────

function mensaje(texto, esError = false) {
  const el = $('#mensaje');
  el.textContent = texto;
  el.classList.toggle('mensaje--error', esError);
}

// ───────────── Tablero ─────────────

// Una fila del tablero. `animar` es el lugar en la tanda de paletas nuevas (null: no se da vuelta).
function filaDePista({ etiqueta, valor, club = false, sinUsar = false, animar = null }) {
  const fila = crear('li', `fila${club ? ' fila--club' : ''}${sinUsar ? ' fila--sin-usar' : ''}`);
  fila.append(crear('span', 'fila-etiqueta', etiqueta));
  const caja = crear('div', 'valor');
  valor.split(' ').forEach((palabra, k) => {
    const paleta = crear('span', `paleta${animar == null ? '' : ' paleta--nueva'}`, palabra);
    if (animar != null) paleta.style.setProperty('--i', String(animar + k * 0.5));
    caja.append(paleta);
  });
  fila.append(caja);
  return fila;
}

// Las pistas pedidas, agrupadas por categoría en el orden del catálogo del servidor.
// Mientras se juega van solo las reveladas; al terminar van todas, con las no usadas marcadas.
function pistasPorCategoria(v) {
  const grupos = new Map(v.disponibles.map((d) => [d.id, []]));
  const guardar = (id, item) => {
    if (!grupos.has(id)) grupos.set(id, []);
    grupos.get(id).push(item);
  };
  if (v.estado === 'jugando') v.reveladas.forEach((r, i) => guardar(r.categoria, { ...r, orden: i }));
  else for (const t of v.todas ?? []) guardar(t.categoria, { ...t, orden: null });
  return [...grupos].filter(([, items]) => items.length);
}

function pintarFilas(v, previas) {
  const lista = $('#pistas');
  lista.replaceChildren();

  // Las básicas están desde el arranque: no se dan vuelta.
  for (const b of v.basicas) lista.append(filaDePista(b));

  let nuevas = 0;
  for (const [categoria, items] of pistasPorCategoria(v)) {
    const separador = crear('li', 'linea');
    separador.setAttribute('role', 'presentation');
    lista.append(separador);
    for (const item of items) {
      const recien = item.orden != null && item.orden >= previas;
      lista.append(
        filaDePista({
          etiqueta: item.etiqueta,
          valor: item.valor,
          club: categoria === 'carrera',
          sinUsar: item.usada === false,
          animar: recien ? nuevas++ : null,
        }),
      );
    }
  }
}

// La línea discreta de abajo: qué queda por pedir (sin decir qué dice cada pista).
function pintarQuedan(v) {
  const el = $('#quedan');
  const libres = v.estado === 'jugando' ? v.disponibles.filter((d) => d.quedan > 0) : [];
  if (v.estado !== 'jugando') {
    el.hidden = true;
    return;
  }
  el.textContent = libres.length
    ? `Pistas disponibles: ${libres.map((d) => (d.quedan > 1 ? `${d.nombre} (${d.quedan})` : d.nombre)).join(', ')}.`
    : 'Ya pediste todas las pistas. Arriesgá con lo que tenés.';
  el.hidden = false;
}

// La nacionalidad se ve desde el principio, junto a la silueta (no es una pista que se abra).
function pintarPais(pais) {
  const bandera = $('#bandera');
  const nombre = $('#pais');
  if (!pais) {
    bandera.hidden = true;
    nombre.hidden = true;
    return;
  }
  bandera.onerror = () => { bandera.hidden = true; }; // si falta el archivo, queda el nombre del país
  bandera.src = `/banderas/${pais.codigo}.svg`;
  bandera.alt = `Bandera de ${pais.nombre}`;
  bandera.hidden = false;
  nombre.textContent = pais.nombre;
  nombre.hidden = false;
}

const contadorDePistas = (n) => (n === 0 ? 'Sin pistas pedidas' : n === 1 ? '1 pista pedida' : `${n} pistas pedidas`);

function pintar(v) {
  const practica = v.modo === 'practica';
  const anterior = practica ? vistaPractica : vistaDiaria;
  const mismaPartida = Boolean(anterior) && anterior.partida === v.partida;
  const previas = mismaPartida ? anterior.reveladas.length : 0;
  vista = v;
  if (practica) vistaPractica = v;
  else vistaDiaria = v;
  const terminada = v.estado !== 'jugando';
  // Si recién ahora pasó de "jugando" a terminada (en esta misma sesión), la foto se anima.
  // Si llega terminada desde el arranque (recargaste la página a mitad de la espera), aparece directo.
  const reveladaRecien = terminada && mismaPartida && anterior.estado === 'jugando';

  $('#num').textContent = practica ? 'Práctica' : `Nº ${v.numero}`;
  $('#racha').textContent = !practica && v.racha > 0 ? `Racha ${v.racha}` : '';
  $('#practica-barra').hidden = !practica;
  if (practica) $('#practica-resumen').textContent = resumenPractica(v);
  $('#aviso-ejemplo').hidden = !v.ejemplo;
  $('#contador').textContent = terminada ? 'Partida terminada' : contadorDePistas(v.pedidas);
  pintarPais(v.pais);
  // El jugador de ayer es siempre público (no es una pista de hoy): se ve en el diario, no en práctica.
  $('#ayer').hidden = practica || !v.ayer;
  if (!practica && v.ayer) $('#ayer').textContent = `Ayer (Nº ${v.ayer.numero}) era ${v.ayer.nombre}.`;

  pintarFilas(v, previas);
  pintarQuedan(v);

  // Descartados e intentos que quedan
  const fallos = $('#fallos');
  fallos.replaceChildren(...v.intentos.map((i) => crear('li', null, `✗ ${i.nombre}`)));
  const quedan = v.intentosMax - v.intentos.length;
  const textoIntentos = $('#intentos-texto');
  textoIntentos.hidden = terminada;
  textoIntentos.replaceChildren(
    'Intentos: ', crear('strong', null, `${quedan} de ${v.intentosMax}`),
    quedan === 1 ? ' · Es el último.' : '',
  );

  // Controles
  $('#form').hidden = terminada;
  $('#acciones').hidden = terminada;
  $('#pedir').disabled = !quedanPistas(v);
  const valor = $('#valor');
  if (!terminada) {
    valor.replaceChildren('Si acertás ahora: ', crear('strong', null, `${v.puntajeActual} puntos`));
    if (!quedanPistas(v)) valor.append(' · No quedan pistas por pedir.');
  }
  if (terminada) cerrarModal();
  else if ($('#modal').open) pintarModal(v);

  pintarFinal(v, reveladaRecien);
  pintarApodos();
}

// Reemplaza la silueta del encabezado por la foto del resultado (ganado o perdido), con un fundido.
// Mientras se juega, o si el jugador no tiene foto, queda la silueta de siempre.
function revelarFoto(v, animar) {
  const foto = $('#foto-jugador');
  const silueta = $('#silueta');
  const terminada = v.estado !== 'jugando';

  if (!terminada || !v.resultado?.foto) {
    foto.hidden = true;
    foto.classList.remove('foto-jugador--visible');
    foto.removeAttribute('src');
    silueta.classList.remove('silueta--grande');
    return;
  }

  const yaEsta = foto.src === v.resultado.foto && !foto.hidden;
  if (yaEsta) return; // ya se estaba mostrando esta misma foto: no reiniciar el fundido

  const mostrar = () => {
    foto.hidden = false;
    silueta.classList.add('silueta--grande');
    if (animar) {
      // Dos vueltas de rAF: así el navegador llega a pintar el estado "oculta" antes de animar.
      requestAnimationFrame(() => requestAnimationFrame(() => foto.classList.add('foto-jugador--visible')));
    } else {
      foto.classList.add('foto-jugador--visible'); // sin pasos intermedios: aparece directo
    }
  };

  foto.alt = v.resultado.nombre;
  foto.referrerPolicy = 'no-referrer';
  foto.classList.remove('foto-jugador--visible');
  foto.onload = mostrar;
  foto.onerror = () => {
    foto.hidden = true;
    foto.classList.remove('foto-jugador--visible');
    silueta.classList.remove('silueta--grande'); // si no carga, queda la silueta
  };
  foto.src = v.resultado.foto;
}

function pintarFinal(v, animar) {
  const final = $('#final');
  const terminada = v.estado !== 'jugando';
  final.hidden = !terminada;
  revelarFoto(v, animar);
  if (!terminada) {
    clearInterval(reloj);
    return;
  }

  const practica = v.modo === 'practica';
  $('#compartir').hidden = practica;
  $('#ver-ranking').hidden = practica;
  $('#proximo').hidden = practica;
  $('#practica-otro').hidden = !practica;
  $('#practica-filtros').hidden = !practica;

  const gano = v.estado === 'ganado';
  // Perdida y de hoy: el servidor no manda resultado, para no filtrar quién era hasta mañana.
  const oculto = !v.resultado;
  if (oculto) $('#final-titulo').textContent = 'Perdiste';
  else $('#final-titulo').textContent = gano ? `¡Era ${v.resultado.nombre}!` : `Era ${v.resultado.nombre}`;

  const detalle = $('#final-detalle');
  detalle.replaceChildren();
  if (gano) {
    const con = v.pedidas === 0 ? 'sin pedir una sola pista' : v.pedidas === 1 ? 'con 1 pista' : `con ${v.pedidas} pistas`;
    detalle.append(`Lo sacaste ${con}: `, crear('strong', null, `${v.puntaje} puntos`), '.');
  } else if (oculto) {
    detalle.append('Mañana te contamos quién era.');
  } else {
    detalle.append(`Gastaste los ${v.intentosMax} intentos y no salió. Mañana hay otro jugador.`);
  }

  const credito = $('#final-credito');
  if (v.resultado?.fotoPagina) {
    const enlace = crear('a', null, 'Wikimedia Commons');
    enlace.href = v.resultado.fotoPagina;
    enlace.target = '_blank';
    enlace.rel = 'noopener noreferrer';
    credito.replaceChildren('Foto: ', enlace);
    credito.hidden = false;
  } else {
    credito.hidden = true;
  }

  revelarFoto(v, animar);

  clearInterval(reloj);
  if (practica) return;
  actualizarCuenta();
  reloj = setInterval(actualizarCuenta, 1000);
}

// ───────────── Cuenta regresiva (el día cambia a las 00:00 de Argentina) ─────────────

function msHastaElProximoDia() {
  const DIA = 86_400_000;
  const local = Date.now() - 3 * 3_600_000;
  return Math.floor(local / DIA) * DIA + DIA - local;
}

function actualizarCuenta() {
  const ms = msHastaElProximoDia();
  const s = Math.floor(ms / 1000);
  const dos = (n) => String(n).padStart(2, '0');
  $('#cuenta').textContent = `${dos(Math.floor(s / 3600))}:${dos(Math.floor((s % 3600) / 60))}:${dos(s % 60)}`;
  if (ms < 1500) setTimeout(refrescarDia, 2500);
}

async function refrescarDia() {
  try {
    const v = await api('/api/hoy');
    if (!vistaDiaria || v.numero !== vistaDiaria.numero) {
      vistaDiaria = null;
      if (pantalla === 'juego' && vista?.modo !== 'practica') {
        vista = null;
        mensaje('');
        limpiarCampo();
        pintar(v);
      } else {
        vistaDiaria = v;
      }
      if (pantalla === 'ranking') cargarRanking();
    }
  } catch {
    /* si falla, se reintenta cuando la persona vuelva a la pestaña */
  }
}

// ───────────── Autocompletado ─────────────

async function cargarJugadores() {
  const { jugadores: lista } = await api('/api/jugadores');
  jugadores = lista.map((j) => ({ ...j, nn: normalizar(j.n), aa: (j.a ?? []).map(normalizar) }));
}

function buscar(texto) {
  const q = normalizar(texto);
  if (q.length < 2) return [];
  const partes = q.split(' ');
  const descartados = new Set((vista?.intentos ?? []).map((i) => i.id));
  const encontrados = [];
  for (const j of jugadores) {
    if (descartados.has(j.id)) continue;
    let mejor = 0;
    let via = null;
    [j.nn, ...j.aa].forEach((candidato, k) => {
      if (!partes.every((p) => candidato.includes(p))) return;
      const puntos = candidato.startsWith(q) ? 3 : candidato.split(' ').some((w) => w.startsWith(partes[0])) ? 2 : 1;
      if (puntos > mejor) {
        mejor = puntos;
        via = k === 0 ? null : j.a[k - 1];
      }
    });
    if (mejor) encontrados.push({ j, mejor, via });
  }
  encontrados.sort((a, b) => b.mejor - a.mejor || a.j.n.localeCompare(b.j.n, 'es'));
  return encontrados.slice(0, 6);
}

function pintarOpciones() {
  const lista = $('#lista');
  const entrada = $('#q');
  lista.replaceChildren();
  sugeridos.forEach(({ j, via }, i) => {
    const li = crear('li', 'opcion', j.n);
    li.id = `opcion-${i}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === activa));
    const detalle = [via, j.e].filter(Boolean).join(' · ');
    if (detalle) li.append(crear('small', null, detalle));
    li.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // evita que el campo pierda el foco antes de elegir
      elegir(j);
    });
    lista.append(li);
  });
  const abierta = sugeridos.length > 0;
  lista.hidden = !abierta;
  entrada.setAttribute('aria-expanded', String(abierta));
  if (abierta && activa >= 0) entrada.setAttribute('aria-activedescendant', `opcion-${activa}`);
  else entrada.removeAttribute('aria-activedescendant');
}

function elegir(j) {
  elegido = j;
  $('#q').value = j.n;
  sugeridos = [];
  activa = -1;
  pintarOpciones();
  $('#q').focus();
}

function limpiarCampo() {
  elegido = null;
  sugeridos = [];
  activa = -1;
  $('#q').value = '';
  pintarOpciones();
}

function configurarCampo() {
  const entrada = $('#q');
  entrada.addEventListener('input', () => {
    elegido = null;
    sugeridos = buscar(entrada.value);
    activa = -1;
    pintarOpciones();
  });
  entrada.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!sugeridos.length) return;
      e.preventDefault();
      const paso = e.key === 'ArrowDown' ? 1 : -1;
      activa = (activa + paso + sugeridos.length) % sugeridos.length;
      pintarOpciones();
    } else if (e.key === 'Enter' && activa >= 0 && sugeridos.length) {
      e.preventDefault(); // elegir de la lista no arriesga: hace falta un segundo Enter
      elegir(sugeridos[activa].j);
    } else if (e.key === 'Escape') {
      sugeridos = [];
      activa = -1;
      pintarOpciones();
    }
  });
  entrada.addEventListener('blur', () => setTimeout(() => {
    sugeridos = [];
    pintarOpciones();
  }, 120));
}

// ───────────── Jugar ─────────────

const quedanPistas = (v) => Boolean(v && v.estado === 'jugando' && v.disponibles.some((d) => d.quedan > 0));

function ocupado(si) {
  $('#arriesgar').disabled = si;
  $('#pedir').disabled = si || !quedanPistas(vista);
}

async function arriesgar(evento) {
  evento.preventDefault();
  if (!vista || vista.estado !== 'jugando') return;
  const texto = $('#q').value.trim();
  if (!texto) {
    mensaje('Escribí el nombre de un jugador.', true);
    return;
  }
  ocupado(true);
  try {
    const practica = vista.modo === 'practica';
    const quien = elegido ? { id: elegido.id } : { texto };
    const v = await api(practica ? '/api/practica/adivinar' : '/api/adivinar', practica ? { partida: vista.partida, ...quien } : quien);
    const ultimo = v.intentos.at(-1);
    limpiarCampo();
    pintar(v);
    if (v.estado === 'jugando') {
      const quedan = v.intentosMax - v.intentos.length;
      mensaje(`No es ${ultimo.nombre}. ${quedan === 1 ? 'Te queda 1 intento.' : `Te quedan ${quedan} intentos.`}`);
    } else mensaje('');
    if (v.estado === 'jugando') $('#q').focus();
    else {
      const titulo = $('#final-titulo');
      titulo.tabIndex = -1;
      titulo.focus();
    }
  } catch (error) {
    mensaje(error.message, true);
  } finally {
    ocupado(false);
  }
}

// ───────────── Modal de pistas ─────────────

let abrioElModal = null; // a quién le devolvemos el foco al cerrar

// "Vitrina" sola no dice mucho: en el modal se aclara de qué se trata.
const etiquetaCategoria = (d) => (d.id === 'palmares' ? `${d.nombre} (títulos y premios)` : d.nombre);

function pintarModal(v) {
  $('#modal-ayuda').replaceChildren(
    'Cada pista baja ',
    crear('strong', null, `${v.costoPista} puntos`),
    '. Si acertás después: ',
    crear('strong', null, `${v.puntajeSiguiente} puntos`),
    '.',
  );

  $('#modal-categorias').replaceChildren(
    ...v.disponibles.map((d) => {
      const li = crear('li');
      const boton = crear('button', 'categoria');
      boton.type = 'button';
      boton.disabled = d.quedan === 0;
      boton.append(
        crear('span', 'categoria-nombre', etiquetaCategoria(d)),
        crear('span', 'categoria-costo', d.quedan === 0 ? 'Agotada' : `−${v.costoPista} puntos`),
        crear(
          'span',
          'categoria-detalle',
          d.quedan === 0 ? 'Ya pediste todas las de esta categoría' : d.quedan === 1 ? 'Queda 1 pista' : `Quedan ${d.quedan} pistas`,
        ),
      );
      boton.addEventListener('click', () => pedirPista(d.id));
      li.append(boton);
      return li;
    }),
  );
}

function abrirModal() {
  if (!quedanPistas(vista)) return;
  abrioElModal = document.activeElement;
  pintarModal(vista);
  const modal = $('#modal');
  modal.showModal();
  (modal.querySelector('.categoria:not(:disabled)') ?? $('#modal-cerrar')).focus();
}

function cerrarModal() {
  const modal = $('#modal');
  if (modal.open) modal.close();
}

function configurarModal() {
  const modal = $('#modal');
  $('#modal-cerrar').addEventListener('click', cerrarModal);
  // Un clic en el fondo oscuro le llega al <dialog>, no a su contenido.
  modal.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModal();
  });
  // Esc y el botón ya cierran solos: acá solo se devuelve el foco.
  modal.addEventListener('close', () => {
    const volver = abrioElModal?.isConnected && !abrioElModal.disabled ? abrioElModal : $('#q');
    abrioElModal = null;
    if (vista?.estado === 'jugando') volver.focus();
  });
}

async function pedirPista(categoria) {
  if (!vista || vista.estado !== 'jugando') return;
  cerrarModal();
  ocupado(true);
  try {
    const practica = vista.modo === 'practica';
    const cuerpo = practica ? { partida: vista.partida, categoria } : { categoria };
    pintar(await api(practica ? '/api/practica/pista' : '/api/pista', cuerpo));
    mensaje('');
  } catch (error) {
    mensaje(error.message, true);
  } finally {
    ocupado(false);
  }
}

// ───────────── Compartir ─────────────
// El texto sale de compartir.js (datosParaCompartir + textoParaCompartir), compartido con la tarjeta
// para stories: nunca nada que identifique al jugador del día.

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = crear('textarea');
    area.value = texto;
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      /* sin portapapeles */
    }
    area.remove();
    return ok;
  }
}

// El menú nativo para compartir si el navegador lo tiene (celular); si no (escritorio), al portapapeles.
async function compartirTexto() {
  if (!vistaDiaria) return;
  const texto = textoParaCompartir(datosParaCompartir(vistaDiaria), location.origin);
  if (navigator.share) {
    try {
      await navigator.share({ text: texto, url: location.origin });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return; // cerró el menú sin elegir nada: no es un error
      // si falla por otro motivo, se sigue probando copiar
    }
  }
  const ok = await copiar(texto);
  mensaje(ok ? 'Copiado. Pegalo donde quieras.' : 'No pudimos copiarlo. Seleccioná y copiá el texto a mano.', !ok);
}

// ───────────── Apodo ─────────────

function formularioApodo(valorInicial = '') {
  const form = crear('form', 'apodo');
  form.noValidate = true;
  const id = `apodo-${Math.random().toString(36).slice(2, 7)}`;
  const etiqueta = crear('label', null, 'Elegí un apodo para aparecer en el ranking');
  etiqueta.htmlFor = id;
  const entrada = crear('input');
  Object.assign(entrada, { id, type: 'text', maxLength: 20, autocomplete: 'nickname', value: valorInicial });
  const guardar = crear('button', 'boton boton--sol', 'Guardar');
  guardar.type = 'submit';
  const error = crear('p', 'apodo-error');
  error.hidden = true;
  form.append(etiqueta, entrada, guardar, error);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    guardar.disabled = true;
    try {
      const { apodo } = await api('/api/apodo', { apodo: entrada.value });
      if (vistaDiaria) vistaDiaria.apodo = apodo;
      editandoApodo = false;
      pintarApodos();
      if (pantalla === 'ranking') cargarRanking();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      guardar.disabled = false;
    }
  });
  return form;
}

function pintarApodos() {
  if (!vistaDiaria) return;
  const final = $('#apodo-final');
  final.replaceChildren();
  if (vistaDiaria.estado !== 'jugando' && !vistaDiaria.apodo) final.append(formularioApodo());

  const ranking = $('#apodo-ranking');
  ranking.replaceChildren();
  if (!vistaDiaria.apodo || editandoApodo) {
    ranking.append(formularioApodo(vistaDiaria.apodo ?? ''));
  } else {
    const p = crear('p', 'apodo-actual');
    const cambiar = crear('button', null, 'Cambiar');
    cambiar.type = 'button';
    cambiar.addEventListener('click', () => {
      editandoApodo = true;
      pintarApodos();
    });
    p.append('Jugás como ', crear('strong', null, vistaDiaria.apodo), '. ', cambiar);
    ranking.append(p);
  }
}

// ───────────── Ranking ─────────────

async function cargarRanking() {
  const lista = $('#puestos');
  const vacio = $('#ranking-vacio');
  try {
    const d = await api(`/api/ranking?tipo=${tipoRanking}`);
    lista.replaceChildren(
      ...d.filas.map((f) => {
        const li = crear('li', `puesto${f.yo ? ' puesto--yo' : ''}`);
        const nombre = crear('span', 'puesto-apodo', f.apodo);
        const detalle =
          d.tipo === 'dia'
            ? f.estado === 'ganado'
              ? f.pistas === 0 ? 'sin pistas' : `${f.pistas} ${f.pistas === 1 ? 'pista pedida' : 'pistas pedidas'}`
              : 'no salió'
            : `${f.ganados} de ${f.dias} ${f.dias === 1 ? 'día' : 'días'}`;
        nombre.append(crear('small', null, f.yo ? `Vos · ${detalle}` : detalle));
        li.append(crear('span', 'puesto-n', String(f.puesto)), nombre, crear('span', 'puesto-puntos', String(f.puntaje)));
        return li;
      }),
    );
    vacio.hidden = d.filas.length > 0;
    vacio.textContent =
      d.tipo === 'dia'
        ? 'Todavía nadie terminó la partida de hoy. Jugá y quedá primero.'
        : 'Todavía no hay partidas terminadas en los últimos 30 días.';
  } catch (error) {
    lista.replaceChildren();
    vacio.hidden = false;
    vacio.textContent = error.message;
  }
}

// ───────────── Práctica ─────────────

const nombreDe = (lista, id) => lista?.find((x) => x.id === id)?.nombre ?? id;

function resumenPractica(v) {
  const base = `${nombreDe(opcionesPractica?.grupos, v.grupo)} · ${nombreDe(opcionesPractica?.dificultades, v.dificultad)}`;
  return v.argentina ? `${base} · Pasaron por Argentina` : base;
}

function pintarOpcionesPractica() {
  if (!opcionesPractica) return;
  const grupos = $('#opciones-grupo');
  const dificultades = $('#opciones-dificultad');

  grupos.replaceChildren(
    ...opcionesPractica.grupos.map((g) => {
      const boton = crear('button', 'subpestana', g.nombre);
      boton.type = 'button';
      boton.disabled = g.cantidad === 0;
      boton.setAttribute('aria-pressed', String(eleccion.grupo === g.id));
      boton.append(crear('small', null, String(g.cantidad)));
      boton.addEventListener('click', () => {
        eleccion.grupo = g.id;
        guardarEleccion();
        pintarOpcionesPractica();
      });
      return boton;
    }),
  );

  dificultades.replaceChildren(
    ...opcionesPractica.dificultades.map((d) => {
      const boton = crear('button', 'subpestana', d.nombre);
      boton.type = 'button';
      boton.setAttribute('aria-pressed', String(eleccion.dificultad === d.id));
      boton.addEventListener('click', () => {
        eleccion.dificultad = d.id;
        guardarEleccion();
        pintarOpcionesPractica();
      });
      return boton;
    }),
  );
  $('#dificultad-detalle').textContent =
    opcionesPractica.dificultades.find((d) => d.id === eleccion.dificultad)?.detalle ?? '';
  $('#practica-argentina').checked = eleccion.argentina;
}

// Los contadores de cada grupo dependen del checkbox: hay que volver a pedirlos cuando cambia.
async function cargarPractica() {
  try {
    const ruta = `/api/practica/estado${eleccion.argentina ? '?argentina=1' : ''}`;
    const d = await api(ruta);
    opcionesPractica = { grupos: d.grupos, dificultades: d.dificultades };
    if (!opcionesPractica.grupos.some((g) => g.id === eleccion.grupo && g.cantidad > 0)) eleccion.grupo = 'todos';
    if (!opcionesPractica.dificultades.some((x) => x.id === eleccion.dificultad)) eleccion.dificultad = 'todas';
    if (d.partida && !vistaPractica) vistaPractica = d.partida;
    pintarOpcionesPractica();
    $('#practica-mensaje').textContent = '';
  } catch (error) {
    $('#practica-mensaje').textContent = error.message;
    $('#practica-mensaje').classList.add('mensaje--error');
  }
}

async function empezarPractica() {
  const boton = $('#practica-jugar');
  boton.disabled = true;
  try {
    const v = await api('/api/practica/nueva', { grupo: eleccion.grupo, dificultad: eleccion.dificultad, argentina: eleccion.argentina });
    vistaPractica = null; // es otra partida: las pistas aparecen con el giro
    mostrar('juego', 'practica');
    limpiarCampo();
    mensaje('');
    pintar(v);
    $('#q').focus();
  } catch (error) {
    $('#practica-mensaje').textContent = error.message;
    $('#practica-mensaje').classList.add('mensaje--error');
  } finally {
    boton.disabled = false;
  }
}

// ───────────── Pestañas ─────────────

const SECCIONES = { juego: 'vista-juego', practica: 'vista-practica', ranking: 'vista-ranking' };

// `cual` es la pantalla. Para 'juego', `modo` dice qué partida se muestra: la diaria o la de práctica.
function mostrar(cual, modo = 'diario') {
  pantalla = cual;
  const jugando = cual === 'juego';
  for (const [nombre, id] of Object.entries(SECCIONES)) $(`#${id}`).hidden = nombre !== cual;

  // La pestaña "Práctica" queda marcada también mientras se juega una práctica.
  const activa = jugando && modo === 'practica' ? 'practica' : cual;
  for (const nombre of Object.keys(SECCIONES)) {
    const pestana = $(`#pestana-${nombre}`);
    pestana.toggleAttribute('aria-current', nombre === activa);
    if (nombre === activa) pestana.setAttribute('aria-current', 'page');
  }

  if (jugando) {
    const v = modo === 'practica' ? vistaPractica : vistaDiaria;
    if (v) {
      mensaje('');
      limpiarCampo();
      pintar(v);
    }
  }
  if (cual === 'practica') cargarPractica();
  if (cual === 'ranking') cargarRanking();
  history.replaceState(null, '', cual === 'juego' ? location.pathname + location.search : `#${cual}`);
}

// Al tocar "Práctica": si hay una partida sin terminar se sigue, si no se elige qué jugar.
async function abrirPractica() {
  if (!opcionesPractica) await cargarPractica();
  if (vistaPractica?.estado === 'jugando') mostrar('juego', 'practica');
  else mostrar('practica');
}

// ───────────── Arranque ─────────────

async function iniciar() {
  configurarCampo();
  configurarModal();
  $('#form').addEventListener('submit', arriesgar);
  $('#pedir').addEventListener('click', abrirModal);
  $('#pestana-juego').addEventListener('click', () => mostrar('juego'));
  $('#pestana-practica').addEventListener('click', abrirPractica);
  $('#pestana-ranking').addEventListener('click', () => mostrar('ranking'));
  $('#practica-jugar').addEventListener('click', empezarPractica);
  $('#practica-cambiar').addEventListener('click', () => mostrar('practica'));
  $('#practica-filtros').addEventListener('click', () => mostrar('practica'));
  $('#practica-otro').addEventListener('click', async () => {
    if (!vistaPractica) return;
    eleccion = { grupo: vistaPractica.grupo, dificultad: vistaPractica.dificultad, argentina: Boolean(vistaPractica.argentina) };
    await empezarPractica();
  });
  $('#practica-argentina').addEventListener('change', (e) => {
    eleccion.argentina = e.target.checked;
    guardarEleccion();
    cargarPractica();
  });
  $('#ver-ranking').addEventListener('click', () => mostrar('ranking'));
  $('#compartir').addEventListener('click', compartirTexto);
  for (const boton of document.querySelectorAll('.subpestana')) {
    boton.addEventListener('click', () => {
      tipoRanking = boton.dataset.tipo;
      for (const b of document.querySelectorAll('.subpestana')) b.setAttribute('aria-pressed', String(b === boton));
      cargarRanking();
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && vista) refrescarDia();
  });

  cargarJugadores().catch(() => {}); // si falla, se puede jugar igual escribiendo el nombre completo

  try {
    pintar(await api('/api/hoy'));
  } catch (error) {
    mensaje(error.message, true);
    const reintentar = crear('button', 'boton boton--borde', 'Reintentar');
    reintentar.type = 'button';
    reintentar.addEventListener('click', () => location.reload());
    $('#mensaje').after(reintentar);
  }
  if (location.hash === '#ranking') mostrar('ranking');
  else if (location.hash === '#practica') abrirPractica();
}

iniciar();
