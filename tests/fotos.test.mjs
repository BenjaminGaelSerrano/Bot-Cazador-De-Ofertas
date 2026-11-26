import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enviarConFotos, partirEnTarjetas } from '../src/notificar/canal.mjs';
import { imagenDe, imagenDeHtml } from '../src/notificar/imagen.mjs';
import { enviarFotoTelegram } from '../src/notificar/telegram.mjs';

const mensaje = ['*Título* · 2 que valen\nleyenda', '*1. [Uno](https://t/1)*\n$10k', '*2. [Dos](https://t/2)*\n$20k', '*Promos de la web*\nX: 2x1'].join('\n\n');

test('partirEnTarjetas: cada oferta aparte y el resto en su lugar; sin tarjetas, null', () => {
  const p = partirEnTarjetas(mensaje);
  assert.deepEqual(p.map((x) => x.url), [null, 'https://t/1', 'https://t/2', null]);
  assert.match(p[1].texto, /\$10k/);
  assert.equal(partirEnTarjetas('⚠ la tienda no respondió'), null);
});

test('imagenDeHtml: og:image en cualquier orden, direcciones relativas y sin foto', () => {
  assert.equal(imagenDeHtml('<meta property="og:image" content="http://cdn/x.jpg?a=1&amp;b=2">', 'https://t/p'), 'https://cdn/x.jpg?a=1&b=2');
  assert.equal(imagenDeHtml('<meta content="//cdn/y.webp" property="og:image">', 'https://t/p'), 'https://cdn/y.webp');
  assert.equal(imagenDeHtml('{"@type":"Product","name":"x","image":["https://cdn/z.jpg"]}', 'https://t/p'), 'https://cdn/z.jpg');
  assert.equal(imagenDeHtml('<html></html>', 'https://t/p'), null);
});

test('imagenDe: si la página falla no rompe, y lo encontrado no se vuelve a pedir', async () => {
  let pedidos = 0;
  const fetchFn = async () => { pedidos++; return { ok: true, text: async () => '<meta property="og:image" content="https://cdn/a.jpg">' }; };
  assert.equal(await imagenDe('https://t/cache-1', { fetchFn }), 'https://cdn/a.jpg');
  assert.equal(await imagenDe('https://t/cache-1', { fetchFn }), 'https://cdn/a.jpg');
  assert.equal(pedidos, 1);
  assert.equal(await imagenDe('https://t/rota', { fetchFn: async () => { throw new Error('sin red'); } }), null);
});

test('enviarConFotos: foto por oferta; sin foto o rechazada, sale en texto', async () => {
  const enviados = [];
  const dep = {
    foto: async (url) => (url.endsWith('/1') ? 'https://cdn/1.jpg' : 'https://cdn/mala.jpg'),
    mandarFoto: async (f, t) => { if (f.includes('mala')) throw new Error('rechazada'); enviados.push(['foto', t.slice(0, 8)]); },
    mandarTexto: async (t) => { enviados.push(['texto', t.slice(0, 8)]); return { enviado: true }; },
    dormir: async () => {}, pausaMs: 0,
  };
  const r = await enviarConFotos(partirEnTarjetas(mensaje), { log: () => {} }, dep);
  assert.equal(r.enviado, true);
  assert.deepEqual(enviados.map((x) => x[0]), ['texto', 'foto', 'texto', 'texto']);
});

test('enviarFotoTelegram: texto arriba, sin sonido, y espera cuando Telegram lo pide', async () => {
  const cuerpos = [];
  const esperas = [];
  const fetchFn = async (_u, init) => {
    cuerpos.push(JSON.parse(init.body));
    return cuerpos.length === 1 ? { status: 429, json: async () => ({ ok: false, parameters: { retry_after: 3 } }) } : { status: 200, json: async () => ({ ok: true }) };
  };
  await enviarFotoTelegram('https://cdn/a.jpg', '*1. [A](https://t/a)*', { token: 't', chatId: 1, fetchFn, dormir: async (ms) => esperas.push(ms) });
  assert.deepEqual(esperas, [4000]);
  assert.equal(cuerpos[1].show_caption_above_media, true);
  assert.equal(cuerpos[1].disable_notification, true);
  assert.match(cuerpos[1].caption, /<a href="https:\/\/t\/a">A<\/a>/);
});

test('imagen: catálogo de VTEX cuando la página no la declara, y CDN de Tiendanube', async () => {
  const fetchFn = async (u) => (u.includes('/api/catalog_system/')
    ? { ok: true, json: async () => [{ items: [{ images: [{ imageUrl: 'http://x.vtexassets.com/a.jpg' }] }] }] }
    : { ok: true, text: async () => '<html></html>' });
  assert.equal(await imagenDe('https://g/zapatilla-uno/p', { fetchFn }), 'https://x.vtexassets.com/a.jpg');
  assert.equal(imagenDeHtml('<img data-srcset="//acdn-us.mitiendanube.com/stores/001/products/foto-480-0.webp 480w">', 'https://t/p'), 'https://acdn-us.mitiendanube.com/stores/001/products/foto-480-0.webp');
});
