import { enviar, exigirMetodo, leerCuerpo, leerToken, manejar } from '../../lib/http.js';
import { pedirPista } from '../../lib/practica.js';

// POST /api/practica/pista  { partida, categoria }
export default manejar(async (req, res) => {
  exigirMetodo(req, 'POST');
  const { partida, categoria } = leerCuerpo(req);
  enviar(res, 200, await pedirPista(leerToken(req), { partida, categoria }));
});
