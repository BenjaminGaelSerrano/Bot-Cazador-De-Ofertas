import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deListaTiendanube, leerTiendanube } from '../src/fuentes/tiendanube.mjs';
import { deWoo, tallesWoo } from '../src/fuentes/woo.mjs';
import { ErrorFuente } from '../src/nucleo/http.mjs';

const variante = (talle, precio, antes, disponible = true) => ({ product_id: 7, price_number: precio, compare_at_price_number: antes, available: disponible, option0: 'Negro', option1: talle });
const producto = (id, vs, nombre = 'Camisa Royalty') => `<div class="js-item-product col" data-product-id="${id}" data-variants="${JSON.stringify(vs).replace(/"/g, '&quot;')}">
<a href="https://tienda.com/productos/camisa-${id}/?entry_path=category" title="${nombre}"><div class="js-item-name">${nombre}</div></a></div>`;

test('deListaTiendanube: precio, precio anterior, talles disponibles y enlace limpio', () => {
  const [o] = deListaTiendanube(producto(7, [variante('L', 39990, 99990), variante('XL', 39990, 99990, false)]));
  assert.deepEqual([o.nombre, o.url, o.precioActual, o.precioLista, o.talles], ['Camisa Royalty', 'https://tienda.com/productos/camisa-7/', 39990, 99990, ['L']]);
  assert.deepEqual(deListaTiendanube(producto(8, [variante('L', 100, null, false)])), [], 'sin stock no sale');
});

test('leerTiendanube: sigue paginando aunque no haya enlaces, y corta cuando no hay productos nuevos', async () => {
  const pedidas = [];
  const cliente = {
    obtenerTexto: async (url) => {
      pedidas.push(url);
      const n = Number(/page\/(\d+)/.exec(url)?.[1] ?? 1);
      if (n > 3) throw new ErrorFuente('cliente', 'no hay', { status: 404 });
      const v = [{ ...variante('L', 100, 200), product_id: n }];
      return { datos: producto(n, v) };
    },
  };
  const ofertas = await leerTiendanube(cliente, { base: 'https://tienda.com', marca: 'X' });
  assert.equal(ofertas.length, 3);
  assert.equal(pedidas.length, 4);
});

test('deWoo y tallesWoo: precios en centavos, género y stock real por talle', async () => {
  const p = {
    id: 1, name: 'Campera Rip Curl', permalink: 'https://c/p', is_in_stock: true, brands: [{ name: 'Rip Curl' }], categories: [{ name: 'Camperas' }],
    prices: { price: '6999900', regular_price: '14999900', currency_minor_unit: 2 },
    attributes: [{ name: 'Talle', terms: [{ name: 'L' }, { name: 'XL' }] }, { name: 'Género', terms: [{ name: 'Hombre' }] }],
    variations: [{ id: 11, attributes: [{ name: 'Talle', value: 'l' }] }, { id: 12, attributes: [{ name: 'Talle', value: 'xl' }] }],
    description: '<li>100% algodón.</li>',
  };
  const o = deWoo(p);
  assert.deepEqual([o.precioActual, o.precioLista, o.marca, o.composicion, o.genero], [69999, 149999, 'Rip Curl', '100% algodón', undefined]);
  assert.equal(deWoo({ ...p, attributes: [{ name: 'Género', terms: [{ name: 'Nene' }] }] }).genero, 'n');
  const cliente = { obtenerJson: async (url) => ({ datos: { is_in_stock: url.endsWith('/12') } }) };
  assert.deepEqual(await tallesWoo(cliente, o, { base: 'https://c' }), ['XL']);
});
