import assert from 'node:assert/strict';
import { test } from 'node:test';
import { armarMensajes } from '../src/notificar/callmebot.mjs';
import { correrFuentes } from '../src/principal.mjs';

const fuentes = Object.fromEntries(['a', 'b', 'c', 'd'].map((n) => [n, { titulo: `Ofertas ${n}`, leer: async () => ({}) }]));

/** `corrida` falsa: registra con qué tope se llamó y gasta los mensajes indicados (o falla). */
function corridaFalsa(plan) {
  const llamadas = [];
  const corrida = async (opciones) => {
    llamadas.push({ nombre: opciones.nombre, maxMensajes: opciones.maxMensajes, dryRun: opciones.dryRun });
    const paso = plan[opciones.nombre];
    if (paso instanceof Error) throw paso;
    return { mensajes: Math.min(paso ?? 0, opciones.maxMensajes) };
  };
  return { corrida, llamadas };
}

const base = (extra) => ({ fuentes, fecha: '2026-10-20', crearCliente: () => null, maxMensajesTotal: 5, maxMensajesPorFuente: 3, log: () => {}, ...extra });

test('reparte el tope total en orden: cada fuente recibe lo que queda, hasta su tope', async () => {
  const { corrida, llamadas } = corridaFalsa({ a: 3, b: 3, c: 3, d: 3 });
  const r = await correrFuentes(base({ nombres: ['a', 'b', 'c', 'd'], corrida }));
  assert.deepEqual(llamadas.map((l) => [l.nombre, l.maxMensajes]), [['a', 3], ['b', 2], ['c', 0], ['d', 0]]);
  assert.equal(r.mensajesUsados, 5);
  assert.deepEqual(r.fallaron, []);
});

test('lo que una fuente no usa queda disponible para las siguientes', async () => {
  const { corrida, llamadas } = corridaFalsa({ a: 1, b: 0, c: 3 });
  await correrFuentes(base({ nombres: ['a', 'b', 'c'], corrida }));
  assert.deepEqual(llamadas.map((l) => l.maxMensajes), [3, 3, 3]);
});

test('una fuente que falla no frena a las demás y se informa', async () => {
  const { corrida, llamadas } = corridaFalsa({ a: 1, b: new Error('bloqueado'), c: 1 });
  const r = await correrFuentes(base({ nombres: ['a', 'b', 'c'], corrida }));
  assert.equal(llamadas.length, 3);
  assert.deepEqual(r.fallaron, ['b']);
  assert.deepEqual(r.resultados.map((x) => x.ok), [true, false, true]);
  assert.equal(r.resultados[1].error.message, 'bloqueado');
  assert.equal(r.mensajesUsados, 2);
});

test('si todas fallan, las informa a todas', async () => {
  const { corrida } = corridaFalsa({ a: new Error('x'), b: new Error('y') });
  const r = await correrFuentes(base({ nombres: ['a', 'b'], corrida }));
  assert.deepEqual(r.fallaron, ['a', 'b']);
  assert.equal(r.mensajesUsados, 0);
});

test('pasa dry-run, el título y un cliente nuevo a cada fuente', async () => {
  const vistos = [];
  const corrida = async (o) => { vistos.push([o.nombre, o.titulo, o.dryRun, o.cliente]); return { mensajes: 0 }; };
  let n = 0;
  await correrFuentes(base({ nombres: ['a', 'b'], corrida, dryRun: true, crearCliente: () => ++n }));
  assert.deepEqual(vistos, [['a', 'Ofertas a', true, 1], ['b', 'Ofertas b', true, 2]]);
});

test('armarMensajes con tope 0 no inventa mensajes ni rompe', () => {
  const ofertas = [{ texto: 'x' }, { texto: 'y' }];
  assert.deepEqual(armarMensajes(ofertas, { titulo: 'T', maxMensajes: 0 }), []);
});

// ---------- Estado de envío compartido y límite de CallMeBot ----------

test('todas las tiendas reciben el mismo estado de envío', async () => {
  const vistos = [];
  const corrida = async (o) => { vistos.push(o.estadoEnvio); return { mensajes: 0 }; };
  await correrFuentes(base({ nombres: ['a', 'b', 'c'], corrida }));
  assert.ok(vistos.every((s) => s === vistos[0]), 'es el mismo objeto');
  assert.deepEqual(vistos[0], { enviados: 0, bloqueado: false });
});

test('si una tienda llega al límite, las siguientes ven el estado bloqueado y la corrida lo informa', async () => {
  const bloqueadoAlEntrar = [];
  const corrida = async (o) => {
    bloqueadoAlEntrar.push([o.nombre, o.estadoEnvio.bloqueado]);
    if (o.nombre === 'b') { o.estadoEnvio.enviados = 7; o.estadoEnvio.bloqueado = true; return { mensajesUsados: 7, mensajes: 9 }; }
    return { mensajesUsados: 2, mensajes: 2 };
  };
  const r = await correrFuentes(base({ nombres: ['a', 'b', 'c', 'd'], corrida, maxMensajesTotal: 40, maxMensajesPorFuente: 8 }));
  assert.deepEqual(bloqueadoAlEntrar, [['a', false], ['b', false], ['c', true], ['d', true]]);
  assert.equal(r.limiteEnvio, true);
  assert.deepEqual(r.fallaron, [], 'llegar al límite no es una falla');
});

test('el tope total se descuenta con los mensajes realmente enviados, no con los armados', async () => {
  const topes = [];
  const corrida = async (o) => { topes.push(o.maxMensajes); return { mensajesUsados: 3, mensajes: 8 }; };
  const r = await correrFuentes(base({ nombres: ['a', 'b', 'c'], corrida, maxMensajesTotal: 40, maxMensajesPorFuente: 8 }));
  assert.deepEqual(topes, [8, 8, 8]);
  assert.equal(r.mensajesUsados, 9);
});

test('sin llegar al límite, limiteEnvio es falso', async () => {
  const r = await correrFuentes(base({ nombres: ['a'], corrida: async () => ({ mensajesUsados: 1, mensajes: 1 }) }));
  assert.equal(r.limiteEnvio, false);
});

test('la configuración deja un tope total amplio y una pausa entre mensajes', async () => {
  const { config } = await import('../src/config.mjs');
  assert.ok(config.maxMensajesTotalPorCorrida >= 20, 'tope total amplio: lo más posible hasta el límite');
  assert.ok(config.maxMensajesPorCorrida >= 5);
  assert.ok(config.pausaMensajesMs >= 2000, 'pausa entre mensajes para no saturar a CallMeBot');
});
