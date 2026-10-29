import { enviar, exigirMetodo, fechaDeLaPartida, leerToken, manejar } from '../lib/http.js';
import { estadoDelDia } from '../lib/partida.js';
import { crearMedidor } from '../lib/tiempos.js';

// GET /api/hoy: cómo va la partida de hoy (solo las pistas ya abiertas).
// Manda Server-Timing con cada tramo (esquema, datos, consultas, vista y total) para ver dónde se va el tiempo.
export default manejar(async (req, res) => {
  exigirMetodo(req, 'GET');
  const medidor = crearMedidor();
  const vista = await estadoDelDia(fechaDeLaPartida(req), leerToken(req), medidor);
  enviar(res, 200, vista, { 'Server-Timing': medidor.header() });
});
