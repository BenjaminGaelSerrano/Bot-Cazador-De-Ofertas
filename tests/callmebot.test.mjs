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
  assert.equal(m, 'Ofertas Juleriaque (2)\n\n1) Producto 1 https://x.test/1\n\n2) Producto 2 https://x.test/2');
});

test('armarMensajes: reparte por tope de ofertas y numera de corrido', () => {
  const ms = armarMensajes(ofertas(5), { titulo: 'O', maxPorMensaje: 2, maxMensajes: 3 });
  assert.equal(ms.length, 3);
  assert.ok(ms[0].startsWith('O (5)\n\n1)'));
  assert.ok(ms[1].startsWith('O (cont.)\n\n3)'));
  assert.ok(ms[2].startsWith('O (cont.)\n\n5)'));
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

// ---------- Largo de los mensajes con los topes reales (regresión del 2026-10-22) ----------
// CallMeBot cortó en silencio dos mensajes de 8 ofertas a ~750 caracteres (~990 codificados) y las ofertas
// cortadas se dieron por avisadas. Estas pruebas usan ofertas reales de Rouge, con nombres y links largos.

const { config } = await import('../src/config.mjs');
const { formatearOferta } = await import('../src/notificar/formato.mjs');
const { agrupar } = await import('../src/notificar/callmebot.mjs');

const catalogoRouge = [
  ['Clean Beauty Collective', 'Clean Reserve Elderflower Mist 50 ml', 18021, 51490, 'clean-reserve-elderflower-mist-x80563100000'],
  ['Clean Beauty Collective', 'Clean Reserve Limpiador equilibrante buriti 146 ml', 18021, 51490, 'clean-reserve-limpiador-equilibrante-buriti-x80543100000'],
  ['Versace', 'Woman EDP 100 ml', 99050, 283000, 'woman-edp-xv25046p'],
  ['Clean Beauty Collective', 'Clean Reserve Skin Blend EDP 100 ml', 71050, 203000, 'clean-reserve-skin-blend-edp-x80330820001'],
  ['Clean Beauty Collective', 'Clean Reserve Radiant Nectar EDP 50 ml Set Set', 44065, 125900, 'clean-reserve-radiant-nectar-edp-50-ml-set-x89170020320'],
  ['Clean Beauty Collective', 'Clean Reserve Radiant Nectar EDP 100 ml', 71050, 203000, 'clean-reserve-radiant-nectar-edp-x80331420002'],
  ['Clean Beauty Collective', 'Clean Reserve Citron Fig EDP 100 ml', 71050, 203000, 'clean-reserve-citron-fig-edp-x80331120000'],
  ['Clean Beauty Collective', 'Clean Reserve Sel Santal EDP 100 ml', 71050, 203000, 'clean-reserve-sel-santal-edp-x80331020000'],
  ['Clean Beauty Collective', 'Clean Reserve Sueded Oud EDP 100 ml', 71050, 203000, 'clean-reserve-sueded-oud-edp-x80330220000'],
  ['Clean Beauty Collective', 'Clean Reserve Rain Blend EDP 100 ml', 71050, 203000, 'clean-reserve-rain-blend-edp-x80330920001'],
  ['Dsquared2', 'Red Wood Pour Femme EDT 50 ml', 54600, 156000, 'red-wood-pour-femme-edt-x5c28c-1'],
  ['Dsquared2', 'Wood Pour Homme EDT 30 ml', 44765, 127900, 'wood-pour-homme-edt-x5b07c-1'],
].map(([marca, nombre, precioActual, precioLista, slug]) => ({
  oferta: { marca, nombre, precioActual, precioLista, url: `https://www.perfumeriasrouge.com/${slug}/p` },
  texto: formatearOferta(
    { marca, nombre, precioActual, precioLista, url: `https://www.perfumeriasrouge.com/${slug}/p` },
    { tipo: 'sin-historial', descuento: 1 - precioActual / precioLista, base: precioLista, referencia: null },
  ),
}));

test('topes reales: ningún mensaje supera el largo que acepta CallMeBot', () => {
  const { mensajes } = agrupar(catalogoRouge, { titulo: 'Ofertas Rouge · primera lectura, mejores de 373', maxMensajes: 10 });
  assert.ok(mensajes.length > 1, 'se reparte en varios mensajes');
  for (const m of mensajes) {
    assert.ok(encodeURIComponent(m).length <= config.maxCodificadosDuro, `mensaje de ${encodeURIComponent(m).length} codificados`);
    assert.ok(m.length <= config.maxCaracteres + 40, `mensaje de ${m.length} caracteres`);
  }
});

test('topes reales: ninguna oferta queda partida y todas las enviadas llevan su link entero', () => {
  const { mensajes, porMensaje, incluidas } = agrupar(catalogoRouge, { titulo: 'Ofertas Rouge', maxMensajes: 10 });
  assert.equal(incluidas, catalogoRouge.length);
  assert.equal(porMensaje.reduce((a, b) => a + b, 0), incluidas);
  const todo = mensajes.join('\n');
  for (const { texto } of catalogoRouge) {
    assert.equal(mensajes.filter((m) => m.includes(texto)).length, 1, `la oferta entera está en un solo mensaje: ${texto.split('\n')[0]}`);
  }
  assert.ok(todo.includes('https://www.perfumeriasrouge.com/clean-reserve-limpiador-equilibrante-buriti-x80543100000/p'));
});

test('topes reales: lo que no entra se cuenta en "y N más", sin partir ofertas', () => {
  const { mensajes, incluidas } = agrupar(catalogoRouge, { titulo: 'Ofertas Rouge', maxMensajes: 2 });
  assert.ok(incluidas < catalogoRouge.length);
  assert.ok(mensajes.at(-1).endsWith(`y ${catalogoRouge.length - incluidas} más.`));
  for (const m of mensajes) assert.ok(encodeURIComponent(m).length <= config.maxCodificadosDuro);
});

test('enviar: un mensaje que no entra falla y NO se manda (no sale cortado)', async () => {
  let llamado = false;
  await assert.rejects(
    enviar('x'.repeat(2000), { phone: '1', apikey: 'k', fetchFn: async () => { llamado = true; return { ok: true }; } }),
    (e) => e.tipo === 'notificacion' && /demasiado largo/.test(e.message),
  );
  assert.equal(llamado, false);
});

// ---------- Largo efectivo: cómo cuenta CallMeBot al cortar ----------

const { largoEfectivo } = await import('../src/notificar/callmebot.mjs');

test('largoEfectivo: cuenta los saltos de línea doble y los bytes extra de acentos y símbolos', () => {
  assert.equal(largoEfectivo('abc'), 3);
  assert.equal(largoEfectivo('a\nb'), 4, 'el salto cuenta doble');
  assert.equal(largoEfectivo('ñ'), 2, 'un carácter de 2 bytes cuenta 2');
  assert.equal(largoEfectivo('a · b'), 6, '"·" ocupa 2 bytes');
  assert.equal(largoEfectivo('línea\nmás'), 'línea\nmás'.length + 1 + 2);
});

test('el tope es sobre el largo efectivo: un mensaje lleno de saltos y acentos entra menos ofertas que uno plano', () => {
  const plano = Array.from({ length: 8 }, (_, i) => ({ texto: `Producto ${i} sin acentos y sin saltos` }));
  const raro = Array.from({ length: 8 }, (_, i) => ({ texto: `Perfúmería ñandú ${i}\nlínea dos\nlínea tres\nhttps://x.test/${i}` }));
  const cuantas = (o) => agrupar(o, { titulo: 'T', maxMensajes: 1, maxCaracteres: 200 }).incluidas;
  assert.ok(cuantas(raro) < cuantas(plano));
  const { mensajes } = agrupar(raro, { titulo: 'T', maxMensajes: 8, maxCaracteres: 200 });
  for (const m of mensajes) assert.ok(largoEfectivo(m) <= 200 || m.split('\n\n').length === 2, 'ningún mensaje con varias ofertas pasa el tope');
});

test('topes reales: ningún mensaje supera el largo efectivo que acepta CallMeBot', () => {
  const { mensajes } = agrupar(catalogoRouge, { titulo: 'Ofertas Rouge · 1ª lectura, de 373', tituloContinuacion: 'Ofertas Rouge (cont.)', maxMensajes: 10 });
  for (const m of mensajes) assert.ok(largoEfectivo(m) <= config.maxCaracteresDuro, `mensaje de largo efectivo ${largoEfectivo(m)}`);
  assert.ok(mensajes.every((m) => largoEfectivo(m) <= config.maxCaracteres + 100));
});

test('el título de continuación se usa a partir del segundo mensaje', () => {
  const { mensajes } = agrupar(catalogoRouge, { titulo: 'Ofertas Rouge · 1ª lectura, de 373', tituloContinuacion: 'Ofertas Rouge (cont.)', maxMensajes: 10 });
  assert.ok(mensajes[0].startsWith('Ofertas Rouge · 1ª lectura, de 373 ('));
  assert.ok(mensajes.slice(1).every((m) => m.startsWith('Ofertas Rouge (cont.)')));
});

test('enviar: un mensaje de largo efectivo mayor al duro no se manda aunque tenga pocos caracteres', async () => {
  let llamado = false;
  const texto = Array(130).fill('ñá\n').join(''); // 390 caracteres, pero cada pieza pesa 6 al contar acentos y salto
  assert.ok(texto.length < config.maxCaracteresDuro && largoEfectivo(texto) > config.maxCaracteresDuro);
  await assert.rejects(enviar(texto, { phone: '1', apikey: 'k', fetchFn: async () => { llamado = true; return { ok: true }; } }), (e) => e.tipo === 'notificacion');
  assert.equal(llamado, false);
});
