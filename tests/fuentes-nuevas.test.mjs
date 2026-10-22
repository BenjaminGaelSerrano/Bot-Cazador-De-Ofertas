import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { config } from '../src/config.mjs';
import * as grid from '../src/fuentes/grid.mjs';
import * as newera from '../src/fuentes/newera.mjs';
import * as rouge from '../src/fuentes/rouge.mjs';
import { crearLectorShopify } from '../src/fuentes/shopify.mjs';
import { crearLector } from '../src/fuentes/vtex.mjs';
import { ErrorFuente } from '../src/nucleo/http.mjs';

const fixture = async (nombre) => JSON.parse(await readFile(new URL(`./fixtures/${nombre}`, import.meta.url), 'utf8'));

// ---------- VTEX: agrupar por producto (Grid) ----------

const cfgProducto = {
  base: 'https://tienda.test', maxPorPedido: 50, maxOffset: 2500, agrupar: 'producto',
  categoriasExcluidas: [], categorias: [{ name: 'Todo', ruta: null }],
};
const lectorProducto = crearLector(cfgProducto);

const item = (itemId, name, Price, ListPrice, AvailableQuantity) => ({
  itemId: String(itemId), name, ean: '', sellers: [{ commertialOffer: { Price, ListPrice, AvailableQuantity } }],
});
const producto = (id, items, extra = {}) => ({
  productId: String(id), productName: `BUZO ${id}`, brand: 'Nike', link: `/buzo-${id}/p`, categories: ['/Indumentaria/'], items, ...extra,
});

test('agrupar por producto: cinco talles al mismo precio dan una sola oferta', () => {
  const p = producto(1, [item(1, 'XS', 89999, 89999, 0), item(2, 'S', 89999, 89999, 0), item(3, 'M', 89999, 89999, 1), item(4, 'L', 89999, 89999, 10), item(5, 'XL', 89999, 89999, 3)]);
  const ofertas = lectorProducto.normalizarProducto(p);
  assert.equal(ofertas.length, 1);
  assert.deepEqual(
    [ofertas[0].id, ofertas[0].nombre, ofertas[0].precioActual, ofertas[0].stock, ofertas[0].url],
    ['1', 'BUZO 1', 89999, 14, 'https://tienda.test/buzo-1/p'],
  );
});

test('agrupar por producto: el precio es el del SKU más barato CON stock', () => {
  const p = producto(1, [item(1, 'XS', 100, 100, 0), item(2, 'S', 80, 80, 0), item(3, 'M', 90, 150, 5), item(4, 'L', 120, 120, 5)]);
  const [o] = lectorProducto.normalizarProducto(p);
  assert.equal(o.precioActual, 90, 'el de 80 no tiene stock');
  assert.equal(o.precioLista, 150, 'la lista es la del SKU elegido');
});

test('agrupar por producto: sin ningún stock toma el más barato y queda con stock 0', () => {
  const p = producto(1, [item(1, 'S', 100, 100, 0), item(2, 'M', 80, 80, 0)]);
  const [o] = lectorProducto.normalizarProducto(p);
  assert.equal(o.precioActual, 80);
  assert.equal(o.stock, 0);
});

test('agrupar por producto: ignora SKU inválidos y devuelve vacío si no queda ninguno', () => {
  assert.deepEqual(lectorProducto.normalizarProducto(producto(1, [item(1, 'S', 0, 0, 5), item(2, 'M', 100, 90, 5)])), []);
  const [o] = lectorProducto.normalizarProducto(producto(1, [item(1, 'S', 0, 0, 5), item(2, 'M', 100, 100, 5)]));
  assert.equal(o.precioActual, 100);
});

