import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../src/config.mjs';
import { elegirParaAvisar, esParaHombre, evaluarLocal, pisoDeTienda, precioHabitual, tallesUtiles, tipoDePrenda } from '../src/nucleo/locales.mjs';
import { correrLocales, deShopify } from '../src/locales.mjs';

const cfg = config.locales;
const o = (extra = {}) => ({ id: '1', nombre: 'REMERA LOGO HOMBRE', url: 'https://x/p/1', precioActual: 20000, precioLista: 40000, stock: 3, talles: ['M', 'L'], categorias: [], ...extra });

test('tipoDePrenda: reconoce las prendas con precio máximo y deja afuera los accesorios', () => {
  assert.equal(tipoDePrenda('PARKA DE SENDERISMO HOMBRE'), 'campera');
  assert.equal(tipoDePrenda('Botas de Trekking'), 'calzado');
  assert.equal(tipoDePrenda('Jean scanton slim'), 'jean');
  assert.equal(tipoDePrenda('Remera de manga larga'), 'remera');
  assert.equal(tipoDePrenda('LENTES DE SOL'), null);
  assert.ok(Object.keys(cfg.topes).includes('calzado'));
});

test('esParaHombre: nada de mujer ni de niños', () => {
  assert.ok(esParaHombre({ nombre: 'REMERA HOMBRE' }) && esParaHombre({ nombre: 'Remera logo' }));
  assert.ok(!esParaHombre({ nombre: 'Blusa Too Loud' }));
  assert.ok(!esParaHombre({ nombre: 'Remera', categorias: ['/MUJER/Remeras/'] }));
  assert.ok(!esParaHombre({ nombre: 'Remera', genero: 'm' }));
});

test('tallesUtiles: L y XL, pantalones por número, ni bebés ni talles ajenos', () => {
  assert.deepEqual(tallesUtiles(['S', 'L', 'XL'], 'remera'), ['L', 'XL']);
  assert.equal(tallesUtiles(['S', 'M'], 'remera'), null);
  assert.equal(tallesUtiles(['S-M'], 'sweater'), null);
  assert.deepEqual(tallesUtiles(['L-XL'], 'sweater'), ['L-XL']);
  assert.equal(tallesUtiles(['0-3 meses', '3-6 meses'], 'remera'), null);
  assert.equal(tallesUtiles(['TALLA:4', 'TALLA:6', 'TALLA:10'], 'jean'), null, 'numeración de mujer o de chicos');
  assert.equal(tallesUtiles(['52', '54'], 'pantalon'), null);
  assert.deepEqual(tallesUtiles(['40', '44', '46', '52'], 'pantalon'), ['44', '46']);
  assert.deepEqual(tallesUtiles(['30', '34', '36'], 'jean'), ['34', '36']);
  assert.deepEqual(tallesUtiles(['40', '45', '47'], 'calzado'), ['45']);
  assert.deepEqual(tallesUtiles(['1', '2'], 'chaleco'), ['1', '2'], 'otra numeración: se muestran');
  assert.equal(tallesUtiles(['4', '10'], 'buzo'), null, 'chicos o mujer');
  assert.equal(tallesUtiles([], 'remera'), null);
});

test('evaluarLocal: descuento de 40 % o más, no menor al piso de la tienda, bajo el precio máximo', () => {
  const ev = (oferta, extra = {}) => evaluarLocal(oferta, { fecha: '2026-11-26', cfg, ...extra });
  assert.equal(ev(o()).descuento, 0.5);
  assert.equal(ev(o({ precioActual: 28000 })), null, '30 % de descuento: no alcanza');
  assert.equal(ev(o({ precioActual: 31000, precioLista: 90000 })), null, 'remera arriba del precio máximo');
  assert.equal(ev(o(), { piso: 0.6 }), null, 'la tienda vive con descuentos más fuertes');
  assert.equal(ev(o({ stock: 0 })), null);
  assert.equal(ev(o({ nombre: 'LENTES DE SOL' })), null);
});

test('evaluarLocal: con 14 días de historial exige una baja real de 20 %', () => {
  const registro = { obs: [['2026-11-01', 22000, 40000]] };
  assert.equal(precioHabitual(registro, '2026-11-26'), 22000);
  assert.equal(evaluarLocal(o(), { registro, fecha: '2026-11-26', cfg }), null, '20.000 contra 22.000 habitual: lista inflada');
  assert.ok(evaluarLocal(o({ precioActual: 15000 }), { registro, fecha: '2026-11-26', cfg }).baja > 0.3);
  assert.equal(precioHabitual({ obs: [['2026-11-20', 22000]] }, '2026-11-26'), null, 'poco historial');
});

test('pisoDeTienda y elegirParaAvisar: solo lo nuevo o lo que bajó, un color por modelo, con tope', () => {
  assert.equal(pisoDeTienda([o({ precioActual: 30000 }), o(), o({ precioActual: 12000 }), o({ precioActual: 40000 })], 0.5), 0.5);
  const c = (url, precio, descuento, nombre = url) => ({ oferta: { url, nombre, precioActual: precio }, evaluacion: { descuento, baja: null } });
  const lista = [c('a', 100, 0.5, 'Chaleco'), c('b', 100, 0.8, 'Chaleco'), c('c', 100, 0.6), c('d', 100, 0.55)];
  assert.deepEqual(elegirParaAvisar(lista, {}, 3).map((x) => x.oferta.url), ['b', 'c', 'd']);
  assert.deepEqual(elegirParaAvisar(lista, { b: 100, c: 120 }, 3).map((x) => x.oferta.url), ['c', 'd', 'a'], 'b ya avisado al mismo precio; c bajó');
});

test('deShopify: talles disponibles y precio de la variante más barata con stock', () => {
  const p = {
    id: 9, title: 'Remera', vendor: 'X', handle: 'r', tags: ['GENDER_VALUE: Hombre', 'SS27'], options: [{ name: 'Color' }, { name: 'Talla' }],
    variants: [{ option1: 'Negro', option2: 'L', price: '100', compare_at_price: '200', available: true }, { option1: 'Negro', option2: 'XL', price: '100', available: false }],
  };
  const r = deShopify(p, 'https://t');
  assert.deepEqual([r.talles, r.precioActual, r.precioLista, r.url], [['L'], 100, 200, 'https://t/products/r']);
  assert.equal(deShopify({ ...p, variants: [{ price: '1', available: false }] }, 'https://t'), null);
});

test('correrLocales: avisa una vez, no repite al mismo precio, y una tienda caída no frena a las otras', async () => {
  const datos = await mkdtemp(join(tmpdir(), 'loc-'));
  const enviados = [];
  const tiendas = { buena: { nombre: 'Buena' }, rota: { nombre: 'Rota' } };
  const opciones = {
    datos, fecha: '2026-11-26', cfg: { ...cfg, tiendas }, crear: () => ({}), log: () => {},
    enviarFn: async (m) => enviados.push(m),
    leer: async (_c, t) => { if (t.nombre === 'Rota') throw new Error('caída'); return [o()]; },
  };
  const uno = await correrLocales(opciones);
  assert.equal(uno.elegidas.length, 1);
  assert.deepEqual(uno.fallaron, ['rota']);
  assert.match(enviados[0], /sin referencia internacional/);
  assert.equal((await correrLocales(opciones)).elegidas.length, 0, 'ya avisada');
  assert.ok(JSON.parse(await readFile(join(datos, 'locales', 'avisadas.json'), 'utf8'))['https://x/p/1']);
});
