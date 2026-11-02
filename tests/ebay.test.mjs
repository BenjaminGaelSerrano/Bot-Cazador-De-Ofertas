import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { codigoModelo, consultaPara, crearEbay, precioDePublicaciones, textoNombre } from '../src/nucleo/ebay.mjs';

// Respuestas con la forma documentada de la Browse API (item_summary/search). Precios inventados.
const item = (title, value, envio = null) => ({
  itemId: `v1|${title}`, title, price: { value: String(value), currency: 'USD' }, itemWebUrl: `https://www.ebay.com/itm/${encodeURIComponent(title)}`,
  ...(envio === null ? { shippingOptions: [{ shippingCostType: 'FIXED', shippingCost: { value: '0.00', currency: 'USD' } }] }
    : { shippingOptions: [{ shippingCostType: 'FIXED', shippingCost: { value: String(envio), currency: 'USD' } }] }),
});

const ONE_MILLION = [
  item('Paco Rabanne 1 Million EDT 3.4 oz 100 ml Men New Sealed', 72),
  item('1 Million by Paco Rabanne 3.4 oz EDT Spray for Men', 70, 5.99),
  item('Paco Rabanne One Million 100ml Eau de Toilette', 79),
  item('Paco Rabanne 1 Million 3.4oz Tester', 55),          // tester: fuera
  item('1 Million EDT 10ml Decant Sample', 12),              // decant: fuera
  item('Paco Rabanne 1 Million EDT 3.4 oz', 84),
  item('1 Million EDT 3.4 oz Brand New in Box', 88),
  item('Paco Rabanne 1 Million 3.4 oz', 20),                 // a menos de la mitad de la mediana: fuera
];

test('precioDePublicaciones: sin testers ni decants ni precios absurdos, mediana de las 5 más baratas con envío', () => {
  const r = precioDePublicaciones(ONE_MILLION, { minimo: 3, tomar: 5 });
  // Quedan 72, 75.99, 79, 84, 88 (el de 20 se descarta): la mediana es 79.
  assert.equal(r.usd, 79);
  assert.equal(r.n, 5);
  assert.ok(r.url.includes('ebay.com'));
});

test('precioDePublicaciones: con menos de 3 publicaciones válidas no hay precio', () => {
  assert.equal(precioDePublicaciones([item('Perfume X 100ml', 50), item('Perfume X Tester', 30)], { minimo: 3, tomar: 5 }), null);
  assert.equal(precioDePublicaciones([], { minimo: 3, tomar: 5 }), null);
});

test('codigoModelo: Moov trae el código del fabricante en el id', () => {
  assert.equal(codigoModelo({ id: 'NICW2288-111' }, 'moov'), 'CW2288-111');
  assert.equal(codigoModelo({ id: 'ADB75807' }, 'moov'), 'B75807');
  assert.equal(codigoModelo({ id: 'ADJI0079' }, 'moov'), 'JI0079');
  assert.equal(codigoModelo({ id: '2329' }, 'grid'), null);
});

test('textoNombre: marca + modelo + género en inglés, sin relleno', () => {
  assert.equal(textoNombre({ marca: 'Adidas Originals', nombre: 'ZAPATILLAS ADIDAS ORIGINALS SAMBA OG', gen: 'h' }), 'adidas samba og mens');
  assert.equal(textoNombre({ marca: 'Nike', nombre: "ZAPATILLAS NIKE SPORTSWEAR AIR FORCE 1 '07 MUJER", genero: 'm' }), 'nike air force 1 07 womens');
});

test('consultaPara: código de barras, después código de modelo, después nombre (solo ropa y calzado)', () => {
  assert.deepEqual(consultaPara({ ean: '3349666007921', nombre: 'One Million EDT 100 ml', marca: 'RABANNE' }, 'juleriaque'),
    { via: 'ean', clave: 'ean:3349666007921', params: { gtin: '3349666007921' } });
  assert.equal(consultaPara({ id: 'NICW2288-111', marca: 'Nike', nombre: 'Air Force 1', km: 'nike|1 air force' }, 'moov').via, 'codigo');
  assert.equal(consultaPara({ id: '2329', marca: 'Adidas Originals', nombre: 'ZAPATILLAS ADIDAS ORIGINALS SAMBA OG', km: 'adidas|og samba', gen: 'h' }, 'grid').via, 'nombre');
  assert.equal(consultaPara({ id: '9', ean: null, marca: 'DIOR', nombre: 'Sauvage EDT 100 ml', ml: 100 }, 'rouge'), null, 'perfume sin código: no');
});

// ---------- Servicio ----------

function fetchSimulado({ items = ONE_MILLION, estadoBusqueda = 200, estadoToken = 200 } = {}) {
  const pedidos = [];
  const fetchFn = async (url, init = {}) => {
    pedidos.push({ url, init });
    if (url.includes('/oauth2/token')) {
      return { status: estadoToken, ok: estadoToken === 200, json: async () => ({ access_token: 'tok', expires_in: 7200 }) };
    }
    return { status: estadoBusqueda, ok: estadoBusqueda === 200, json: async () => ({ total: items.length, itemSummaries: items }) };
  };
  return { fetchFn, pedidos };
}

