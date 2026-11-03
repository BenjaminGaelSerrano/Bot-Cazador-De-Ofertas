import { config } from '../config.mjs';

// Canal Telegram (2026-11-02): CallMeBot deja de entregar en silencio pasado un límite diario que no publica, y corta
// los mensajes largos. La API de bots de Telegram es oficial, gratis, confirma cada envío y acepta 4.096 caracteres.
// Variables: TELEGRAM_BOT_TOKEN (secreto) y el chat del usuario (config.telegram.chatId o TELEGRAM_CHAT_ID).

const API = 'https://api.telegram.org';

const escapar = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Pasa el formato de WhatsApp a HTML de Telegram: bloques ``` -> <pre>, *negrita* -> <b>. Lo demás se escapa, así un
 * "&" o un "<" en un nombre de producto no rompe el mensaje. Los links quedan clickeables solos.
 */
export function aHtml(texto) {
  const partes = texto.split('```');
  return partes.map((parte, i) => {
    if (i % 2 === 1) return `<pre>${escapar(parte.replace(/^\n/, '').replace(/\n$/, ''))}</pre>`;
    return escapar(parte).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
  }).join('');
}

export class ErrorTelegram extends Error {}

/** Manda un mensaje. Con `dryRun` solo lo imprime. Nunca muestra el token en logs ni errores. */
export async function enviarTelegram(texto, {
  token = process.env.TELEGRAM_BOT_TOKEN,
  chatId = process.env.TELEGRAM_CHAT_ID || config.telegram?.chatId,
  dryRun = false,
  fetchFn = fetch,
  log = console.log,
} = {}) {
  if (dryRun) {
    log(`[dry-run] Telegram:\n${texto}`);
    return { enviado: false, motivo: 'dry-run' };
  }
  if (!token || !chatId) throw new ErrorTelegram('Falta TELEGRAM_BOT_TOKEN o el chat de Telegram');
  let res;
  try {
    res = await fetchFn(`${API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: aHtml(texto), parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(config.timeoutPedidoMs),
    });
  } catch {
    throw new ErrorTelegram('Telegram no respondió'); // el error original podría traer la URL con el token
  }
  const datos = await res.json().catch(() => ({}));
  if (res.status !== 200 || !datos.ok) throw new ErrorTelegram(`Telegram rechazó el mensaje (${res.status}${datos.description ? `: ${datos.description}` : ''})`);
  return { enviado: true };
}

/** Chats privados que le escribieron al bot (para averiguar el del usuario una sola vez). */
export async function chatsQueEscribieron(token, fetchFn = fetch) {
  const res = await fetchFn(`${API}/bot${token}/getUpdates`, { signal: AbortSignal.timeout(config.timeoutPedidoMs) });
  const datos = await res.json().catch(() => ({}));
  if (!datos.ok) throw new ErrorTelegram(`Telegram rechazó el token (${res.status})`);
  const chats = new Map();
  for (const u of datos.result ?? []) {
    const chat = u.message?.chat;
    if (chat?.type === 'private') chats.set(chat.id, `${chat.first_name ?? ''} ${chat.username ? `@${chat.username}` : ''}`.trim());
  }
  return [...chats].map(([id, nombre]) => ({ id, nombre }));
}

/** Telegram activo: hay token y chat. */
export const telegramActivo = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && (process.env.TELEGRAM_CHAT_ID || config.telegram?.chatId));
