import { enviar, exigirMetodo, fechaDeLaPartida, leerToken, manejar } from '../lib/http.js';
import { diaAnterior } from '../lib/juego.js';
import { rankingAcumulado, rankingDia } from '../lib/store.js';

// GET /api/ranking?tipo=dia|acumulado  (acumulado = últimos 30 días)
export default manejar(async (req, res) => {
  exigirMetodo(req, 'GET');
  const token = leerToken(req);
  const fecha = fechaDeLaPartida(req);
  const tipo = req.query?.tipo === 'acumulado' ? 'acumulado' : 'dia';

  const filas = tipo === 'dia' ? await rankingDia(fecha) : await rankingAcumulado(diaAnterior(fecha, 29), fecha);

  enviar(res, 200, {
    tipo,
    fecha,
    // Nunca se devuelve el token de otras personas: solo se marca cuál fila es la tuya.
    filas: filas.map((f, i) => ({
      puesto: i + 1,
      apodo: f.apodo ?? `Anónimo ${f.token.slice(0, 4)}`,
      puntaje: f.puntaje,
      ...(tipo === 'dia' ? { pistas: f.pistas, estado: f.estado } : { dias: f.dias, ganados: f.ganados }),
      yo: f.token === token,
    })),
  });
});
