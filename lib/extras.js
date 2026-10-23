// Elige apodo, palmarés, lugar de nacimiento y dorsal a partir de lo que trae Wikidata (y de las
// correcciones manuales). Sin red: así se puede testear con respuestas simuladas.
// Lo usan bajar-extras.mjs y los tests.
import { normalizar } from './juego.js';

// candidatos: [{ idioma: 'es' | 'en' | ..., valor: string }]  (las etiquetas de P1449, en los idiomas que haya)
// Se prefiere español, después inglés, después cualquier otro. Se descartan vacíos y los que
// son el propio nombre del jugador (Wikidata a veces repite el nombre como "apodo").
export function elegirApodo(candidatos, nombreJugador) {
  const limpios = (candidatos ?? [])
    .map((c) => ({ idioma: c.idioma, valor: String(c.valor ?? '').trim() }))
    .filter((c) => c.valor && normalizar(c.valor) !== normalizar(nombreJugador));
  if (!limpios.length) return null;
  const elegido = limpios.find((c) => c.idioma === 'es') ?? limpios.find((c) => c.idioma === 'en') ?? limpios[0];
  return elegido.valor;
}

// Limpia una lista de textos: sin vacíos, sin repetidos (comparando normalizado), en el orden en que llegaron.
export function limpiarLista(valores) {
  const vistos = new Set();
  const limpios = [];
  for (const v of valores ?? []) {
    const texto = String(v ?? '').trim();
    if (!texto) continue;
    const clave = normalizar(texto);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    limpios.push(texto);
  }
  return limpios;
}

// "Ciudad, País" a partir de P19 (lugar de nacimiento) y, si se puede, P17 de ese lugar (país).
export function armarLugarNacimiento(ciudad, pais) {
  const c = String(ciudad ?? '').trim();
  const p = String(pais ?? '').trim();
  if (c && p) return normalizar(c) === normalizar(p) ? c : `${c}, ${p}`;
  return c || p || null;
}

// Puede haber más de un P1618 (uno por club, o declaraciones repetidas): se elige el más repetido
// y, en caso de empate, el primero que apareció.
export function elegirDorsal(dorsales) {
  const validos = (dorsales ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 100);
  if (!validos.length) return null;
  const conteo = new Map();
  for (const n of validos) conteo.set(n, (conteo.get(n) ?? 0) + 1);
  let mejor = validos[0];
  let max = 0;
  for (const n of validos) {
    const c = conteo.get(n);
    if (c > max) {
      max = c;
      mejor = n;
    }
  }
  return mejor;
}

// Arma una línea de palmarés por cada Mundial en el que participó (P1344), marcando "Campeón" si
// el ganador de esa edición (P1346) coincide con alguna de las selecciones en las que jugó.
// eventos: [{ anio: number|null, ganador: string|null }]   selecciones: string[] (nombres de equipo)
export function palmaresDeMundiales(eventos, selecciones = []) {
  const equipos = (selecciones ?? []).map(normalizar).filter(Boolean);
  const lineas = (eventos ?? [])
    .filter((e) => e.anio != null)
    .sort((a, b) => a.anio - b.anio)
    .map((e) => {
      // El ganador de la edición puede venir como "España" o como "selección de fútbol de España":
      // alcanza con que uno contenga al otro.
      const ganador = e.ganador ? normalizar(e.ganador) : '';
      const campeon = ganador && equipos.some((eq) => eq.includes(ganador) || ganador.includes(eq));
      return campeon ? `Campeón del Mundial ${e.anio}` : `Mundial ${e.anio}`;
    });
  return limpiarLista(lineas);
}

/**
 * Fusiona lo bajado de Wikidata con las correcciones manuales (que siempre ganan) para un jugador,
 * y devuelve solo los campos que quedaron con algo ({} si no se consiguió nada).
 *
 * @param jugador  { id, nombre, selecciones: [{ equipo }] }
 * @param bajado   { apodos, premios, ciudadNacimiento, paisNacimiento, dorsales, mundiales } o undefined
 * @param manual   { [id]: { apodo?, palmares?, lugarNacimiento?, dorsal?, curiosidades? } }
 */
export function armarExtras(jugador, bajado, manual = {}) {
  const m = manual[jugador.id] ?? {};
  const extras = {};

  const apodo = 'apodo' in m ? m.apodo : elegirApodo(bajado?.apodos, jugador.nombre);
  if (apodo) extras.apodo = String(apodo).trim();

  const equipos = (jugador.selecciones ?? []).map((s) => s.equipo);
  const palmares = limpiarLista(
    'palmares' in m
      ? m.palmares
      : [...(bajado?.premios ?? []), ...palmaresDeMundiales(bajado?.mundiales, equipos)],
  );
  if (palmares.length) extras.palmares = palmares;

  const lugarNacimiento =
    'lugarNacimiento' in m ? m.lugarNacimiento : armarLugarNacimiento(bajado?.ciudadNacimiento, bajado?.paisNacimiento);
  if (lugarNacimiento) extras.lugarNacimiento = String(lugarNacimiento).trim();

  const dorsal = 'dorsal' in m ? m.dorsal : elegirDorsal(bajado?.dorsales);
  if (dorsal != null && dorsal !== '') extras.dorsal = Number(dorsal);

  const curiosidades = limpiarLista(m.curiosidades);
  if (curiosidades.length) extras.curiosidades = curiosidades;

  return extras;
}
