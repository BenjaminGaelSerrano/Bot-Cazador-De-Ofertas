import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { categoriaRaiz, extraerMl, normalizarProducto } from '../src/fuentes/juleriaque.mjs';

const pagina = JSON.parse(await readFile(new URL('./fixtures/juleriaque-pagina.json', import.meta.url), 'utf8'));

const productoBase = (extra = {}, oferta = {}) => ({
  productId: '1', productName: 'NIACINAMIDE', brand: 'THE ORDINARY', link: 'https://x.test/n/p',
  categories: ['/Tratamiento/Rostro/', '/Tratamiento/'],
  items: [{ itemId: '10', name: 'Niacinamide 30 ml', ean: '123',
    sellers: [{ commertialOffer: { Price: 100, ListPrice: 100, AvailableQuantity: 5, ...oferta } }] }],
  ...extra,
});

test('extraerMl: enteros, decimales y ausencia', () => {
  assert.equal(extraerMl('Glycolic Acid 240 ml'), 240);
  assert.equal(extraerMl('Perfume 7,5ML'), 7.5);
  assert.equal(extraerMl('Antonela Kit'), null);
  assert.equal(extraerMl('Crema 50 mlx2'), null);
});

test('categoriaRaiz: toma la última entrada', () => {
  assert.equal(categoriaRaiz(['/Tratamiento/Low Cost/', '/Tratamiento/']), 'Tratamiento');
  assert.equal(categoriaRaiz([]), null);
  assert.equal(categoriaRaiz(undefined), null);
});

test('normalizarProducto: genera la forma esperada', () => {
  const [o] = normalizarProducto(productoBase());
  assert.deepEqual(o, {
    id: '10', productoId: '1', ean: '123', marca: 'THE ORDINARY', nombre: 'Niacinamide 30 ml', ml: 30,
    categoria: 'Tratamiento', precioActual: 100, precioLista: 100, moneda: 'ARS', url: 'https://x.test/n/p', stock: 5,
  });
});

test('normalizarProducto: un oferta por SKU', () => {
  const p = productoBase();
  p.items.push({ itemId: '11', name: 'Niacinamide 60 ml', ean: '456',
    sellers: [{ commertialOffer: { Price: 180, ListPrice: 200, AvailableQuantity: 0 } }] });
  const ofertas = normalizarProducto(p);
  assert.deepEqual(ofertas.map((o) => [o.id, o.ml, o.precioActual, o.precioLista, o.stock]), [
    ['10', 30, 100, 100, 5], ['11', 60, 180, 200, 0],
  ]);
});

test('normalizarProducto: si el SKU no repite el nombre del producto, se lo antepone', () => {
  const p = productoBase({ productName: 'LABIAL MATE' });
  p.items[0].name = 'Rojo 3 ml';
  assert.equal(normalizarProducto(p)[0].nombre, 'LABIAL MATE Rojo 3 ml');
});

test('normalizarProducto: la URL relativa se completa con el dominio', () => {
  const [o] = normalizarProducto(productoBase({ link: '/niacinamide/p' }), { base: 'https://sitio.test' });
  assert.equal(o.url, 'https://sitio.test/niacinamide/p');
});

test('normalizarProducto: ListPrice 0 se toma como "sin descuento"', () => {
  const [o] = normalizarProducto(productoBase({}, { ListPrice: 0 }));
  assert.equal(o.precioLista, 100);
});

test('normalizarProducto: descarta precio 0 y lista menor que el precio', () => {
  assert.deepEqual(normalizarProducto(productoBase({}, { Price: 0 })), []);
  assert.deepEqual(normalizarProducto(productoBase({}, { Price: 100, ListPrice: 90 })), []);
});

test('normalizarProducto: descarta categorías excluidas', () => {
  const p = productoBase({ categories: ['/Testers/Perfume/', '/Testers/'] });
  assert.deepEqual(normalizarProducto(p, { categoriasExcluidas: ['Testers'] }), []);
  assert.equal(normalizarProducto(p, { categoriasExcluidas: [] }).length, 1);
});

test('normalizarProducto: EAN vacío queda en null y sin oferta se ignora el SKU', () => {
  const p = productoBase();
  p.items[0].ean = '';
  p.items.push({ itemId: '99', name: 'Sin vendedor', ean: '', sellers: [] });
  const ofertas = normalizarProducto(p);
  assert.equal(ofertas.length, 1);
  assert.equal(ofertas[0].ean, null);
});

test('fixture real: normaliza los 50 productos sin perder SKU válidos', () => {
  const totalItems = pagina.reduce((n, p) => n + p.items.length, 0);
  const ofertas = pagina.flatMap((p) => normalizarProducto(p));
  assert.ok(ofertas.length > 50, 'hay más SKU que productos');
  assert.ok(ofertas.length <= totalItems);
  assert.equal(new Set(ofertas.map((o) => o.id)).size, ofertas.length, 'los id de SKU no se repiten');
  for (const o of ofertas) {
    assert.ok(o.precioActual > 0 && o.precioLista >= o.precioActual);
    assert.ok(o.url.startsWith('https://www.juleriaque.com.ar/'));
    assert.ok(o.nombre.length > 0 && o.marca);
  }
  assert.ok(ofertas.some((o) => o.precioLista > o.precioActual), 'la fixture trae descuentos');
  assert.ok(ofertas.some((o) => o.stock === 0), 'la fixture trae productos sin stock');
  assert.ok(ofertas.some((o) => o.ml !== null), 'se extraen tamaños');
});
