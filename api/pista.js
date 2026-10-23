import { enviar, exigirMetodo, fechaDeLaPartida, leerToken, manejar } from '../lib/http.js';
import { pedirPista } from '../lib/partida.js';

// POST /api/pista: abre la próxima pista sin arriesgar.
export default manejar(async (req, res) => {
  exigirMetodo(req, 'POST');
  enviar(res, 200, await pedirPista(fechaDeLaPartida(req), leerToken(req)));
});
