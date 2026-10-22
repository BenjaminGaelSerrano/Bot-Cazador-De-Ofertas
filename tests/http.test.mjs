import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ErrorFuente, crearCliente } from '../src/nucleo/http.mjs';

const respuesta = (status, cuerpo = '[]') => ({
  status,
  ok: status >= 200 && status < 300,
  headers: new Map([['resources', '0-49/100']]),
  json: async () => JSON.parse(cuerpo),
});

/** Cliente con reloj falso: `dormir` avanza el tiempo y deja registro de las esperas. */
function armar(respuestas, opciones = {}) {
  let t = 0;
  const esperas = [];
  const pedidos = [];
  const cola = [...respuestas];
  const cliente = crearCliente({
    pausaMs: 1000,
    userAgent: 'test-agent',
    ahora: () => t,
    dormir: async (ms) => { esperas.push(ms); t += ms; },
    fetchFn: async (url, init) => {
      pedidos.push({ url, init });
      const siguiente = cola.shift();
      if (siguiente instanceof Error) throw siguiente;
      return siguiente;
    },
    ...opciones,
  });
  return { cliente, esperas, pedidos };
}

test('devuelve el JSON y los headers', async () => {
  const { cliente } = armar([respuesta(200, '[{"a":1}]')]);
  const { datos, headers } = await cliente.obtenerJson('https://x.test/a');
  assert.deepEqual(datos, [{ a: 1 }]);
  assert.equal(headers.get('resources'), '0-49/100');
});

test('acepta 206 (VTEX responde así) como éxito', async () => {
  const { cliente } = armar([respuesta(206, '[1]')]);
  const { datos } = await cliente.obtenerJson('https://x.test/a');
  assert.deepEqual(datos, [1]);
});

test('manda el User-Agent propio', async () => {
  const { cliente, pedidos } = armar([respuesta(200)]);
  await cliente.obtenerJson('https://x.test/a');
  assert.equal(pedidos[0].init.headers['User-Agent'], 'test-agent');
});

test('respeta la pausa entre pedidos consecutivos', async () => {
  const { cliente, esperas } = armar([respuesta(200), respuesta(200)]);
  await cliente.obtenerJson('https://x.test/1');
  await cliente.obtenerJson('https://x.test/2');
  assert.deepEqual(esperas, [1000]);
});

for (const status of [403, 429]) {
  test(`corta ante ${status} sin reintentar`, async () => {
    const { cliente, pedidos } = armar([respuesta(status), respuesta(200)]);
    await assert.rejects(cliente.obtenerJson('https://x.test/a'), (e) => {
      assert.ok(e instanceof ErrorFuente);
      assert.equal(e.tipo, 'bloqueo');
      assert.equal(e.status, status);
      return true;
    });
    assert.equal(pedidos.length, 1);
  });
}

test('reintenta ante 5xx y se recupera', async () => {
  const { cliente, pedidos } = armar([respuesta(500), respuesta(200, '[2]')]);
  const { datos } = await cliente.obtenerJson('https://x.test/a');
  assert.deepEqual(datos, [2]);
  assert.equal(pedidos.length, 2);
});

test('se recupera aunque el 5xx se repita (caso real: 500 puntual de Rouge)', async () => {
  const { cliente, pedidos } = armar([respuesta(500), respuesta(500), respuesta(200, '[3]')]);
  const { datos } = await cliente.obtenerJson('https://x.test/a');
  assert.deepEqual(datos, [3]);
  assert.equal(pedidos.length, 3);
});

test('si el 5xx persiste, falla tras los reintentos con espera creciente', async () => {
  const { cliente, pedidos, esperas } = armar([respuesta(502), respuesta(503), respuesta(504), respuesta(200)]);
  await assert.rejects(cliente.obtenerJson('https://x.test/a'), (e) => e.tipo === 'servidor' && e.status === 504);
  assert.equal(pedidos.length, 3, 'un pedido y dos reintentos');
  assert.ok(esperas.includes(3000) && esperas.includes(10000), 'esperó 3 s y luego 10 s');
});

