import { config } from './config.mjs';
import { correrConAvisoDeFalla } from './correr.mjs';

/**
 * Procesa varias fuentes en orden. Una falla no frena a las demás (ya se avisó por WhatsApp una sola
 * vez dentro de `correrConAvisoDeFalla`). El tope total de mensajes por corrida se reparte en orden:
 * cada fuente recibe lo que queda, hasta su propio tope. Las ofertas que no entran quedan sin marcar y
 * se avisan en la corrida siguiente.
 *
 * Devuelve `{ resultados, fallaron, mensajesUsados }`; cada resultado es `{ nombre, ok, resultado | error }`.
 */
export async function correrFuentes({
  nombres,
  fuentes,
  fecha,
  dryRun = false,
  directorioDatos = 'datos',
  crearCliente,
  corrida = correrConAvisoDeFalla,
  maxMensajesTotal = config.maxMensajesTotalPorCorrida,
  maxMensajesPorFuente = config.maxMensajesPorCorrida,
  log = console.log,
  extra = {},
}) {
  const resultados = [];
  let restantes = maxMensajesTotal;
  // Lo comparten todas las tiendas: si CallMeBot rechaza un mensaje (el límite), ninguna otra intenta enviar.
  const estadoEnvio = { enviados: 0, bloqueado: false };

  for (const nombre of nombres) {
    const fuente = fuentes[nombre];
    try {
      const resultado = await corrida({
        nombre,
        titulo: fuente.titulo,
        leer: fuente.leer,
        cliente: crearCliente(),
        fecha,
        dryRun,
        directorioDatos,
        maxMensajes: Math.min(maxMensajesPorFuente, restantes),
        estadoEnvio,
        log,
        ...extra,
      });
      restantes -= resultado.mensajesUsados ?? resultado.mensajes;
      resultados.push({ nombre, ok: true, resultado });
    } catch (error) {
      resultados.push({ nombre, ok: false, error });
    }
  }

  return {
    resultados,
    fallaron: resultados.filter((r) => !r.ok).map((r) => r.nombre),
    mensajesUsados: maxMensajesTotal - restantes,
    limiteEnvio: estadoEnvio.bloqueado,
  };
}