test('Grid real: una oferta por producto, ids únicos, stock y precios coherentes', async () => {
  const datos = await fixture('grid-pagina.json');
  const ofertas = datos.flatMap((p) => grid.normalizarProducto(p));
  assert.ok(ofertas.length > 0 && ofertas.length <= datos.length);
  assert.equal(new Set(ofertas.map((o) => o.id)).size, ofertas.length);
  for (const o of ofertas) {
    assert.ok(o.precioActual > 0 && o.precioLista >= o.precioActual);
    assert.ok(o.url.startsWith('https://www.grid.com.ar/'));
  }
  const conVariosTalles = datos.filter((p) => p.items.length > 1).length;
  assert.ok(conVariosTalles > 0, 'la fixture trae productos con varios talles');
});

// ---------- VTEX: lectura sin filtro ----------

const crudo = (id) => producto(id, [item(`s${id}`, 'U', 100, 100, 1)]);
const rango = (n) => Array.from({ length: n }, (_, i) => crudo(i + 1));

/** API falsa sin filtro: devuelve el catálogo en páginas y respeta los límites reales. */
function apiSinFiltro(catalogo) {
  const pedidos = [];
  return {
    pedidos,
    cliente: {
      async obtenerJson(urlTexto) {
        pedidos.push(urlTexto);
        const url = new URL(urlTexto);
        const desde = Number(url.searchParams.get('_from'));
        const hasta = Number(url.searchParams.get('_to'));
        assert.ok(hasta - desde <= 49 && desde <= 2500);
        assert.equal(url.searchParams.get('fq'), null, 'sin filtro de categoría');
        const lista = [...catalogo];
        const orden = url.searchParams.get('O');
        if (orden === 'OrderByNameASC') lista.sort((a, b) => a.productName.localeCompare(b.productName));
        if (orden === 'OrderByNameDESC') lista.sort((a, b) => b.productName.localeCompare(a.productName));
        return { datos: lista.slice(desde, hasta + 1), headers: new Map([['resources', `${desde}-${hasta}/${lista.length}`]]) };
      },
    },
  };
}

test('sin filtro: un catálogo que cabe se lee en páginas, sin pedido extra de control', async () => {
  const { cliente, pedidos } = apiSinFiltro(rango(120));
  const { ofertas, informe } = await lectorProducto.leerCatalogo(cliente);
  assert.equal(ofertas.length, 120);
  assert.equal(pedidos.length, 3);
  assert.equal(informe.catalogoTotal, 120);
  assert.equal(informe.sinCubrir, 0);
});

test('sin filtro: más de 2.550 se lee con dos órdenes y queda completo', async () => {
  const { cliente } = apiSinFiltro(rango(3000));
  const { ofertas, informe } = await lectorProducto.leerCatalogo(cliente);
  assert.equal(ofertas.length, 3000);
  assert.deepEqual(informe.truncados, []);
});

test('sin filtro: más de 5.100 informa lo que quedó fuera', async () => {
  const { cliente } = apiSinFiltro(rango(6000));
  const { informe } = await lectorProducto.leerCatalogo(cliente);
  assert.equal(informe.truncados.length, 1);
});

// ---------- Rouge ----------

test('Rouge real: una oferta por SKU (tamaños) con ml, sin gift cards', async () => {
  const datos = await fixture('rouge-pagina.json');
  const ofertas = datos.flatMap((p) => rouge.normalizarProducto(p));
  assert.ok(ofertas.length > datos.length, 'hay más SKU que productos');
  assert.equal(new Set(ofertas.map((o) => o.id)).size, ofertas.length);
  assert.ok(ofertas.some((o) => o.ml !== null));
  assert.ok(ofertas.every((o) => o.categoria !== 'giftcards'));
});

test('Rouge: una gift card se descarta', () => {
  const p = producto(9, [item(90, '50000', 50000, 50000, 99)], { categories: ['/giftcards/'] });
  assert.deepEqual(rouge.normalizarProducto(p), []);
});

// ---------- Shopify (New Era) ----------

const variante = (title, price, compare_at_price, available) => ({ id: 1, title, price, compare_at_price, available });
const gorra = (id, variants, extra = {}) => ({ id, title: `Gorra ${id}`, handle: `gorra-${id}`, vendor: 'New Era', product_type: 'Gorras', variants, ...extra });
const lectorShopify = crearLectorShopify({ base: 'https://gorras.test', porPagina: 2, maxPaginas: 5, categoriasExcluidas: ['Gift Card'] });