test('cada pedido lleva un tope de tiempo', async () => {
  const { cliente, pedidos } = armar([respuesta(200)]);
  await cliente.obtenerJson('https://x.test/a');
  assert.ok(pedidos[0].init.signal instanceof AbortSignal);
});

test('un 400 es error de cliente y no se reintenta', async () => {
  const { cliente, pedidos } = armar([respuesta(400, '"Parameter _to can\'t be greater than 50."')]);
  await assert.rejects(cliente.obtenerJson('https://x.test/a'), (e) => e.tipo === 'cliente' && e.status === 400);
  assert.equal(pedidos.length, 1);
});

const textoEnVezDeJson = () => ({ status: 200, ok: true, headers: new Map(), json: async () => { throw new SyntaxError('Server is too busy'); } });

test('una respuesta que sigue sin ser JSON tras los reintentos es respuesta_invalida', async () => {
  const { cliente, pedidos } = armar([textoEnVezDeJson(), textoEnVezDeJson(), textoEnVezDeJson()]);
  await assert.rejects(cliente.obtenerJson('https://x.test/a'), (e) => e.tipo === 'respuesta_invalida');
  assert.equal(pedidos.length, 3);
});

test('un "Server is too busy" pasajero (texto en vez de JSON) se recupera al reintentar', async () => {
  const { cliente } = armar([textoEnVezDeJson(), respuesta(200, '[5]')]);
  const { datos } = await cliente.obtenerJson('https://x.test/a');
  assert.deepEqual(datos, [5]);
});

test('un fallo de red que persiste es tipo red, tras reintentar', async () => {
  const { cliente, pedidos } = armar([new Error('ECONNRESET'), new Error('ECONNRESET'), new Error('ECONNRESET')]);
  await assert.rejects(cliente.obtenerJson('https://x.test/a'), (e) => e.tipo === 'red');
  assert.equal(pedidos.length, 3);
});

test('un corte de red pasajero se recupera', async () => {
  const { cliente } = armar([new Error('ECONNRESET'), respuesta(200, '[4]')]);
  const { datos } = await cliente.obtenerJson('https://x.test/a');
  assert.deepEqual(datos, [4]);
});

// ---------- POST con cuerpo JSON (GraphQL) ----------

test('con cuerpo hace un POST con JSON y el mismo User-Agent', async () => {
  const { cliente, pedidos } = armar([respuesta(200, '{"data":1}')]);
  const { datos } = await cliente.obtenerJson('https://x.test/graphql', { cuerpo: { query: '{ a }' } });
  assert.deepEqual(datos, { data: 1 });
  const { init } = pedidos[0];
  assert.equal(init.method, 'POST');
  assert.equal(init.body, '{"query":"{ a }"}');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.headers['User-Agent'], 'test-agent');
});

test('sin cuerpo sigue siendo un GET', async () => {
  const { cliente, pedidos } = armar([respuesta(200)]);
  await cliente.obtenerJson('https://x.test/a');
  assert.equal(pedidos[0].init.method, undefined);
  assert.equal(pedidos[0].init.body, undefined);
});

test('el POST también reintenta ante un 5xx y reenvía el mismo cuerpo', async () => {
  const { cliente, pedidos } = armar([respuesta(502), respuesta(200, '[1]')]);
  await cliente.obtenerJson('https://x.test/graphql', { cuerpo: { query: '{ a }' } });
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[1].init.body, '{"query":"{ a }"}');
  assert.equal(pedidos[1].init.method, 'POST');
});

test('el POST también corta ante 429 sin insistir', async () => {
  const { cliente, pedidos } = armar([respuesta(429), respuesta(200)]);
  await assert.rejects(cliente.obtenerJson('https://x.test/graphql', { cuerpo: {} }), (e) => e.tipo === 'bloqueo');
  assert.equal(pedidos.length, 1);
});
