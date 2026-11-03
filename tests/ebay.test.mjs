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

test('precioDePublicaciones: sin testers ni decants ni precios absurdos; cuartil inferior, sin envío', () => {
  const r = precioDePublicaciones(ONE_MILLION, { minimo: 3, percentil: 0.25, conEnvio: false });
  // Sin envío quedan 70, 72, 79, 84, 88 (el de 20 se descarta por absurdo): el cuartil inferior es 72.
  assert.equal(r.usd, 72);
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
    { via: 'ean', clave: 'ean:3349666007921', params: { gtin: '3349666007921' }, ml: null });
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

const cfg = { vigenciaDias: 3, maxConsultasPorCorrida: 10, limite: 50, minPublicaciones: 3, percentil: 0.25, conEnvio: false };
const oferta = { id: '1', ean: '3349666007921', marca: 'RABANNE', nombre: 'One Million EDT 100 ml', ml: 100 };

test('precio: pide token una vez, busca por gtin en EBAY_US con filtros de nuevo y precio fijo, y convierte a pesos', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ebay-'));
  const { fetchFn, pedidos } = fetchSimulado();
  const ebay = crearEbay({ clientId: 'id', clientSecret: 'secreto', dolar: 1555, hoy: '2026-11-02', rutaCache: join(dir, 'e.json'), fetchFn, cfg, log: () => {} });
  const r = await ebay.precio(oferta, 'juleriaque');
  assert.deepEqual({ ...r, url: undefined }, { estado: 'ok', precio: Math.round(72 * 1555), usd: 72, n: 5, via: 'ean', url: undefined });

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
  assert.equal(JSON.parse(await readFile(join(dir, 'e.json'), 'utf8'))['ean:3349666007921'].usd, 72);
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

test('filtrarPorConsulta: por código, solo títulos con el código (caso real Puma RX 737); por nombre, todas las palabras', async () => {
  const { filtrarPorConsulta } = await import('../src/nucleo/ebay.mjs');
  const puma = [
    { title: 'Puma Softride ST Miller SD - 402667-05' },
    { title: 'PUMA WILD RIDER ROLLIN\' 381517-04 EBONY WHITE' },
    { title: 'Puma RX 737 Vintage 401332 04 Mens' },
  ];
  assert.deepEqual(filtrarPorConsulta(puma, { via: 'codigo', params: { q: 'puma 401332-04' } }).map((x) => x.title), ['Puma RX 737 Vintage 401332 04 Mens']);
  const af1 = [{ title: "Nike Air Force 1 '07 Black White CT2302-002 Men's" }, { title: 'Nike Air Max 90 CT2302-002 typo' }, { title: 'Nike Dunk Low Panda' }];
  assert.equal(filtrarPorConsulta(af1, { via: 'codigo', params: { q: 'nike CT2302-002' } }).length, 2);
  const samba = [{ title: 'Adidas Samba OG Cloud White Mens' }, { title: 'Adidas Samba Classic' }, { title: 'Adidas Gazelle OG' }];
  assert.deepEqual(filtrarPorConsulta(samba, { via: 'nombre', params: { q: 'adidas samba og mens' } }).map((x) => x.title), ['Adidas Samba OG Cloud White Mens']);
  assert.equal(filtrarPorConsulta(puma, { via: 'ean', params: {} }).length, 3);
});

test('filtrarPorConsulta (código de barras): descarta los títulos con otro tamaño; acepta los que no dicen tamaño', async () => {
  const { filtrarPorConsulta } = await import('../src/nucleo/ebay.mjs');
  const items = [
    { title: 'Paco Rabanne 1 Million Eau de Toilette Spray 100ml / 3.4 fl oz' },
    { title: '1 One Million by Paco Rabanne for Men EDT 1.7 oz' },
    { title: 'Paco Rabanne 1 Million EDT for men' },
  ];
  const r = filtrarPorConsulta(items, { via: 'ean', params: { gtin: '3349666007921' }, ml: 100 });
  assert.deepEqual(r.map((x) => x.title), [items[0].title, items[2].title]);
});

test('precioDePublicaciones: packs, lotes y combos no cuentan (casos reales del 2026-11-03)', () => {
  const items = [
    item('BL Sally Hansen Double Duty Base & Top Coat 0.45 oz - *THREE PACK*', 26.83),
    item('Sally Hansen Double Duty Base & Top Coat Nail Polish #45109 3 Packs New', 19.99),
    item('Revlon Lot Liners, Pencil, Balm, Lipstick, Colorstay 303, 015, 456, 301, 008 New', 15),
    item('Sally Hansen Double Duty Base and Top Coat Quick Dry', 8.92),
    item('Sally Hansen Double Duty Base & Top Coat 2 pk', 14),
  ];
  const r = precioDePublicaciones(items, { minimo: 1, percentil: 0.25 });
  assert.equal(r.n, 1);
  assert.equal(r.usd, 8.92);
});

test('consultaPara: las zapatillas de niños no se buscan por nombre (se compararían con precios de adulto)', () => {
  assert.equal(consultaPara({ id: '1', marca: 'Nike', nombre: 'ZAPATILLAS NIKE SPORTSWEAR KILLSHOT 2 NIÑOS', km: 'nike|2 killshot', gen: 'n' }, 'grid'), null);
  assert.equal(consultaPara({ id: '2', marca: 'Nike', nombre: 'ZAPATILLAS NIKE SPORTSWEAR AIR FORCE 1 LV8 NIÑOS', km: 'nike|1 air force lv8', gen: null }, 'grid'), null);
  assert.equal(consultaPara({ id: '3', marca: 'Nike', nombre: 'ZAPATILLAS NIKE SPORTSWEAR KILLSHOT 2 HOMBRE', km: 'nike|2 killshot', gen: 'h' }, 'grid').via, 'nombre');
});

// ---------- Zapatillas: ventas reales (pedido del usuario, 2026-11-03) ----------

test('precioPorVentas: mediana del precio de lo vendido, ponderada por unidades; con pocas ventas no hay referencia', async () => {
  const { precioPorVentas } = await import('../src/nucleo/ebay.mjs');
  const fichas = [
    { precio: 300, vendidas: 0, url: 'a' },   // pedido alto que nadie compra: no cuenta
    { precio: 90, vendidas: 2, url: 'b' },
    { precio: 100, vendidas: 8, url: 'c' },
    { precio: 120, vendidas: 1, url: 'd' },
  ];
  assert.deepEqual(precioPorVentas(fichas, { minVentas: 3 }), { usd: 100, n: 3, ventas: 11, url: 'c' });
  assert.deepEqual(precioPorVentas([{ precio: 250, vendidas: 0 }, { precio: 300, vendidas: 0 }], { minVentas: 3 }), { sin: 1, ventas: 0 });
  assert.deepEqual(precioPorVentas([{ precio: 80, vendidas: 2 }], { minVentas: 3 }), { sin: 1, ventas: 2 });
});

test('servicio (zapatillas): lee las fichas, exige ventas y no gasta fichas si la oferta ya es cara', async () => {
  const { crearEbay } = await import('../src/nucleo/ebay.mjs');
  const busqueda = [
    { itemId: 'v1|1|0', title: 'Nike Air Force 1 07 Black CT2302-002', price: { value: '100', currency: 'USD' } },
    { itemId: 'v1|2|0', title: 'Nike Air Force 1 07 Black CT2302-002 New', price: { value: '90', currency: 'USD' } },
    { itemId: 'v1|3|0', title: 'Nike Air Force 1 07 Black CT2302-002 Size 10', price: { value: '150', currency: 'USD' } },
  ];
  const vendidas = { 'v1|1|0': 6, 'v1|2|0': 2, 'v1|3|0': 0 };
  const pedidos = [];
  const fetchFn = async (url) => {
    pedidos.push(url);
    if (url.includes('/oauth2/token')) return { status: 200, ok: true, json: async () => ({ access_token: 't' }) };
    if (url.includes('/item_summary/search')) return { status: 200, ok: true, json: async () => ({ itemSummaries: busqueda }) };
    const id = decodeURIComponent(url.split('/item/')[1]);
    return { status: 200, ok: true, json: async () => ({ estimatedAvailabilities: [{ estimatedSoldQuantity: vendidas[id] }] }) };
  };
  const cfgV = { ...cfg, ventas: { activo: true, minVentas: 3, fichas: 8, cotaPercentil: 0.75 } };
  const ebay = crearEbay({ clientId: 'i', clientSecret: 's', dolar: 1000, hoy: '2026-11-03', rutaCache: 'x', fetchFn, cfg: cfgV, log: () => {} });
  const zapa = { id: 'NICT2302-002', marca: 'Nike', nombre: "Air Force 1 '07", km: 'x', precioActual: 80000 }; // US$80
  const r = await ebay.precio(zapa, 'moov');
  assert.equal(r.estado, 'ok');
  assert.equal(r.usd, 100, 'mediana de lo vendido: 2 a US$90 y 6 a US$100');
  assert.equal(r.ventas, 8);
  assert.equal(pedidos.filter((u) => u.includes('/buy/browse/v1/item/')).length, 3);

  // Cara (más que el percentil 75 de lo publicado): no se leen fichas.
  pedidos.length = 0;
  const cara = { ...zapa, id: 'NICT2302-003', precioActual: 200000 };
  busqueda.forEach((b) => { b.title = b.title.replace('CT2302-002', 'CT2302-003'); });
  assert.equal((await ebay.precio(cara, 'moov')).estado, 'sin');
  assert.equal(pedidos.filter((u) => u.includes('/buy/browse/v1/item/')).length, 0);
});

test('esSoloPerfume: perfumes sí; maquillaje, cremas, geles y after shave no', async () => {
  const { esSoloPerfume } = await import('../src/nucleo/internacional.mjs');
  assert.ok(esSoloPerfume({ nombre: 'Invictus Parfum 50 ml', ml: 50, cat: 'Fragancias' }));
  assert.ok(esSoloPerfume({ nombre: 'Libre EDP 90 ml', ml: 90, cat: null }));
  for (const nombre of ['Sauvage After Shave Lotion 100 ml', 'Good Girl Body Lotion 200 ml', 'One Million Shower Gel 150 ml', 'Revitalift Crema 50 ml'])
    assert.ok(!esSoloPerfume({ nombre, ml: 100, cat: 'Fragancias' }), nombre);
  assert.ok(!esSoloPerfume({ nombre: 'COLORSTAY SUEDE INK LIPSTICK', ml: null, cat: 'Maquillaje' }));
});