test('Shopify: una oferta por producto con el precio de la variante más barata disponible', () => {
  const p = gorra(1, [variante('7', '100.00', null, false), variante('7 1/8', '120.00', '150.00', true), variante('7 1/4', '130.00', null, true)]);
  const [o] = lectorShopify.normalizarProducto(p);
  assert.deepEqual(
    [o.id, o.marca, o.nombre, o.precioActual, o.precioLista, o.stock, o.url],
    ['1', 'New Era', 'Gorra 1', 120, 150, 2, 'https://gorras.test/products/gorra-1'],
  );
});

test('Shopify: compare_at_price menor o igual al precio no cuenta como descuento', () => {
  const [a] = lectorShopify.normalizarProducto(gorra(1, [variante('U', '100.00', '100.00', true)]));
  const [b] = lectorShopify.normalizarProducto(gorra(2, [variante('U', '100.00', '80.00', true)]));
  assert.equal(a.precioLista, 100);
  assert.equal(b.precioLista, 100);
});

test('Shopify: sin variantes disponibles queda con stock 0; precio inválido o gift card se descartan', () => {
  assert.equal(lectorShopify.normalizarProducto(gorra(1, [variante('U', '90.00', null, false)]))[0].stock, 0);
  assert.deepEqual(lectorShopify.normalizarProducto(gorra(2, [variante('U', '0.00', null, true)])), []);
  assert.deepEqual(lectorShopify.normalizarProducto(gorra(3, [variante('U', 'abc', null, true)])), []);
  assert.deepEqual(lectorShopify.normalizarProducto(gorra(4, [variante('U', '5000', null, true)], { product_type: 'Gift Card' })), []);
});

/** Cliente falso de Shopify: devuelve `paginas[n-1]` para `page=n` y una lista vacía después. */
function shopifyFalso(paginas) {
  const pedidos = [];
  return {
    pedidos,
    cliente: {
      async obtenerJson(urlTexto) {
        pedidos.push(urlTexto);
        const n = Number(new URL(urlTexto).searchParams.get('page'));
        return { datos: { products: paginas[n - 1] ?? [] }, headers: new Map() };
      },
    },
  };
}
const g = (id) => gorra(id, [variante('U', '100.00', null, true)]);

test('Shopify: pagina hasta una página incompleta y se ahorra el pedido vacío', async () => {
  const { cliente, pedidos } = shopifyFalso([[g(1), g(2)], [g(3), g(4)], [g(5)]]);
  const { ofertas, informe } = await lectorShopify.leerCatalogo(cliente);
  assert.equal(ofertas.length, 5);
  assert.equal(pedidos.length, 3);
  assert.equal(informe.catalogoTotal, 5);
  assert.deepEqual(informe.truncados, []);
  assert.ok(pedidos[0].includes('limit=2&page=1'));
});

test('Shopify: si la última página viene justa, la siguiente vacía la cierra', async () => {
  const { cliente, pedidos } = shopifyFalso([[g(1), g(2)], [g(3), g(4)]]);
  const { ofertas } = await lectorShopify.leerCatalogo(cliente);
  assert.equal(ofertas.length, 4);
  assert.equal(pedidos.length, 3);
});

test('Shopify: deduplica productos repetidos entre páginas', async () => {
  const { cliente } = shopifyFalso([[g(1), g(2)], [g(2), g(3)], [g(4)]]);
  const { ofertas, informe } = await lectorShopify.leerCatalogo(cliente);
  assert.equal(ofertas.length, 4);
  assert.equal(informe.productosLeidos, 4);
});

test('Shopify: si se alcanza el tope de páginas, lo informa', async () => {
  const lleno = Array.from({ length: 5 }, (_, i) => [g(i * 2 + 1), g(i * 2 + 2)]);
  const { cliente, pedidos } = shopifyFalso(lleno);
  const { informe } = await lectorShopify.leerCatalogo(cliente);
  assert.equal(pedidos.length, 5);
  assert.equal(informe.truncados.length, 1);
});

