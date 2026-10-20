import assert from 'node:assert/strict';
import { test } from 'node:test';
import { armarMensajes, enviar } from '../src/notificar/callmebot.mjs';

const ofertas = (n) => Array.from({ length: n }, (_, i) => ({ texto: `Producto ${i + 1} https://x.test/${i + 1}` }));

test('armarMensajes: sin ofertas no hay mensajes', () => {
  assert.deepEqual(armarMensajes([], { titulo: 'Ofertas' }), []);
});

test('armarMensajes: pocas ofertas van en un solo mensaje numerado', () => {
  const [m, ...resto] = armarMensajes(ofertas(2), { titulo: 'Ofertas Juleriaque' });
  assert.equal(resto.length, 0);
  assert.equal(m, 'Ofertas Juleriaque (2)\n1. Producto 1 https://x.test/1\n2. Producto 2 https://x.test/2');
});

test('armarMensajes: reparte por tope de ofertas y numera de corrido', () => {
  const ms = armarMensajes(ofertas(5), { titulo: 'O', maxPorMensaje: 2, maxMensajes: 3 });
  assert.equal(ms.length, 3);
  assert.ok(ms[0].startsWith('O (5)\n1.'));
  assert.ok(ms[1].startsWith('O (cont.)\n3.'));
  assert.ok(ms[2].startsWith('O (cont.)\n5.'));
});

test('armarMensajes: lo que no entra se resume como "y N más"', () => {
  const ms = armarMensajes(ofertas(10), { titulo: 'O', maxPorMensaje: 2, maxMensajes: 2 });
  assert.equal(ms.length, 2);
  assert.ok(ms[1].endsWith('\ny 6 más.'));
});

test('armarMensajes: respeta el tope de caracteres pero nunca deja un mensaje vacío', () => {
  const ms = armarMensajes(ofertas(4), { titulo: 'O', maxPorMensaje: 10, maxMensajes: 4, maxCaracteres: 60 });
  assert.ok(ms.length > 1);
  for (const m of ms) assert.ok(m.includes('Producto'));
});

test('enviar: dry-run imprime y no llama a la red', async () => {
  const logs = [];
  let llamado = false;
  const r = await enviar('hola', { dryRun: true, phone: '1', apikey: 'k', log: (t) => logs.push(t), fetchFn: async () => { llamado = true; } });
  assert.equal(r.enviado, false);
  assert.equal(llamado, false);
  assert.match(logs[0], /\[dry-run\].*hola/s);
});

test('enviar: sin credenciales no envía y no revienta', async () => {
  const logs = [];
  const r = await enviar('hola', { phone: '', apikey: '', log: (t) => logs.push(t) });
  assert.equal(r.motivo, 'sin-credenciales');
  assert.match(logs[0], /sin WhatsApp/);
});

test('enviar: arma la URL de CallMeBot con el texto codificado', async () => {
  let url;
  const r = await enviar('Oferta 50% off & más', {
    phone: '5491100000000', apikey: 'clave123',
    fetchFn: async (u) => { url = u; return { ok: true, status: 200 }; },
  });
  assert.equal(r.enviado, true);
  assert.ok(url.startsWith('https://api.callmebot.com/whatsapp.php?phone=5491100000000&text='));
  assert.ok(url.includes(encodeURIComponent('Oferta 50% off & más')));
  assert.ok(url.endsWith('&apikey=clave123'));
});

test('enviar: un error HTTP falla sin filtrar la clave', async () => {
  await assert.rejects(
    enviar('hola', { phone: '1', apikey: 'secreta', fetchFn: async () => ({ ok: false, status: 503 }) }),
    (e) => e.message === 'CallMeBot respondió 503' && !e.message.includes('secreta'),
  );
});
