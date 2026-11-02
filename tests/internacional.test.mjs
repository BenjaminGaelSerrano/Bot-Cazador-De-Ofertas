import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ErrorFuente } from '../src/nucleo/http.mjs';
import {
  claveNombre, comparable, concentracion, crearReferencias, emparejar, esPerfume, mismaMarca, mlDe, textoBusqueda,
} from '../src/nucleo/internacional.mjs';
import { fila, itemTabla, marcaInternacional } from '../src/notificar/tabla.mjs';

// Ficha de Perfumania con la forma de Shopify. Variantes y códigos de barras reales (2026-11-02); vendor y tipo
// simulados.
const UN_MILLON = {
  title: '1 Million Cologne',
  handle: 'paco-rabanne-1-million-cologne-eau-de-toilette-for-men',
  vendor: 'Paco Rabanne',
  product_type: 'Eau de Toilette',
  variants: [
    { title: '1.7 oz.', price: '82.95', compare_at_price: '99.00', barcode: '3349666007891' },
    { title: '3.4 oz.', price: '104.95', compare_at_price: '126.00', barcode: '3349666007921' },
    { title: '3.4 oz. Tester', price: '62.00', compare_at_price: '133.98', barcode: '3349666007914' },
    { title: '6.8 oz.', price: '142.95', compare_at_price: '172.00', barcode: '3349668509669' },
  ],
};

const oferta = (extra = {}) => ({
  id: '1', marca: 'RABANNE', nombre: 'One Million EDT 100 ml', ml: 100, ean: '3349666007921', cat: 'Fragancias',
  precioActual: 150000, url: 'https://juleriaque.test/p', ...extra,
});

// ---------- Piezas ----------

test('concentracion: EDP, EDT, EDC y Parfum, sin confundir "eau de parfum" con "parfum"', () => {
  assert.equal(concentracion('Sauvage Eau de Parfum'), 'edp');
  assert.equal(concentracion('Invictus Parfum 50 ml'), 'parfum');
  assert.equal(concentracion('Bleu de Chanel EDT 100 ml'), 'edt');
  assert.equal(concentracion('Revitalift Agua Micelar'), null);
});

test('esPerfume: categoría de fragancias o concentración en el nombre, y siempre con ml', () => {
  assert.ok(esPerfume(oferta()));
  assert.ok(esPerfume({ nombre: 'Libre EDP 90 ml', ml: 90, cat: null }));
  assert.ok(!esPerfume({ nombre: 'Revitalift Agua Micelar 200 ml', ml: 200, cat: 'Tratamiento' }));
  assert.ok(!esPerfume({ nombre: 'ZAPATILLAS NIKE AIR FORCE 1', ml: null, cat: 'Calzado' }));
});

test('mlDe: onzas a ml y ml tal cual', () => {
  assert.ok(Math.abs(mlDe('3.4 oz.') - 100.55) < 0.1);
  assert.equal(mlDe('100 ml'), 100);
  assert.equal(mlDe('Default Title'), null);
});

test('comparable: testers, sets y combos no sirven como referencia', () => {
  assert.ok(comparable('3.4 oz.'));
  assert.ok(!comparable('3.4 oz. Tester'));
  assert.ok(!comparable('Bundle Deal For Men Invictus'));
  assert.ok(!comparable('Gift Set'));
});

test('mismaMarca: una marca contenida en la otra', () => {
  assert.ok(mismaMarca('RABANNE', 'Paco Rabanne'));
  assert.ok(mismaMarca('Giorgio Armani', 'ARMANI'));
  assert.ok(!mismaMarca('Dior', 'Chanel'));
  assert.ok(!mismaMarca('', 'Chanel'));
});

test('claveNombre: sin marca, tamaño, concentración ni relleno', () => {
  assert.equal(claveNombre('Acqua Di Gioia EDP 100 ml', ['ARMANI']), 'acqua di gioia');
  assert.equal(claveNombre('Acqua Di Gioia Perfume', ['Giorgio Armani']), 'acqua di gioia');
  assert.equal(claveNombre('Sauvage Eau de Parfum 3.4 oz', ['Dior']), 'sauvage');
});

test('textoBusqueda: marca + nombre, sin tamaño ni lo que viene después de un "+"', () => {
  assert.equal(textoBusqueda(oferta()), 'rabanne one million edt');
  assert.equal(textoBusqueda({ marca: 'CALVIN KLEIN', nombre: 'CK One Essence EDP 100 ml + Shower Gel' }), 'calvin klein ck one essence edp');
});

