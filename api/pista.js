import { enviar, exigirMetodo, fechaDeLaPartida, leerCuerpo, leerToken, manejar } from '../lib/http.js';
import { pedirPista } from '../lib/partida.js';

// POST /api/pista  { categoria }: revela la próxima pista de esa categoría, sin arriesgar.
export default manejar(async (req, res) => {
  exigirMetodo(req, 'POST');
  const { categoria } = leerCuerpo(req);
  enviar(res, 200, await pedirPista(fechaDeLaPartida(req), leerToken(req), categoria));
});
