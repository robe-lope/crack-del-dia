import { enviar, exigirMetodo, leerToken, manejar } from '../../lib/http.js';
import { estado } from '../../lib/practica.js';

// GET /api/practica/estado?argentina=1: la práctica en curso (si hay) y las opciones para empezar
// otra. El flag "argentina" recalcula los contadores por grupo según el checkbox.
export default manejar(async (req, res) => {
  exigirMetodo(req, 'GET');
  const argentina = ['1', 'true'].includes(String(req.query?.argentina ?? ''));
  enviar(res, 200, await estado(leerToken(req), argentina));
});
