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

// La búsqueda por nombre quedó apagada (solo color exacto, 2026-11-05); estas pruebas la prenden a propósito.
async function conNombre(fn) {
  const { config } = await import('../src/config.mjs');
  const antes = config.ebay.buscarPorNombre;
  config.ebay.buscarPorNombre = true;
  try { return await fn(); } finally { config.ebay.buscarPorNombre = antes; }
}

test('consultaPara: código de barras, después código de modelo, después nombre (solo ropa y calzado)', () => conNombre(() => {
  assert.deepEqual(consultaPara({ ean: '3349666007921', nombre: 'One Million EDT 100 ml', marca: 'RABANNE' }, 'juleriaque'),
    { via: 'ean', clave: 'ean:3349666007921', params: { gtin: '3349666007921' }, ml: null });
  assert.equal(consultaPara({ id: 'NICW2288-111', marca: 'Nike', nombre: 'Air Force 1', km: 'nike|1 air force' }, 'moov').via, 'codigo');
  assert.equal(consultaPara({ id: '2329', marca: 'Adidas Originals', nombre: 'ZAPATILLAS ADIDAS ORIGINALS SAMBA OG', km: 'adidas|og samba', gen: 'h' }, 'grid').via, 'nombre');
  assert.equal(consultaPara({ id: '9', ean: null, marca: 'DIOR', nombre: 'Sauvage EDT 100 ml', ml: 100 }, 'rouge'), null, 'perfume sin código: no');
}));

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

test('consultaPara: las zapatillas de niños no se buscan por nombre (se compararían con precios de adulto)', () => conNombre(() => {
  assert.equal(consultaPara({ id: '1', marca: 'Nike', nombre: 'ZAPATILLAS NIKE SPORTSWEAR KILLSHOT 2 NIÑOS', km: 'nike|2 killshot', gen: 'n' }, 'grid'), null);
  assert.equal(consultaPara({ id: '2', marca: 'Nike', nombre: 'ZAPATILLAS NIKE SPORTSWEAR AIR FORCE 1 LV8 NIÑOS', km: 'nike|1 air force lv8', gen: null }, 'grid'), null);
  assert.equal(consultaPara({ id: '3', marca: 'Nike', nombre: 'ZAPATILLAS NIKE SPORTSWEAR KILLSHOT 2 HOMBRE', km: 'nike|2 killshot', gen: 'h' }, 'grid').via, 'nombre');
}));

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

test('fichas: las unidades vendidas de una publicación se reutilizan y se guardan aparte', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fichas-'));
  const busqueda = [
    { itemId: 'v1|1|0', title: 'Nike Air Force 1 07 Black CT2302-002', price: { value: '100', currency: 'USD' } },
    { itemId: 'v1|2|0', title: 'Nike Air Force 1 07 Black CT2302-002 New', price: { value: '90', currency: 'USD' } },
  ];
  let fichasLeidas = 0;
  const fetchFn = async (url) => {
    if (url.includes('/oauth2/token')) return { status: 200, ok: true, json: async () => ({ access_token: 't' }) };
    if (url.includes('/item_summary/search')) return { status: 200, ok: true, json: async () => ({ itemSummaries: busqueda }) };
    fichasLeidas++;
    return { status: 200, ok: true, json: async () => ({ estimatedAvailabilities: [{ estimatedSoldQuantity: 4 }] }) };
  };
  const cfgV = { ...cfg, vigenciaDias: 0, ventas: { activo: true, minVentas: 3, fichas: 8, cotaPercentil: 0.75, vigenciaFichasDias: 7 } };
  const zapa = { id: 'NICT2302-002', marca: 'Nike', nombre: "Air Force 1 '07", km: 'x', precioActual: 80000 };
  const rutaCache = join(dir, 'ebay-v2.json');
  const a = crearEbay({ clientId: 'i', clientSecret: 's', dolar: 1000, hoy: '2026-11-03', rutaCache, fetchFn, cfg: cfgV, log: () => {} });
  assert.equal((await a.precio(zapa, 'moov')).estado, 'ok');
  assert.equal(fichasLeidas, 2);
  await a.guardar();
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'ebay-v2-fichas.json'), 'utf8'))['v1|1|0'], [4, '2026-11-03']);

  // Otra corrida 3 días después: el precio se vuelve a buscar (vigencia 0) pero las fichas no se vuelven a leer.
  const b = crearEbay({ clientId: 'i', clientSecret: 's', dolar: 1000, hoy: '2026-11-06', rutaCache, fetchFn, cfg: cfgV, log: () => {} });
  const r = await b.precio(zapa, 'moov');
  assert.equal(r.ventas, 8);
  assert.equal(fichasLeidas, 2);
  assert.equal(b.consultas, 1, 'solo la búsqueda');

  // Vencidas (8 días): se leen de nuevo.
  const c = crearEbay({ clientId: 'i', clientSecret: 's', dolar: 1000, hoy: '2026-11-11', rutaCache, fetchFn, cfg: cfgV, log: () => {} });
  await c.precio(zapa, 'moov');
  assert.equal(fichasLeidas, 4);
});