const cfg = { vigenciaDias: 3, maxConsultasPorCorrida: 10, limite: 50, minPublicaciones: 3, tomarMasBaratas: 5 };
const oferta = { id: '1', ean: '3349666007921', marca: 'RABANNE', nombre: 'One Million EDT 100 ml', ml: 100 };

test('precio: pide token una vez, busca por gtin en EBAY_US con filtros de nuevo y precio fijo, y convierte a pesos', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ebay-'));
  const { fetchFn, pedidos } = fetchSimulado();
  const ebay = crearEbay({ clientId: 'id', clientSecret: 'secreto', dolar: 1555, hoy: '2026-11-02', rutaCache: join(dir, 'e.json'), fetchFn, cfg, log: () => {} });
  const r = await ebay.precio(oferta, 'juleriaque');
  assert.deepEqual({ ...r, url: undefined }, { estado: 'ok', precio: 122845, usd: 79, n: 5, via: 'ean', url: undefined });

  const [token, busqueda] = pedidos;
  assert.ok(token.url.endsWith('/identity/v1/oauth2/token'));
  assert.equal(token.init.headers.Authorization, `Basic ${Buffer.from('id:secreto').toString('base64')}`);
  assert.ok(token.init.body.includes('grant_type=client_credentials'));
  const u = new URL(busqueda.url);
  assert.equal(u.pathname, '/buy/browse/v1/item_summary/search');
  assert.equal(u.searchParams.get('gtin'), '3349666007921');
  assert.ok(u.searchParams.get('filter').includes('conditionIds:{1000}'));
  assert.ok(u.searchParams.get('filter').includes('buyingOptions:{FIXED_PRICE}'));
  assert.equal(busqueda.init.headers['X-EBAY-C-MARKETPLACE-ID'], 'EBAY_US');

  // Del caché: sin pedidos nuevos.
  await ebay.precio(oferta, 'juleriaque');
  assert.equal(pedidos.length, 2);
  await ebay.guardar();
  assert.equal(JSON.parse(await readFile(join(dir, 'e.json'), 'utf8'))['ean:3349666007921'].usd, 79);
});

test('precio: sin publicaciones suficientes queda "sin" y se guarda; sin forma de buscar no pide nada', async () => {
  const { fetchFn, pedidos } = fetchSimulado({ items: [item('X', 10)] });
  const ebay = crearEbay({ clientId: 'id', clientSecret: 's', dolar: 1555, hoy: '2026-11-02', rutaCache: 'x', fetchFn, cfg, log: () => {} });
  assert.deepEqual(await ebay.precio(oferta, 'juleriaque'), { estado: 'sin' });
  assert.deepEqual(await ebay.precio({ id: '9', marca: 'DIOR', nombre: 'Sauvage EDT', ml: 100 }, 'rouge'), { estado: 'sin' });
  assert.equal(pedidos.filter((p) => p.url.includes('/search')).length, 1);
});

test('precio: credenciales rechazadas cortan la corrida y todo queda pendiente', async () => {
  const { fetchFn, pedidos } = fetchSimulado({ estadoToken: 401 });
  const ebay = crearEbay({ clientId: 'id', clientSecret: 'mal', dolar: 1555, hoy: '2026-11-02', rutaCache: 'x', fetchFn, cfg, log: () => {} });
  assert.deepEqual(await ebay.precio(oferta, 'juleriaque'), { estado: 'pendiente' });
  assert.deepEqual(await ebay.precio({ ...oferta, ean: '3605521172525' }, 'juleriaque'), { estado: 'pendiente' });
  assert.equal(pedidos.length, 1, 'no insiste');
  assert.ok(ebay.corte);
  assert.ok(!ebay.corte.message.includes('mal'), 'nunca muestra la clave');
});

test('precio: un 429 de eBay corta la corrida; el cupo agotado deja pendiente', async () => {
  const { fetchFn } = fetchSimulado({ estadoBusqueda: 429 });
  const ebay = crearEbay({ clientId: 'id', clientSecret: 's', dolar: 1555, hoy: '2026-11-02', rutaCache: 'x', fetchFn, cfg, log: () => {} });
  assert.deepEqual(await ebay.precio(oferta, 'juleriaque'), { estado: 'pendiente' });
  assert.ok(ebay.corte);

  const otro = fetchSimulado();
  const conCupo = crearEbay({ clientId: 'id', clientSecret: 's', dolar: 1555, hoy: '2026-11-02', rutaCache: 'x', fetchFn: otro.fetchFn, cfg: { ...cfg, maxConsultasPorCorrida: 1 }, log: () => {} });
  assert.equal((await conCupo.precio(oferta, 'juleriaque')).estado, 'ok');
  assert.deepEqual(await conCupo.precio({ ...oferta, ean: '3605521172525' }, 'juleriaque'), { estado: 'pendiente' });
});
