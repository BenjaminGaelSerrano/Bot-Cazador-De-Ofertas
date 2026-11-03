import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aHtml, chatsQueEscribieron, enviarTelegram } from '../src/notificar/telegram.mjs';

test('aHtml: tabla en <pre>, *negrita* en <b>, y se escapan los caracteres de HTML', () => {
  const texto = '*Ofertas Juleriaque* · 1 que valen la pena\n```\n # Producto\n 1 D&G <ONE> 100ML\n```\n1) https://x.test/p?a=1&b=2';
  assert.equal(aHtml(texto),
    '<b>Ofertas Juleriaque</b> · 1 que valen la pena\n<pre> # Producto\n 1 D&amp;G &lt;ONE&gt; 100ML</pre>\n1) https://x.test/p?a=1&amp;b=2');
});

test('enviarTelegram: POST a sendMessage con HTML; error sin mostrar el token', async () => {
  const pedidos = [];
  const ok = async (url, init) => { pedidos.push({ url, body: JSON.parse(init.body) }); return { status: 200, json: async () => ({ ok: true }) }; };
  assert.deepEqual(await enviarTelegram('*Hola*', { token: 'TOKEN123', chatId: 42, fetchFn: ok }), { enviado: true });
  assert.ok(pedidos[0].url.endsWith('/botTOKEN123/sendMessage'));
  assert.deepEqual(pedidos[0].body, { chat_id: 42, text: '<b>Hola</b>', parse_mode: 'HTML', disable_web_page_preview: true });

  const rechazo = async () => ({ status: 400, json: async () => ({ ok: false, description: 'Bad Request: chat not found' }) });
  await assert.rejects(enviarTelegram('x', { token: 'TOKEN123', chatId: 1, fetchFn: rechazo }), (e) => /chat not found/.test(e.message) && !e.message.includes('TOKEN123'));
  const caido = async () => { throw new Error('fetch failed https://api.telegram.org/botTOKEN123/sendMessage'); };
  await assert.rejects(enviarTelegram('x', { token: 'TOKEN123', chatId: 1, fetchFn: caido }), (e) => !e.message.includes('TOKEN123'));
  await assert.rejects(enviarTelegram('x', { token: '', chatId: 1, fetchFn: ok }), /Falta TELEGRAM_BOT_TOKEN/);
});

test('chatsQueEscribieron: chats privados sin repetir', async () => {
  const fetchFn = async () => ({ json: async () => ({ ok: true, result: [
    { message: { chat: { id: 7, type: 'private', first_name: 'Benja', username: 'benja' } } },
    { message: { chat: { id: 7, type: 'private', first_name: 'Benja', username: 'benja' } } },
    { message: { chat: { id: -100, type: 'group', title: 'Grupo' } } },
  ] }) });
  assert.deepEqual(await chatsQueEscribieron('T', fetchFn), [{ id: 7, nombre: 'Benja @benja' }]);
});
