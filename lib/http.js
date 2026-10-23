// Utilidades comunes de los endpoints.
import { fechaDeHoy, fechaValida } from './juego.js';

export class ErrorHttp extends Error {
  constructor(status, codigo, mensaje) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

export function enviar(res, status, cuerpo, cabeceras = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [clave, valor] of Object.entries(cabeceras)) res.setHeader(clave, valor);
  res.end(JSON.stringify(cuerpo));
}

export function exigirMetodo(req, metodo) {
  if (req.method !== metodo) throw new ErrorHttp(405, 'metodo', `Este endpoint acepta solo ${metodo}.`);
}

// El token es el "documento" anónimo de cada navegador: se genera en el cliente y viaja en un header.
export function leerToken(req) {
  const token = req.headers['x-token'];
  if (typeof token !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(token)) {
    throw new ErrorHttp(401, 'token', 'No pudimos identificar tu navegador. Recargá la página.');
  }
  return token;
}

export function leerCuerpo(req) {
  const cuerpo = req.body;
  if (typeof cuerpo === 'string') {
    try {
      return JSON.parse(cuerpo);
    } catch {
      return {};
    }
  }
  return cuerpo && typeof cuerpo === 'object' ? cuerpo : {};
}

// Para probar otros días en desarrollo: ?fecha=2026-11-05 (solo si PERMITIR_FECHA=1).
export function fechaDeLaPartida(req) {
  if (process.env.PERMITIR_FECHA === '1' && fechaValida(req.query?.fecha)) return req.query.fecha;
  return fechaDeHoy();
}

export function manejar(funcion) {
  return async (req, res) => {
    try {
      await funcion(req, res);
    } catch (e) {
      if (e instanceof ErrorHttp) return enviar(res, e.status, { error: e.codigo, mensaje: e.message });
      console.error(e);
      enviar(res, 500, { error: 'interno', mensaje: 'Algo salió mal de nuestro lado. Probá de nuevo en un rato.' });
    }
  };
}
