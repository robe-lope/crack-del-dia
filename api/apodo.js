import { ErrorHttp, enviar, exigirMetodo, leerCuerpo, leerToken, manejar } from '../lib/http.js';
import { fijarApodo } from '../lib/store.js';

// De 2 a 20 caracteres, empieza y termina con letra o número.
const APODO = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,18}[\p{L}\p{N}]$/u;

// POST /api/apodo  { apodo }
export default manejar(async (req, res) => {
  exigirMetodo(req, 'POST');
  const token = leerToken(req);
  const apodo = String(leerCuerpo(req).apodo ?? '').trim().replace(/\s+/g, ' ');
  if (!APODO.test(apodo)) {
    throw new ErrorHttp(
      422,
      'apodo',
      'El apodo tiene entre 2 y 20 caracteres: letras, números, espacios, punto, guion o guion bajo.',
    );
  }
  await fijarApodo(token, apodo);
  enviar(res, 200, { apodo });
});
