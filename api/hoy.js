import { enviar, exigirMetodo, fechaDeLaPartida, leerToken, manejar } from '../lib/http.js';
import { estadoDelDia } from '../lib/partida.js';

// GET /api/hoy: cómo va la partida de hoy (solo las pistas ya abiertas).
export default manejar(async (req, res) => {
  exigirMetodo(req, 'GET');
  enviar(res, 200, await estadoDelDia(fechaDeLaPartida(req), leerToken(req)));
});
