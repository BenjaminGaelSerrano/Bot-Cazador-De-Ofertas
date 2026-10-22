import { config } from '../config.mjs';

/** Falla al enviar el WhatsApp (distinta de una falla al leer el sitio). */
export class ErrorNotificacion extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorNotificacion';
    this.tipo = 'notificacion';
  }
}

/**
 * Agrupa ofertas (`{ texto }`) en mensajes de WhatsApp respetando los topes. Lo que no entra se
 * resume al final como "y N más". Devuelve `{ mensajes, porMensaje, incluidas }`: `porMensaje[i]` es
 * cuántas ofertas lleva el mensaje i, para poder marcar como avisadas solo las que se enviaron.
 */
export function agrupar(ofertas, {
  titulo,
  maxPorMensaje = config.maxOfertasPorMensaje,
  maxMensajes = config.maxMensajesPorCorrida,
  maxCaracteres = config.maxCaracteres,
  maxCodificados = config.maxCodificados,
} = {}) {
  const mensajes = [];
  const porMensaje = [];
  let i = 0;

  while (i < ofertas.length && mensajes.length < maxMensajes) {
    let texto = mensajes.length === 0 ? `${titulo} (${ofertas.length})` : `${titulo} (cont.)`;
    let enEste = 0;

    while (i < ofertas.length && enEste < maxPorMensaje) {
      // "N)" y no "N.": WhatsApp convierte las líneas que empiezan con "N." en una lista numerada.
      const linea = `\n\n${i + 1}) ${ofertas[i].texto}`;
      const candidato = texto + linea;
      // Siempre entra al menos una oferta por mensaje; las demás solo si no pasan ninguno de los dos topes.
      if (enEste > 0 && (candidato.length > maxCaracteres || encodeURIComponent(candidato).length > maxCodificados)) break;
      texto = candidato;
      i++;
      enEste++;
    }
    mensajes.push(texto);
    porMensaje.push(enEste);
  }

  if (i < ofertas.length && mensajes.length > 0) mensajes[mensajes.length - 1] += `\ny ${ofertas.length - i} más.`;
  return { mensajes, porMensaje, incluidas: i };
}

export const armarMensajes = (ofertas, opciones) => agrupar(ofertas, opciones).mensajes;

/**
 * Manda un texto por CallMeBot al número propio. Con `dryRun` o sin credenciales solo lo imprime.
 * Nunca incluye la clave en logs ni en mensajes de error.
 */
export async function enviar(texto, {
  phone = process.env.CALLMEBOT_PHONE,
  apikey = process.env.CALLMEBOT_APIKEY,
  dryRun = false,
  fetchFn = fetch,
  log = console.log,
} = {}) {
  if (dryRun) {
    log(`[dry-run] WhatsApp:\n${texto}`);
    return { enviado: false, motivo: 'dry-run' };
  }
  if (!phone || !apikey) {
    log(`(sin WhatsApp) ${texto}`);
    return { enviado: false, motivo: 'sin-credenciales' };
  }

  // CallMeBot corta sin avisar los mensajes largos. Si el mensaje no entra, se falla acá y NO se envía: mandarlo
  // cortado haría que las ofertas del final se den por avisadas sin que nadie las haya visto.
  if (encodeURIComponent(texto).length > config.maxCodificadosDuro) {
    throw new ErrorNotificacion(`El mensaje es demasiado largo para CallMeBot (${texto.length} caracteres)`);
  }

  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(apikey)}`;
  let res;
  try {
    res = await fetchFn(url);
  } catch {
    // No se propaga el error original: su mensaje o causa podrían traer la URL con la clave.
    throw new ErrorNotificacion('CallMeBot no respondió');
  }
  if (!res.ok) throw new ErrorNotificacion(`CallMeBot respondió ${res.status}`);
  return { enviado: true };
}
