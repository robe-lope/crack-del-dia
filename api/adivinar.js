import { enviar, exigirMetodo, fechaDeLaPartida, leerCuerpo, leerToken, manejar } from '../lib/http.js';
import { adivinar } from '../lib/partida.js';

// POST /api/adivinar  { id } o { texto }
export default manejar(async (req, res) => {
  exigirMetodo(req, 'POST');
  const { id, texto } = leerCuerpo(req);
  enviar(res, 200, await adivinar(fechaDeLaPartida(req), leerToken(req), { id, texto }));
});