test('cupo del día: se reparte entre esta corrida y las que faltan antes de que se renueve', async () => {
  const { corridasPendientes } = await import('../src/nucleo/ebay.mjs');
  const horas = ['08:17', '12:17', '16:17', '20:17', '00:17'];
  assert.equal(corridasPendientes(new Date('2026-11-04T08:20:00Z'), horas), 4);
  assert.equal(corridasPendientes(new Date('2026-11-04T12:40:00Z'), horas), 3, 'aunque GitHub la demore');
  assert.equal(corridasPendientes(new Date('2026-11-04T18:00:00Z'), horas), 2, 'manual a la tarde');
  assert.equal(corridasPendientes(new Date('2026-11-05T00:17:00Z'), horas), 0, 'la última del día');
  assert.equal(corridasPendientes(new Date('2026-11-05T06:00:00Z'), horas), 0);
  assert.equal(corridasPendientes(new Date('2026-11-04T08:14:00Z'), horas), 4, 'la de las 08:17 es esta misma');

  const conRestante = (remaining) => async (url) => {
    if (url.includes('/oauth2/token')) return { status: 200, ok: true, json: async () => ({ access_token: 't' }) };
    return { status: 200, ok: true, json: async () => ({ rateLimits: [{ apiContext: 'buy', apiName: 'browse', resources: [{ name: 'buy.browse', rates: [{ limit: 5000, remaining }] }] }] }) };
  };
  const c = { ...cfg, maxConsultasPorCorrida: 4950, corridasUtc: horas, cupoDiario: 5000, margenCupo: 50 };
  const crear = (remaining) => crearEbay({ clientId: 'i', clientSecret: 's', dolar: 1000, hoy: '2026-11-04', rutaCache: 'x', fetchFn: conRestante(remaining), cfg: c, log: () => {} });
  assert.equal(await crear(5000).ajustarCupo(new Date('2026-11-04T08:20:00Z')), 990, '4950 entre 5');
  assert.equal(await crear(4500).ajustarCupo(new Date('2026-11-04T12:20:00Z')), 1112, 'la anterior gastó poco: sobra más');
  assert.equal(await crear(800).ajustarCupo(new Date('2026-11-05T00:20:00Z')), 750, 'la última usa todo');
  assert.equal(await crear(0).ajustarCupo(new Date('2026-11-04T12:20:00Z')), 0);
  // Sin dato de cupo: la parte de un día entero.
  const sinDato = crearEbay({ clientId: 'i', clientSecret: 's', dolar: 1000, hoy: '2026-11-04', rutaCache: 'x', cfg: c, log: () => {},
    fetchFn: async (url) => (url.includes('/oauth2/token') ? { status: 200, ok: true, json: async () => ({ access_token: 't' }) } : { status: 500, ok: false }) });
  assert.equal(await sinDato.ajustarCupo(), 1000);
});

test('repartir: cada tienda tiene su parte de la corrida y lo que no usa pasa a las siguientes', async () => {
  const s = ebayDeZapas([{ precio: 150, vendidas: 3 }, { precio: 120, vendidas: 2 }], { cfgExtra: { maxConsultasPorCorrida: 6 } });
  s.ebay.repartir(2); // 3 para esta tienda
  assert.equal((await s.ebay.precio(zapaA(80), 'moov')).estado, 'ok'); // búsqueda + 2 fichas = 3
  assert.equal((await s.ebay.precio({ ...zapaA(80), id: 'NICT2302-009' }, 'moov')).estado, 'pendiente', 'se le acabó la parte');
  s.ebay.repartir(1); // la siguiente: lo que queda (3)
  assert.equal(s.ebay.consultas, 3);
  assert.notEqual((await s.ebay.precio({ ...zapaA(80), id: 'NICT2302-009' }, 'moov')).estado, 'pendiente');
  assert.equal(s.ebay.consultas, 4, 'con la parte nueva sí consultó');
});