// ---------- Emparejado ----------

test('emparejar: por código de barras toma esa variante, aunque los nombres no coincidan', () => {
  assert.deepEqual(emparejar(oferta(), UN_MILLON), { usd: 104.95, via: 'ean', variante: '3.4 oz.' });
});

test('emparejar: el tester nunca es la referencia, aunque su código coincida', () => {
  assert.equal(emparejar(oferta({ ean: '3349666007914', nombre: 'Algo distinto EDT', marca: 'Otra' }), UN_MILLON), null);
});

test('emparejar por nombre: marca, nombre, concentración y tamaño iguales', () => {
  const ficha = { ...UN_MILLON, title: 'One Million Cologne' };
  const sinEan = oferta({ ean: null });
  assert.deepEqual(emparejar(sinEan, ficha), { usd: 104.95, via: 'nombre', variante: '3.4 oz.' });
  assert.equal(emparejar(oferta({ ean: null, ml: 50 }), ficha).usd, 82.95, '50 ml = 1.7 oz');
  assert.equal(emparejar(oferta({ ean: null, ml: 75 }), ficha), null, 'no hay 75 ml');
  assert.equal(emparejar(oferta({ ean: null, nombre: 'One Million EDP 100 ml' }), ficha), null, 'EDP no es EDT');
  assert.equal(emparejar(oferta({ ean: null, nombre: 'One Million 100 ml' }), ficha), null, 'concentración desconocida');
  assert.equal(emparejar(oferta({ ean: null, nombre: 'One Million Elixir EDT 100 ml' }), ficha), null, 'otro nombre');
  assert.equal(emparejar(oferta({ ean: null, marca: 'DIOR' }), ficha), null, 'otra marca');
});

// ---------- Servicio ----------

function clienteSimulado(respuestas) {
  const pedidos = [];
  return {
    pedidos,
    async obtenerJson(url) {
      pedidos.push(url);
      for (const [patron, respuesta] of respuestas) {
        if (url.includes(patron)) {
          if (respuesta instanceof Error) throw respuesta;
          return { datos: respuesta };
        }
      }
      throw new ErrorFuente('cliente', `404 ${url}`, { status: 404, url });
    },
  };
}

const SUGERENCIAS = { resources: { results: { products: [
  { title: 'Invictus By Paco Rabanne And 1 Million', handle: 'bundle-deal-invictus-1-million', vendor: 'Paco Rabanne' },
  { title: '1 Million Cologne', handle: UN_MILLON.handle, vendor: 'Paco Rabanne' },
] } } };

const cfg = (extra = {}) => ({
  vigenciaDias: 7,
  perfumania: { base: 'https://perfumania.test', maxPedidosPorCorrida: 10, resultadosBusqueda: 3, toleranciaMl: 0.04, ...extra },
});

test('buscar: encuentra por código de barras, convierte con el dólar y saltea los combos', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ref-'));
  const cliente = clienteSimulado([['search/suggest', SUGERENCIAS], [`/products/${UN_MILLON.handle}.json`, { product: UN_MILLON }]]);
  const refs = crearReferencias({ cliente, dolar: 1555, hoy: '2026-11-02', rutaCache: join(dir, 'p.json'), cfg: cfg(), log: () => {} });
  const r = await refs.buscar(oferta());
  assert.deepEqual(r, { estado: 'ok', usd: 104.95, pesos: 163197, via: 'ean', url: `https://perfumania.test/products/${UN_MILLON.handle}` });
  assert.equal(cliente.pedidos.length, 2, 'una búsqueda y una ficha (el combo no se pide)');

  // Segunda vez, del caché: sin pedidos.
  await refs.buscar(oferta());
  assert.equal(cliente.pedidos.length, 2);
  await refs.guardar();
  const guardado = JSON.parse(await readFile(join(dir, 'p.json'), 'utf8'));
  assert.equal(guardado['ean:3349666007921'].usd, 104.95);
});

