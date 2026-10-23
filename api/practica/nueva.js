import { enviar, exigirMetodo, leerCuerpo, leerToken, manejar } from '../../lib/http.js';
import { nueva } from '../../lib/practica.js';

// POST /api/practica/nueva  { grupo, dificultad }
export default manejar(async (req, res) => {
  exigirMetodo(req, 'POST');
  const { grupo, dificultad } = leerCuerpo(req);
  enviar(res, 200, await nueva(leerToken(req), { grupo, dificultad }));
});
