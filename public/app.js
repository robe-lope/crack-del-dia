// Crack del Día: pantalla del juego diario.
// El servidor decide todo (qué pistas se ven, si acertaste, cuántos puntos). Acá solo se dibuja y se escribe.

const NOMBRE = 'Crack del Día';
const SILUETA =
  '<svg viewBox="0 0 64 64" focusable="false" aria-hidden="true"><circle cx="32" cy="24" r="11"/><path d="M8 64c1-15 10-23 24-23s23 8 24 23z"/></svg>';

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
    if (guardada?.grupo && guardada?.dificultad) return guardada;
  } catch {
    /* sin almacenamiento */
  }
  return { grupo: 'todos', dificultad: 'todas' };
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

function pintarFilas(v, previas) {
  const lista = $('#pistas');
  lista.replaceChildren();

  const items = [
    ...v.pistas.map((p, i) => ({ ...p, revelada: true, indice: i })),
    ...v.pendientes.map((p) => ({ ...p, revelada: false })),
  ];

  let anterior = null;
  for (const item of items) {
    if (item.tipo === 'club' && anterior && anterior.tipo !== 'club') {
      const separador = crear('li', 'linea');
      separador.setAttribute('role', 'presentation');
      lista.append(separador);
    }
    anterior = item;

    const fila = crear('li', `fila${item.tipo === 'club' ? ' fila--club' : ''}`);
    fila.append(crear('span', 'fila-etiqueta', item.etiqueta));
    const valor = crear('div', 'valor');

    if (item.revelada) {
      const nueva = item.indice >= previas;
      if (v.estado !== 'jugando' && item.indice >= v.pistasUsadas) fila.classList.add('fila--sin-usar');
      item.valor.split(' ').forEach((palabra, k) => {
        const paleta = crear('span', `paleta${nueva ? ' paleta--nueva' : ''}`, palabra);
        if (nueva) paleta.style.setProperty('--i', String(item.indice - previas + k * 0.5));
        valor.append(paleta);
      });
    } else {
      const paleta = crear('span', 'paleta paleta--pendiente', '?');
      paleta.setAttribute('aria-hidden', 'true');
      valor.append(paleta, crear('span', 'sr', 'Pista sin abrir'));
    }
    fila.append(valor);
    lista.append(fila);
  }
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

function pintar(v) {
  const practica = v.modo === 'practica';
  const anterior = practica ? vistaPractica : vistaDiaria;
  const previas = anterior && anterior.partida === v.partida ? anterior.pistas.length : 0;
  vista = v;
  if (practica) vistaPractica = v;
  else vistaDiaria = v;
  const terminada = v.estado !== 'jugando';

  $('#num').textContent = practica ? 'Práctica' : `Nº ${v.numero}`;
  $('#racha').textContent = !practica && v.racha > 0 ? `Racha ${v.racha}` : '';
  $('#practica-barra').hidden = !practica;
  if (practica) $('#practica-resumen').textContent = resumenPractica(v);
  $('#aviso-ejemplo').hidden = !v.ejemplo;
  $('#contador').textContent = terminada ? 'Partida terminada' : `Pista ${v.pistasUsadas} de ${v.totalPistas}`;
  pintarPais(v.pais);

  pintarFilas(v, previas);

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
  const sinMasPistas = v.pistasUsadas >= v.totalPistas;
  $('#pedir').disabled = sinMasPistas;
  const valor = $('#valor');
  if (!terminada) {
    valor.replaceChildren('Si acertás ahora: ', crear('strong', null, `${v.puntajeActual} puntos`));
    if (sinMasPistas) valor.append(' · Ya están todas las pistas.');
  }

  pintarFinal(v);
  pintarApodos();
}

function pintarFinal(v) {
  const final = $('#final');
  const terminada = v.estado !== 'jugando';
  final.hidden = !terminada;
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
  $('#final-titulo').textContent = gano ? `¡Era ${v.resultado.nombre}!` : `Era ${v.resultado.nombre}`;

  const detalle = $('#final-detalle');
  detalle.replaceChildren();
  if (gano) {
    detalle.append(`Lo sacaste con ${v.pistasUsadas} de ${v.totalPistas} pistas: `, crear('strong', null, `${v.puntaje} puntos`), '.');
  } else {
    detalle.append(`Gastaste los ${v.intentosMax} intentos y no salió. Mañana hay otro jugador.`);
  }

  const foto = $('#final-foto');
  foto.innerHTML = SILUETA;
  const credito = $('#final-credito');
  credito.hidden = true;
  if (v.resultado.foto) {
    const img = new Image();
    img.alt = v.resultado.nombre;
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      foto.replaceChildren(img);
      if (v.resultado.fotoPagina) {
        const enlace = crear('a', null, 'Wikimedia Commons');
        enlace.href = v.resultado.fotoPagina;
        enlace.target = '_blank';
        enlace.rel = 'noopener noreferrer';
        credito.replaceChildren('Foto: ', enlace);
        credito.hidden = false;
      }
    };
    img.src = v.resultado.foto; // si no carga, queda la silueta
  }

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

function ocupado(si) {
  $('#arriesgar').disabled = si;
  $('#pedir').disabled = si || (vista && vista.pistasUsadas >= vista.totalPistas);
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

async function pedirPista() {
  if (!vista || vista.estado !== 'jugando') return;
  ocupado(true);
  try {
    const practica = vista.modo === 'practica';
    pintar(await api(practica ? '/api/practica/pista' : '/api/pista', practica ? { partida: vista.partida } : {}));
    mensaje('');
  } catch (error) {
    mensaje(error.message, true);
  } finally {
    ocupado(false);
  }
}

// ───────────── Compartir ─────────────

function textoParaCompartir(v) {
  const gano = v.estado === 'ganado';
  const errores = v.intentos.length;
  const pistas = '🟨'.repeat(v.pistasUsadas) + '⬜'.repeat(v.totalPistas - v.pistasUsadas);
  const intentos = '🟥'.repeat(errores) + (gano ? '🟩' : '') + '⬜'.repeat(Math.max(0, v.intentosMax - errores - (gano ? 1 : 0)));
  const resultado = gano
    ? `${v.pistasUsadas}/${v.totalPistas} pistas · ${errores === 0 ? 'sin errores' : errores === 1 ? '1 error' : `${errores} errores`}`
    : 'No salió';
  return `${NOMBRE} Nº${v.numero}\n${resultado}\nPistas ${pistas}\nIntentos ${intentos}\n${location.origin}`;
}

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
            ? f.estado === 'ganado' ? `${f.pistas} ${f.pistas === 1 ? 'pista' : 'pistas'}` : 'no salió'
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
  return `${nombreDe(opcionesPractica?.grupos, v.grupo)} · ${nombreDe(opcionesPractica?.dificultades, v.dificultad)}`;
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
}

async function cargarPractica() {
  try {
    const d = await api('/api/practica/estado');
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
    const v = await api('/api/practica/nueva', { grupo: eleccion.grupo, dificultad: eleccion.dificultad });
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
  $('#form').addEventListener('submit', arriesgar);
  $('#pedir').addEventListener('click', pedirPista);
  $('#pestana-juego').addEventListener('click', () => mostrar('juego'));
  $('#pestana-practica').addEventListener('click', abrirPractica);
  $('#pestana-ranking').addEventListener('click', () => mostrar('ranking'));
  $('#practica-jugar').addEventListener('click', empezarPractica);
  $('#practica-cambiar').addEventListener('click', () => mostrar('practica'));
  $('#practica-filtros').addEventListener('click', () => mostrar('practica'));
  $('#practica-otro').addEventListener('click', async () => {
    if (!vistaPractica) return;
    eleccion = { grupo: vistaPractica.grupo, dificultad: vistaPractica.dificultad };
    await empezarPractica();
  });
  $('#ver-ranking').addEventListener('click', () => mostrar('ranking'));
  $('#compartir').addEventListener('click', async () => {
    const ok = await copiar(textoParaCompartir(vistaDiaria));
    mensaje(ok ? 'Resultado copiado. Pegalo donde quieras.' : 'No pudimos copiarlo. Seleccioná y copiá el texto a mano.', !ok);
  });
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