test('Shopify: respuesta sin lista de productos o catálogo vacío falla', async () => {
  const sinLista = { async obtenerJson() { return { datos: { error: 'x' }, headers: new Map() }; } };
  await assert.rejects(lectorShopify.leerCatalogo(sinLista), (e) => e instanceof ErrorFuente && e.tipo === 'respuesta_invalida');
  await assert.rejects(lectorShopify.leerCatalogo(shopifyFalso([[]]).cliente), (e) => e.tipo === 'respuesta_invalida');
});

test('Shopify: un error del cliente se propaga', async () => {
  const bloqueado = { async obtenerJson() { throw new ErrorFuente('bloqueo', 'x', { status: 429 }); } };
  await assert.rejects(lectorShopify.leerCatalogo(bloqueado), (e) => e.tipo === 'bloqueo');
});

test('New Era real: una oferta por producto, ids únicos, precios coherentes', async () => {
  const { products } = await fixture('newera-productos.json');
  const ofertas = products.flatMap((p) => newera.normalizarProducto(p));
  assert.ok(ofertas.length > 0 && ofertas.length <= products.length);
  assert.equal(new Set(ofertas.map((o) => o.id)).size, ofertas.length);
  for (const o of ofertas) {
    assert.ok(o.precioActual > 0 && o.precioLista >= o.precioActual);
    assert.ok(o.url.startsWith('https://www.newera.com.ar/products/'));
  }
  assert.ok(ofertas.some((o) => o.stock === 0) || ofertas.some((o) => o.stock > 0));
});

// ---------- Configuración ----------

test('configuración: coherente para las tres tiendas nuevas', () => {
  const { grid: g1, rouge: r, newera: n } = config.fuentes;
  assert.equal(g1.agrupar, 'producto');
  assert.deepEqual(g1.categorias, [{ name: 'Catálogo completo', ruta: null }]);
  assert.equal(r.agrupar, 'sku');
  assert.ok(r.categoriasExcluidas.includes('giftcards'));
  assert.ok(r.categorias.every((c) => c.ruta?.startsWith('/')), 'rutas de Rouge con formato /id/');
  assert.ok(n.porPagina <= 250 && n.maxPaginas >= 4);
  assert.ok(config.maxMensajesTotalPorCorrida >= config.maxMensajesPorCorrida);
});

// ---------- Lecturas parciales: un 5xx que persiste no tira toda la lectura (falla real de Rouge, 2026-10-22) ----------

const nodoRouge = (name, ruta) => ({ name, ruta, children: [] });
const cfgRouge = { base: 'https://tienda.test', maxPorPedido: 50, maxOffset: 2500, agrupar: 'sku', categoriasExcluidas: [], categorias: [] };
const crudoRouge = (id) => producto(id, [item(`s${id}`, 'U', 100, 100, 1)], { categories: ['/Perfumes/'] });
const listaRouge = (desde, hasta) => Array.from({ length: hasta - desde + 1 }, (_, i) => crudoRouge(desde + i));

/** API falsa por categoría; `fallar(ruta, desde)` devuelve un error para simular que el sitio responde 500. */
function apiConFallas(catalogo, fallar) {
  return {
    async obtenerJson(urlTexto) {
      const url = new URL(urlTexto);
      const desde = Number(url.searchParams.get('_from'));
      const fq = url.searchParams.get('fq');
      if (!fq) return { datos: [], headers: new Map([['resources', `0-0/${Object.values(catalogo).flat().length}`]]) };
      const ruta = fq.slice(2);
      const error = fallar(ruta, desde);
      if (error) throw error;
      const lista = catalogo[ruta] ?? [];
      return { datos: lista.slice(desde, desde + 50), headers: new Map([['resources', `${desde}-${desde + 49}/${lista.length}`]]) };
    },
  };
}
const servidor500 = () => new ErrorFuente('servidor', 'Error 500 del sitio', { status: 500 });

