import { enviar, exigirMetodo, leerCuerpo, leerToken, manejar } from '../../lib/http.js';
import { adivinar } from '../../lib/practica.js';

// POST /api/practica/adivinar  { partida, id } o { partida, texto }
export default manejar(async (req, res) => {
  exigirMetodo(req, 'POST');
  const { partida, id, texto } = leerCuerpo(req);
  enviar(res, 200, await adivinar(leerToken(req), { partida, id, texto }));
});