// Fetch simulado para zapatillas: `pubs` = [{ precio, vendidas }] en el orden de eBay.
function ebayDeZapas(pubs, { dolar = 1000, cfgExtra = {} } = {}) {
  const leidas = [];
  let busquedas = 0;
  const fetchFn = async (url) => {
    if (url.includes('/oauth2/token')) return { status: 200, ok: true, json: async () => ({ access_token: 't' }) };
    if (url.includes('/item_summary/search')) {
      busquedas++;
      return { status: 200, ok: true, json: async () => ({ itemSummaries: pubs.map((p, i) => ({ itemId: `v1|${i}|0`, title: 'Nike Air Force 1 07 Black CT2302-002', price: { value: String(p.precio), currency: 'USD' } })) }) };
    }
    const i = Number(decodeURIComponent(url.split('/item/')[1]).split('|')[1]);
    leidas.push(i);
    return { status: 200, ok: true, json: async () => ({ estimatedAvailabilities: [{ estimatedSoldQuantity: pubs[i].vendidas }] }) };
  };
  const cfgV = { ...cfg, ventas: { activo: true, minVentas: 3, fichas: 8, cotaPercentil: 0.75, vigenciaFichasDias: 7 }, ...cfgExtra };
  const ebay = crearEbay({ clientId: 'i', clientSecret: 's', dolar, hoy: '2026-11-03', rutaCache: 'x', fetchFn, cfg: cfgV, log: () => {} });
  return { ebay, leidas, get busquedas() { return busquedas; } };
}
const zapaA = (usd) => ({ id: 'NICT2302-002', marca: 'Nike', nombre: "Air Force 1 '07", km: 'x', precioActual: usd * 1000 });

test('fichas: si lo más caro que la oferta no suma 2 ventas, no se leen las más baratas', async () => {
  const s = ebayDeZapas([{ precio: 150, vendidas: 1 }, { precio: 70, vendidas: 10 }, { precio: 120, vendidas: 0 }, { precio: 60, vendidas: 5 }]);
  assert.equal((await s.ebay.precio(zapaA(80), 'moov')).estado, 'sin');
  assert.deepEqual(s.leidas.sort(), [0, 2], 'solo las de US$150 y 120');
  // Guardado como cota: al mismo precio no se vuelve a consultar; más barata sí.
  assert.equal((await s.ebay.precio(zapaA(80), 'moov')).estado, 'sin');
  assert.equal(s.busquedas, 1);
});

test('fichas: se dejan de leer las baratas cuando ya igualan a las caras', async () => {
  const s = ebayDeZapas([{ precio: 150, vendidas: 3 }, { precio: 70, vendidas: 6 }, { precio: 100, vendidas: 2 }, { precio: 60, vendidas: 9 }]);
  assert.equal((await s.ebay.precio(zapaA(80), 'moov')).estado, 'sin');
  assert.deepEqual(s.leidas.sort(), [0, 1, 2], 'la de US$60 no hace falta');
});

test('fichas: la decisión es la misma que leyendo todas (300 casos al azar)', async () => {
  const { precioPorVentas, percentilDe } = await import('../src/nucleo/ebay.mjs');
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let caso = 0; caso < 300; caso++) {
    const pubs = Array.from({ length: 2 + Math.floor(azar() * 9) }, () => ({ precio: 40 + Math.floor(azar() * 120), vendidas: azar() < 0.5 ? 0 : Math.floor(azar() * 6) }));
    const oferta = 40 + Math.floor(azar() * 120) + 0.5;
    const s = ebayDeZapas(pubs);
    const r = await s.ebay.precio(zapaA(oferta), 'moov');
    const buena = r.estado === 'ok' && oferta < r.usd;
    const todas = precioPorVentas(pubs.slice(0, 8), { minVentas: 3 });
    const publicado = Math.round(percentilDe(pubs.map((p) => p.precio), 0.5) * 100) / 100;
    const caraPorCota = oferta >= publicado;
    const esperada = !caraPorCota && !todas.sin && oferta < todas.usd;
    assert.equal(buena, esperada, `caso ${caso}: ${JSON.stringify({ pubs, oferta })}`);
    if (buena) assert.equal(r.usd, Math.min(todas.usd, publicado));
  }
});

test('la misma búsqueda pedida a la vez por dos ofertas se consulta una sola vez', async () => {
  const s = ebayDeZapas([{ precio: 150, vendidas: 3 }, { precio: 120, vendidas: 2 }]);
  const [a, b] = await Promise.all([s.ebay.precio(zapaA(80), 'moov'), s.ebay.precio({ ...zapaA(80), url: 'otro color' }, 'moov')]);
  assert.equal(a.estado, 'ok');
  assert.equal(b.usd, a.usd);
  assert.equal(s.busquedas, 1);
  assert.equal(s.leidas.length, 2);
});