test('VTEX: un 500 en la última página de una categoría deja la lectura parcial, no la tira', async () => {
  const lector = crearLector({ ...cfgRouge, categorias: [nodoRouge('Perfumes', '/1/'), nodoRouge('Capilares', '/2/')] });
  const cliente = apiConFallas({ '/1/': listaRouge(1, 120), '/2/': listaRouge(1000, 1199) }, (ruta, desde) => (ruta === '/2/' && desde === 150 ? servidor500() : null));
  const { ofertas, informe } = await lector.leerCatalogo(cliente);
  assert.equal(ofertas.length, 120 + 150, 'se conserva todo lo leído, incluida la categoría con falla hasta donde llegó');
  assert.equal(informe.parciales.length, 1);
  assert.deepEqual([informe.parciales[0].categoria, informe.parciales[0].desde], ['Capilares', 150]);
});

test('VTEX: si falla la primera página de una categoría se la saltea y se leen las demás', async () => {
  const lector = crearLector({ ...cfgRouge, categorias: [nodoRouge('Perfumes', '/1/'), nodoRouge('Capilares', '/2/')] });
  const cliente = apiConFallas({ '/1/': listaRouge(1, 60), '/2/': listaRouge(1000, 1010) }, (ruta) => (ruta === '/2/' ? servidor500() : null));
  const { ofertas, informe } = await lector.leerCatalogo(cliente);
  assert.equal(ofertas.length, 60);
  assert.deepEqual(informe.parciales.map((p) => [p.categoria, p.desde]), [['Capilares', 0]]);
});

test('VTEX: un bloqueo (429) sigue cortando toda la lectura', async () => {
  const lector = crearLector({ ...cfgRouge, categorias: [nodoRouge('Perfumes', '/1/'), nodoRouge('Capilares', '/2/')] });
  const cliente = apiConFallas({ '/1/': listaRouge(1, 60), '/2/': listaRouge(1000, 1010) }, (ruta) => (ruta === '/2/' ? new ErrorFuente('bloqueo', 'x', { status: 429 }) : null));
  await assert.rejects(lector.leerCatalogo(cliente), (e) => e.tipo === 'bloqueo');
});

test('VTEX: si no se pudo leer nada, se informa el error real y no una lectura "parcial" vacía', async () => {
  const lector = crearLector({ ...cfgRouge, categorias: [nodoRouge('Perfumes', '/1/')] });
  const cliente = apiConFallas({ '/1/': listaRouge(1, 60) }, () => servidor500());
  await assert.rejects(lector.leerCatalogo(cliente), (e) => e.tipo === 'servidor');
});

test('VTEX: una lectura completa no tiene parciales', async () => {
  const lector = crearLector({ ...cfgRouge, categorias: [nodoRouge('Perfumes', '/1/')] });
  const { informe } = await lector.leerCatalogo(apiConFallas({ '/1/': listaRouge(1, 60) }, () => null));
  assert.deepEqual(informe.parciales, []);
});

test('Shopify: un 5xx en una página intermedia deja lo leído y la lectura parcial', async () => {
  let n = 0;
  const cliente = {
    async obtenerJson() {
      n++;
      if (n === 3) throw servidor500();
      return { datos: { products: [g(n * 10 + 1), g(n * 10 + 2)] }, headers: new Map() };
    },
  };
  const { ofertas, informe } = await lectorShopify.leerCatalogo(cliente);
  assert.equal(ofertas.length, 4);
  assert.deepEqual(informe.parciales.map((p) => p.desde), [3]);
  assert.deepEqual(informe.truncados, []);
});

test('Shopify: si falla ya la primera página, se informa el error', async () => {
  const cliente = { async obtenerJson() { throw servidor500(); } };
  await assert.rejects(lectorShopify.leerCatalogo(cliente), (e) => e.tipo === 'servidor');
});