test('buscar: lo que no está se guarda como "sin" y no se vuelve a buscar hasta que venza', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ref-'));
  const ruta = join(dir, 'p.json');
  const vacio = { resources: { results: { products: [] } } };
  const cliente = clienteSimulado([['search/suggest', vacio]]);
  const refs = crearReferencias({ cliente, dolar: 1555, hoy: '2026-11-02', rutaCache: ruta, cfg: cfg(), log: () => {} });
  assert.deepEqual(await refs.buscar(oferta()), { estado: 'sin' });
  await refs.guardar();

  const otra = crearReferencias({ cliente, dolar: 1555, hoy: '2026-11-08', rutaCache: ruta, cfg: cfg(), log: () => {} });
  await otra.buscar(oferta());
  assert.equal(cliente.pedidos.length, 1, 'a los 6 días sigue vigente');
  const vencida = crearReferencias({ cliente, dolar: 1555, hoy: '2026-11-09', rutaCache: ruta, cfg: cfg(), log: () => {} });
  await vencida.buscar(oferta());
  assert.equal(cliente.pedidos.length, 2, 'a los 7 días se busca de nuevo');
});

test('buscar: lo que no es perfume o sin dólar no pide nada y queda "sin"', async () => {
  const cliente = clienteSimulado([]);
  const refs = crearReferencias({ cliente, dolar: 1555, hoy: '2026-11-02', rutaCache: 'x', cfg: cfg(), log: () => {} });
  assert.deepEqual(await refs.buscar({ nombre: 'ZAPATILLAS JORDAN', marca: 'Nike', ml: null }), { estado: 'sin' });
  const sinDolar = crearReferencias({ cliente, dolar: null, hoy: '2026-11-02', rutaCache: 'x', cfg: cfg(), log: () => {} });
  assert.deepEqual(await sinDolar.buscar(oferta()), { estado: 'sin' });
  assert.equal(cliente.pedidos.length, 0);
});

test('buscar: ante un 429 deja de pedir en la corrida y todo queda pendiente', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ref-'));
  const bloqueo = new ErrorFuente('bloqueo', 'El sitio bloqueó el pedido (429)', { status: 429 });
  const cliente = clienteSimulado([['search/suggest', bloqueo]]);
  const refs = crearReferencias({ cliente, dolar: 1555, hoy: '2026-11-02', rutaCache: join(dir, 'p.json'), cfg: cfg(), log: () => {} });
  assert.deepEqual(await refs.buscar(oferta()), { estado: 'pendiente' });
  assert.deepEqual(await refs.buscar(oferta({ ean: '3348901292269' })), { estado: 'pendiente' });
  assert.equal(cliente.pedidos.length, 1, 'después del bloqueo no se insiste');
  assert.equal(refs.bloqueo, bloqueo);
  await refs.guardar();
  await assert.rejects(readFile(join(dir, 'p.json'), 'utf8'), 'lo pendiente no se guarda como "sin"');
});

test('buscar: con el cupo de pedidos agotado, lo que falta queda pendiente', async () => {
  const cliente = clienteSimulado([['search/suggest', SUGERENCIAS], [`/products/${UN_MILLON.handle}.json`, { product: UN_MILLON }]]);
  const refs = crearReferencias({ cliente, dolar: 1555, hoy: '2026-11-02', rutaCache: 'x', cfg: cfg({ maxPedidosPorCorrida: 1 }), log: () => {} });
  assert.deepEqual(await refs.buscar(oferta()), { estado: 'pendiente' });
  assert.equal(cliente.pedidos.length, 1);
});

// ---------- Tabla ----------

test('tabla: marca internacional delante del nombre, sin alargar la fila', () => {
  assert.equal(marcaInternacional(null), '');
  assert.equal(marcaInternacional({ estado: 'ok', via: 'ean' }), '');
  assert.equal(marcaInternacional({ estado: 'ok', via: 'nombre' }), '~');
  assert.equal(marcaInternacional({ estado: 'sin' }), '*');
  const puntaje = { veredicto: 'buena', precioMercado: 313000, margen: 0.9, via: 'ean' };
  const filas = [null, { estado: 'ok', via: 'ean' }, { estado: 'ok', via: 'nombre' }, { estado: 'sin' }]
    .map((ref) => fila(1, itemTabla(oferta(), puntaje, ref)));
  assert.equal(new Set(filas.map((f) => f.length)).size, 1, filas.join('\n'));
  assert.ok(filas[2].startsWith(' 1~RABANNE '), filas[2]);
  assert.ok(filas[3].startsWith(' 1*RABANNE '), filas[3]);
});