test('los horarios del cupo de eBay coinciden con los cron del workflow', async () => {
  const { config } = await import('../src/config.mjs');
  const yml = await readFile(new URL('../.github/workflows/cazador.yml', import.meta.url), 'utf8');
  const crons = [...yml.matchAll(/cron: '(\d+) (\d+) \* \* \*'/g)].map(([, m, h]) => `${h.padStart(2, '0')}:${m.padStart(2, '0')}`);
  assert.deepEqual([...crons].sort(), [...config.ebay.corridasUtc].sort());
});

test('tope por lo publicado: una publicación cara con ventas viejas no infla el precio (Blazer Low 77, 2026-11-05)', async () => {
  // Datos reales del 2026-11-05: una a US$193 con 8 ventas, otra a 71,20 con 1, el resto sin ventas entre 40 y 83.
  const s = ebayDeZapas([193, 79, 71.2, 82.95, 64.99, 74, 40, 67].map((precio, i) => ({ precio, vendidas: [8, 0, 1, 0, 0, 0, 0, 0][i] })));
  const r = await s.ebay.precio(zapaA(52), 'moov');
  assert.equal(r.estado, 'ok');
  assert.equal(r.usd, 72.6, 'mediana de lo publicado, no los US$193 de lo vendido');
  assert.equal(r.ventas, 9);
  // Más cara que lo que pide la mitad de los vendedores: ni se leen fichas.
  const t = ebayDeZapas([193, 79, 71.2, 82.95, 64.99, 74, 40, 67].map((precio) => ({ precio, vendidas: 5 })));
  assert.equal((await t.ebay.precio(zapaA(80), 'moov')).estado, 'sin');
  assert.equal(t.leidas.length, 0);
});

test('caché: un precio por ventas guardado antes del tope se vuelve a calcular', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tope-'));
  const rutaCache = join(dir, 'ebay-v2.json');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(rutaCache, JSON.stringify({ 'cod:CT2302-002': { usd: 193, n: 2, ventas: 9, visto: '2026-11-03' } }));
  const e = crearEbay({ clientId: 'i', clientSecret: 's', dolar: 1000, hoy: '2026-11-03', rutaCache, cfg: { ...cfg, ventas: { activo: true, minVentas: 3, fichas: 8, vigenciaFichasDias: 7 } }, log: () => {} });
  // No devuelve los US$193 guardados: hay que volver a calcularlo con el tope.
  assert.equal(await e.enCache(zapaA(80), 'moov'), null);
});

test('consultaPara: Grid con código de estilo busca el color exacto; sin código no se consulta', () => {
  const blazer = { id: '3280013', marca: 'Nike Sportswear', nombre: "ZAPATILLAS NIKE BLAZER LOW '77 VINTAGE HOMBRE", km: 'nike|77 blazer low vintage', gen: 'h', codigo: 'DA6364-001' };
  assert.deepEqual(consultaPara(blazer, 'grid'), { via: 'codigo', clave: 'cod:DA6364-001', params: { q: 'nike DA6364-001' } });
  assert.equal(consultaPara({ ...blazer, codigo: undefined }, 'grid'), null, 'por nombre se mezclaban colores');
  assert.equal(consultaPara({ id: '1', marca: 'Adidas Originals', nombre: 'SAMBA OG', km: 'x', codigo: 'JI0079' }, 'grid').params.q, 'adidas JI0079');
});

test('Grid (VTEX): código de estilo, color y talles con stock', async () => {
  const { codigoEstilo, tallesDe } = await import('../src/fuentes/vtex.mjs');
  assert.equal(codigoEstilo("Zapatillas Nike BLAZER LOW '77 VINTAGE De Moda Para HOMBRE Código: DA6364-001"), 'DA6364-001');
  assert.equal(codigoEstilo('<p>Zapatillas adidas</p><p>Código: JI0079</p>'), 'JI0079');
  assert.equal(codigoEstilo('Puma Suede XL Codigo: 395205-02'), '395205-02');
  assert.equal(codigoEstilo('ZAPATILLAS JORDAN CMFT ERA MUJER ¿Buscas tenis?'), null);
  const item = (talle, ref, u) => ({ Talle: [talle], name: talle, referenceId: [{ Key: 'RefId', Value: ref }], sellers: [{ commertialOffer: { AvailableQuantity: u } }] });
  assert.deepEqual(tallesDe([item('38', '328-0013/06.5', 0), item('39', '328-0013/07 *', 1), item('42', '328-0013/09.5', 3)]),
    [{ t: '39', us: '7', u: 1 }, { t: '42', us: '9.5', u: 3 }]);
});
