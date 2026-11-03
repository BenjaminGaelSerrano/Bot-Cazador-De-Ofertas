import { enviar as enviarCallmebot } from './callmebot.mjs';
import { enviarTelegram, telegramActivo } from './telegram.mjs';

// Canal de avisos: Telegram si está configurado (token y chat); si no, WhatsApp por CallMeBot. Mismo contrato que
// `enviar` de CallMeBot: devuelve `{ enviado }` o lanza si el mensaje no salió.
export async function enviar(texto, opciones = {}) {
  return telegramActivo() ? enviarTelegram(texto, opciones) : enviarCallmebot(texto, opciones);
}

export const nombreCanal = () => (telegramActivo() ? 'Telegram' : 'WhatsApp');
