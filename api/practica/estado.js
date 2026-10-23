import { enviar, exigirMetodo, leerToken, manejar } from '../../lib/http.js';
import { estado } from '../../lib/practica.js';

// GET /api/practica/estado: la práctica en curso (si hay) y las opciones para empezar otra.
export default manejar(async (req, res) => {
  exigirMetodo(req, 'GET');
  enviar(res, 200, await estado(leerToken(req)));
});
