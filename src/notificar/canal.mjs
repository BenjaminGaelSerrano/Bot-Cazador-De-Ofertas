import { config } from '../config.mjs';
import { enviar as enviarCallmebot } from './callmebot.mjs';
import { enviarFotoTelegram, enviarTelegram, telegramActivo } from './telegram.mjs';
import { imagenDe } from './imagen.mjs';
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

const TARJETA = /^\*\d+\. \[[^\]\n]*\]\((https?:\/\/[^)\s]+)\)\*/;

/**
 * Parte un mensaje de tarjetas: cada oferta aparte (con la dirección de su producto) y lo demás (título, leyenda,
 * promos) junto, en el mismo orden. Devuelve null si no hay tarjetas.
 */
export function partirEnTarjetas(texto) {
  const partes = [];
  for (const bloque of String(texto).split('\n\n')) {
    const url = TARJETA.exec(bloque)?.[1] ?? null;
    if (!url && partes.length && partes.at(-1).url === null) partes.at(-1).texto += `\n\n${bloque}`;
    else partes.push({ url, texto: bloque });
  }
  return partes.some((p) => p.url) ? partes : null;
}

const dormirReal = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cada oferta con su foto; si no hay foto o Telegram la rechaza, sale en texto. */
export async function enviarConFotos(partes, opciones = {}, {
  foto = imagenDe, mandarFoto = enviarFotoTelegram, mandarTexto = enviarTelegram, dormir = dormirReal, pausaMs = config.telegram?.pausaFotosMs ?? 1100,
} = {}) {
  const log = opciones.log ?? console.log;
  let resultado = { enviado: true };
  let sinFoto = 0;
  for (const parte of partes) {
    const imagen = parte.url ? await foto(parte.url) : null;
    try {
      if (imagen) await mandarFoto(imagen, parte.texto, opciones);
      else { resultado = await mandarTexto(parte.texto, opciones); if (parte.url) sinFoto++; }
    } catch (error) {
      if (!imagen) throw error;
      resultado = await mandarTexto(parte.texto, opciones);
      sinFoto++;
    }
    await dormir(pausaMs);
  }
  if (sinFoto) log(`  ${sinFoto} ofertas salieron sin foto.`);
  return resultado;
}

export async function enviar(texto, opciones = {}) {
  if (!telegramActivo()) return enviarCallmebot(paraWhatsapp(texto), opciones);

  const partes = (config.telegram?.fotos ?? false) && !opciones.dryRun ? partirEnTarjetas(texto) : null;
  const resultado = partes ? await enviarConFotos(partes, opciones) : await enviarTelegram(texto, opciones);
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
