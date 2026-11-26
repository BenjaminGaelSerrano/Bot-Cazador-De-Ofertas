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

test('Magento: lista con precio anterior y talles a la venta de la ficha', async () => {
  const { deListaMagento, tallesDeFichaMagento } = await import('../src/fuentes/magento-html.mjs');
  const item = (n, final, antes) => `<div class="product-item-info" id="x"><a class="product-item-link" href="https://t/${n}.html"> Campera ${n} </a>
<span data-price-amount="${final}" data-price-type="finalPrice"></span>${antes ? `<span data-price-amount="${antes}" data-price-type="oldPrice"></span>` : ''}</div>`;
  assert.deepEqual(deListaMagento(item('a', 100, 200) + item('b', 100)).map((o) => [o.nombre, o.precioActual, o.precioLista]), [['Campera a', 100, 200]]);
  const ficha = '"jsonConfig": {"attributes":{"148":{"id":"148","code":"talle_indumentaria","label":"Talle","options":[{"id":"1","label":"M","products":[]},{"id":"2","label":"L","products":["9"]},{"id":"3","label":"XL","products":["10"]}],"position":"0"}}}';
  assert.deepEqual(tallesDeFichaMagento(ficha), ['L', 'XL']);
  assert.deepEqual(tallesDeFichaMagento('<p>sin talles</p>'), ['único']);
});

test('Tiendanube sin data-variants: precio de la lista y talles de la ficha', async () => {
  const { tallesDeFichaTiendanube } = await import('../src/fuentes/tiendanube.mjs');
  const [o] = deListaTiendanube('<div class="js-item-product" data-product-id="5"><a href="https://t/productos/buzo/"><div class="js-item-name">Buzo</div></a><span class="js-price-display" data-product-price="7350000">$73.500</span><span class="js-compare-price-display">$105.000,00</span></div>');
  assert.deepEqual([o.precioActual, o.precioLista, o.faltanTalles], [73500, 105000, true]);
  assert.deepEqual(tallesDeFichaTiendanube('LS.variants = [{"available":true,"option0":"L"},{"available":false,"option0":"XL"}];'), ['L']);
});

test('calzado en numeración de EE. UU. y botines de chicos', async () => {
  const { tallesUtiles, esParaHombre } = await import('../src/nucleo/locales.mjs');
  assert.deepEqual(tallesUtiles(['9', '10', '11', '12'], 'calzado'), ['11', '12']);
  assert.equal(tallesUtiles(['8', '10'], 'calzado'), null);
  assert.ok(!esParaHombre({ nombre: 'Botines Adidas F50 League FG/MF Jr' }));
});

test('VTEX: el talle puede venir como "TALLE" (Equus); sin eso se leía el color', async () => {
  const { tallesDe } = await import('../src/fuentes/vtex.mjs');
  const item = (talle, stock) => ({ name: 'AZUL', TALLE: [talle], sellers: [{ commertialOffer: { AvailableQuantity: stock } }] });
  assert.deepEqual(tallesDe([item('L', 3), item('XL', 0)]).map((t) => t.t), ['L']);
});

test('lectores propios: Kevingston, PrestaShop y Rotten Future', async () => {
  const { deKevingston, dePrestashop, deRotten, tallesKevingston } = await import('../src/fuentes/propias.mjs');
  const k = deKevingston({ sku: 'A1', nombre: 'Campera X', url: '/producto/A1_x', precio: '164900.00', precio_real: '196000.00', stock: '48' }, 'https://k');
  assert.deepEqual([k.precioActual, k.precioLista, k.url], [164900, 196000, 'https://k/producto/A1_x']);
  assert.equal(deKevingston({ sku: 'A2', precio: '1', stock: '0' }, 'https://k'), null);
  const cliente = { obtenerJson: async () => ({ datos: { data: [{ size_nombre: 'L', stock: '2' }, { size_nombre: 'XL', stock: '0' }] } }) };
  assert.deepEqual(await tallesKevingston(cliente, k, { base: 'https://k' }), ['L']);
  const p = dePrestashop({ id_product: '5', name: 'Polo', url: 'https://b/polos/5-polo.html#/26-talle-xl', price_amount: 100, regular_price_amount: 200 });
  assert.deepEqual([p.url, p.precioActual, p.precioLista], ['https://b/polos/5-polo.html', 100, 200]);
  const pagina = String.raw`{\"id\":9,\"handle\":\"buzo-x\",\"name\":\"BUZO X\",\"variants\":[{\"id\":1,\"price\":100,\"compareAtPrice\":200,\"available\":true,\"options\":[\"L\"]},{\"id\":2,\"price\":100,\"compareAtPrice\":null,\"available\":false,\"options\":[\"XL\"]}]}`;
  const [r] = deRotten(pagina, 'https://r');
  assert.deepEqual([r.nombre, r.url, r.precioActual, r.precioLista, r.talles], ['BUZO X', 'https://r/producto/buzo-x', 100, 200, ['L']]);
});
