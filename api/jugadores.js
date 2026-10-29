import { createHash } from 'node:crypto';
import { datos } from '../lib/datos.js';
import { exigirMetodo, manejar } from '../lib/http.js';
import { normalizar } from '../lib/juego.js';

let respuesta;

// Solo lo mínimo para el autocompletado: id, nombre, apodos y (si hay dos con el mismo nombre) el año
// de nacimiento para distinguirlos. Se arma una vez por instancia, con su ETag.
function armar() {
  const { lista: todos } = datos();
  const repetidos = new Map();
  for (const j of todos) {
    const clave = normalizar(j.nombre);
    repetidos.set(clave, (repetidos.get(clave) ?? 0) + 1);
  }
  const jugadores = todos.map((j) => ({
    id: j.id,
    n: j.nombre,
    a: (j.alias ?? []).slice(0, 6),
    ...(repetidos.get(normalizar(j.nombre)) > 1 && j.nacimiento ? { e: j.nacimiento } : {}),
  }));
  const cuerpo = JSON.stringify({ jugadores });
  const etag = `"${createHash('sha1').update(cuerpo).digest('base64url').slice(0, 20)}"`;
  return { cuerpo, etag };
}

// GET /api/jugadores: nombres y apodos para el autocompletado (incluye a todos, así no se filtra cuál puede salir).
// Cambia solo cuando cambian los datos: se cachea en la CDN y el navegador revalida con el ETag (304).
export default manejar(async (req, res) => {
  exigirMetodo(req, 'GET');
  respuesta ??= armar();
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.setHeader('ETag', respuesta.etag);
  const pedido = String(req.headers['if-none-match'] ?? '');
  if (pedido.split(',').some((e) => e.trim().replace(/^W\//, '') === respuesta.etag)) {
    res.statusCode = 304;
    return res.end();
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(respuesta.cuerpo);
});
