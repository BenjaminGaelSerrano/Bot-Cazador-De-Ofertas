import assert from 'node:assert/strict';
import { test } from 'node:test';

test('canal: con Telegram, sale por Telegram y una copia por WhatsApp hasta el cupo; si la copia falla, no frena', async () => {
  const pedidos = [];
  let whatsappFalla = false;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    pedidos.push(u.includes('telegram') ? 'telegram' : 'whatsapp');
    if (u.includes('telegram')) return { status: 200, json: async () => ({ ok: true }) };
    return { status: whatsappFalla ? 500 : 200 };
  };
  Object.assign(process.env, { TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '1', CALLMEBOT_PHONE: '549', CALLMEBOT_APIKEY: 'k' });
  try {
    const { enviar, limitarWhatsapp, whatsappEnviados } = await import('../src/notificar/canal.mjs');
    limitarWhatsapp(1);
    assert.deepEqual(await enviar('hola', { log: () => {} }), { enviado: true });
    assert.deepEqual(await enviar('chau', { log: () => {} }), { enviado: true });
    assert.deepEqual(pedidos, ['telegram', 'whatsapp', 'telegram'], 'la segunda copia no sale: cupo agotado');
    assert.equal(whatsappEnviados(), 1);

    limitarWhatsapp(5);
    whatsappFalla = true;
    assert.deepEqual(await enviar('x', { log: () => {} }), { enviado: true }, 'Telegram salió aunque WhatsApp falló');
    assert.equal(whatsappEnviados(), 0);
  } finally {
    globalThis.fetch = original;
    for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'CALLMEBOT_PHONE', 'CALLMEBOT_APIKEY']) delete process.env[k];
  }
});
