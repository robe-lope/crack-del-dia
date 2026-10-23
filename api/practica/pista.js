import { enviar, exigirMetodo, leerCuerpo, leerToken, manejar } from '../../lib/http.js';
import { pedirPista } from '../../lib/practica.js';

// POST /api/practica/pista  { partida }
export default manejar(async (req, res) => {
  exigirMetodo(req, 'POST');
  enviar(res, 200, await pedirPista(leerToken(req), { partida: leerCuerpo(req).partida }));
});
