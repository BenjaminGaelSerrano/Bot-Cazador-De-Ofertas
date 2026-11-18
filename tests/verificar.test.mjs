import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verificarEnTienda } from '../src/nucleo/verificar.mjs';

const respuesta = (cuerpo, { status = 200, texto = false } = {}) => async () => ({
  ok: status < 400, status,
  json: async () => cuerpo,
  text: async () => (texto ? cuerpo : JSON.stringify(cuerpo)),
});
const productoVtex = (id, precio, lista, stock) => ({
  productId: String(id), productName: `Producto ${id}`, brand: 'Nike', link: `/p${id}/p`, categories: ['/Calzado/'], description: '',
  items: [{ itemId: String(id), name: 'x', Talle: ['44'], ean: '', sellers: [{ commertialOffer: { Price: precio, ListPrice: lista, AvailableQuantity: stock } }] }],
});

test('VTEX: sigue vigente con su precio actual; agotada o ya no publicada, no', async () => {
  const oferta = { id: '3280565', url: 'https://www.grid.com.ar/x/p' };
  assert.deepEqual(await verificarEnTienda(oferta, 'grid', { fetchFn: respuesta([productoVtex(3280565, 99999, 199999, 3)]) }), { estado: 'ok', precioActual: 99999 });
  assert.equal((await verificarEnTienda(oferta, 'grid', { fetchFn: respuesta([productoVtex(3280565, 99999, 199999, 0)]) })).estado, 'agotada', 'sin stock');
  assert.equal((await verificarEnTienda(oferta, 'grid', { fetchFn: respuesta([]) })).estado, 'agotada', 'ya no figura (la Cortez de Grid, 2026-11-15)');
  assert.equal((await verificarEnTienda(oferta, 'grid', { fetchFn: respuesta([productoVtex(3280565, 129999, 199999, 3)]) })).precioActual, 129999, 'precio que cambió');
});

test('VTEX: si la tienda no responde, no se pierde la oferta (sin datos)', async () => {
  const oferta = { id: '1', url: 'https://www.grid.com.ar/x/p' };
  assert.equal((await verificarEnTienda(oferta, 'grid', { fetchFn: respuesta({}, { status: 500 }) })).estado, 'sin-datos');
  assert.equal((await verificarEnTienda(oferta, 'grid', { fetchFn: async () => { throw new Error('red'); } })).estado, 'sin-datos');
  assert.equal((await verificarEnTienda(oferta, 'tienda-inexistente', { fetchFn: respuesta([]) })).estado, 'sin-datos');
});

test('SFCC (Moov): sin talles seleccionables = agotada (Superstar, 2026-11-07); con talles, el precio de la página', async () => {
  const v = (id, sel) => `{&quot;id&quot;:&quot;${id}&quot;,&quot;description&quot;:null,&quot;displayValue&quot;:&quot;${id}&quot;,&quot;value&quot;:&quot;${id}&quot;,&quot;selected&quot;:false,&quot;selectable&quot;:${sel},&quot;sku&quot;:&quot;X_${id}&quot;}`;
  const pagina = (talles, precio) => `<html>"price":"${precio}.00" &quot;id&quot;:&quot;size&quot;,&quot;values&quot;:[${talles.join(',')}]}</html>`;
  const oferta = { id: 'ADEG4957', url: 'https://www.moov.com.ar/zapatillas-adidas-superstar/ADEG4957.html' };
  assert.deepEqual(await verificarEnTienda(oferta, 'moov', { fetchFn: respuesta(pagina([v('43.5', true), v('44', false)], 54999), { texto: true }) }), { estado: 'ok', precioActual: 54999 });
  assert.equal((await verificarEnTienda(oferta, 'moov', { fetchFn: respuesta(pagina([v('43.5', false), v('44', false)], 54999), { texto: true }) })).estado, 'agotada');
  assert.equal((await verificarEnTienda(oferta, 'moov', { fetchFn: respuesta('', { status: 404, texto: true }) })).estado, 'agotada', 'página que ya no existe');
});
