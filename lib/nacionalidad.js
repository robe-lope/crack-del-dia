// Elige la nacionalidad (y por lo tanto la bandera) de un jugador a partir de las ciudadanías de Wikidata.
// Sin dependencias: la usan el script que baja los datos y los tests.

const norm = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Reino Unido no tiene bandera de fútbol: se usa la de la selección en la que jugó (Inglaterra, Escocia...).
const NACIONES_BRITANICAS = [
  { patron: /\birlanda del norte\b/, codigo: 'gb-nir', nombre: 'Irlanda del Norte' },
  { patron: /\bescocia\b/, codigo: 'gb-sct', nombre: 'Escocia' },
  { patron: /\bgales\b/, codigo: 'gb-wls', nombre: 'Gales' },
  { patron: /\binglaterra\b/, codigo: 'gb-eng', nombre: 'Inglaterra' },
];

const CODIGO_POR_ORIGEN = { Argentinos: 'ar' };

/**
 * @param candidatos  [{ codigo: 'ar' | null, nombre: 'Argentina' }]  ciudadanías del jugador en Wikidata
 * @param jugador     { id, origen, selecciones: [{ equipo }] }
 * @param manual      { [id]: [codigo, nombre] }  correcciones hechas a mano
 * @returns           { codigo, nombre } o null si no se pudo decidir
 */
export function elegirNacionalidad(candidatos, jugador, manual = {}) {
  if (manual[jugador.id]) {
    const [codigo, nombre] = manual[jugador.id];
    return { codigo: String(codigo).toLowerCase(), nombre: nombre ?? String(codigo).toUpperCase() };
  }

  const equipos = (jugador.selecciones ?? []).map((s) => norm(s.equipo));
  const conCodigo = (candidatos ?? []).filter((c) => c.codigo).map((c) => ({ codigo: c.codigo.toLowerCase(), nombre: c.nombre }));
  if (!conCodigo.length) return null;

  const britanica = NACIONES_BRITANICAS.find((n) => equipos.some((e) => n.patron.test(e)));
  const resolver = (c) => (c.codigo === 'gb' && britanica ? { codigo: britanica.codigo, nombre: britanica.nombre } : c);

  // 1. El país de la selección en la que jugó (Diego Costa: nació en Brasil pero juega para España).
  const porSeleccion = conCodigo.find(
    (c) => (c.codigo === 'gb' && britanica) || equipos.some((e) => e.includes(norm(c.nombre))),
  );
  if (porSeleccion) return resolver(porSeleccion);

  // 2. El grupo con el que se lo descargó (los argentinos son argentinos).
  const porOrigen = conCodigo.find((c) => c.codigo === CODIGO_POR_ORIGEN[jugador.origen]);
  if (porOrigen) return porOrigen;

  // 3. La primera ciudadanía conocida.
  return resolver(conCodigo[0]);
}
