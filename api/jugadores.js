import { datos } from '../lib/datos.js';
import { enviar, exigirMetodo, manejar } from '../lib/http.js';
import { normalizar } from '../lib/juego.js';

let lista;

// GET /api/jugadores: nombres y apodos para el autocompletado (incluye a todos, así no se filtra cuál puede salir).
export default manejar(async (req, res) => {
  exigirMetodo(req, 'GET');
  if (!lista) {
    const { lista: todos } = datos();
    const repetidos = new Map();
    for (const j of todos) {
      const clave = normalizar(j.nombre);
      repetidos.set(clave, (repetidos.get(clave) ?? 0) + 1);
    }
    lista = todos.map((j) => ({
      id: j.id,
      n: j.nombre,
      a: (j.alias ?? []).slice(0, 6),
      // Si hay dos con el mismo nombre, se muestra el año de nacimiento para distinguirlos.
      ...(repetidos.get(normalizar(j.nombre)) > 1 && j.nacimiento ? { e: j.nacimiento } : {}),
    }));
  }
  enviar(res, 200, { jugadores: lista }, { 'Cache-Control': 'public, max-age=3600' });
});
