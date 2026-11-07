import { config } from '../config.mjs';
import { enviar as enviarCallmebot } from './callmebot.mjs';
import { enviarTelegram, telegramActivo } from './telegram.mjs';
import { paraWhatsapp } from './tarjetas.mjs';

// Canales de avisos (pedido del usuario, 2026-11-02: "los dos a la vez"). Telegram es el principal: si está configurado,
// todo sale por ahí y un fallo de Telegram es un fallo del envío. WhatsApp (CallMeBot) recibe una COPIA de cada mensaje,
// con su tope diario (deja de entregar en silencio pasado un límite que no publica); si la copia falla, no frena nada.
// Sin Telegram, WhatsApp es el único canal, con el comportamiento de siempre.

let cupoWhatsapp = Infinity;
let copiasWhatsapp = 0;

/** Cuántas copias por WhatsApp se pueden mandar en esta corrida (lo que queda del tope diario). */
export function limitarWhatsapp(cupo) {
  cupoWhatsapp = cupo;
  copiasWhatsapp = 0;
}

/** Copias por WhatsApp que salieron en esta corrida (para sumarlas al tope del día). */
export const whatsappEnviados = () => copiasWhatsapp;

export async function enviar(texto, opciones = {}) {
  if (!telegramActivo()) return enviarCallmebot(paraWhatsapp(texto), opciones);

  const resultado = await enviarTelegram(texto, opciones);
  const log = opciones.log ?? console.log;
  if ((config.notificar?.copiaWhatsapp ?? true) && !opciones.dryRun && cupoWhatsapp > 0) {
    try {
      const r = await enviarCallmebot(paraWhatsapp(texto), { log: () => {} });
      if (r.enviado) {
        cupoWhatsapp--;
        copiasWhatsapp++;
      }
    } catch (error) {
      log(`Copia por WhatsApp no enviada (${error.message}); el aviso salió por Telegram.`);
    }
  }
  return resultado;
}

export const nombreCanal = () => {
  if (!telegramActivo()) return 'WhatsApp';
  return (config.notificar?.copiaWhatsapp ?? true) ? 'Telegram (+ copia por WhatsApp)' : 'Telegram';
};
