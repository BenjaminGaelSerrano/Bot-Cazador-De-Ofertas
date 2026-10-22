import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { config } from '../src/config.mjs';
import { crearLectorMagento } from '../src/fuentes/magento.mjs';
import * as parfumerie from '../src/fuentes/parfumerie.mjs';
import { ErrorFuente } from '../src/nucleo/http.mjs';
import { crearHistorial, registrar } from '../src/nucleo/historial.mjs';
import { claveNombre, construirIndice, precioMercado } from '../src/nucleo/mercado.mjs';
import { formatearOferta } from '../src/notificar/formato.mjs';

const fixture = async (n) => JSON.parse(await readFile(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const listado = await fixture('parfumerie-listado.json');
const atributos = (await fixture('parfumerie-atributos.json')).products;

const cfg = { base: 'https://tienda.test', categoriaId: '2', porPagina: 10, maxPaginas: 50, maxProductosAtributos: 1500, loteAtributos: 25 };
const lector = crearLectorMagento(cfg);

const precio = (final, regular = final) => ({ minimum_price: { regular_price: { value: regular }, final_price: { value: final } } });
const simple = (sku, name, final, regular, extra = {}) => ({
  __typename: 'SimpleProduct', sku, name, url_key: `${name.toLowerCase().replace(/\W+/g, '-')}-${sku.toLowerCase()}`, url_suffix: '',
  stock_status: 'IN_STOCK', only_x_left_in_stock: null, price_range: precio(final, regular), ...extra,
});
const configurable = (sku, name, variantes) => ({
  __typename: 'ConfigurableProduct', sku, name, url_key: name.toLowerCase().replace(/\W+/g, '-'), url_suffix: '',
  stock_status: 'IN_STOCK', only_x_left_in_stock: null, price_range: precio(1),
  variants: variantes.map(([vsku, vname, final, regular, extra]) => ({ product: { sku: vsku, name: vname, stock_status: 'IN_STOCK', only_x_left_in_stock: null, price_range: precio(final, regular), ...extra } })),
});

// ---------- Normalización ----------

test('simple: precio final como actual, regular como lista, link por url_key, ml del nombre', () => {
  const [o] = lector.normalizarProducto(simple('RP1', 'SAUVAGE EDT 100ML', 164000, 267605));
  assert.deepEqual(
    [o.id, o.productoId, o.nombre, o.ml, o.precioActual, o.precioLista, o.moneda, o.url, o.ean, o.marca, o.attrs],
    ['RP1', 'RP1', 'SAUVAGE EDT 100ML', 100, 164000, 267605, 'ARS', 'https://tienda.test/sauvage-edt-100ml-rp1', null, '', false],
  );
});

test('si el precio regular fuera menor que el final, la lista se iguala al final', () => {
  const [o] = lector.normalizarProducto(simple('RP1', 'X 50ML', 100, 80));
  assert.equal(o.precioLista, 100);
});

test('configurable: una oferta por variante, cada una con su precio y tamaño, todas con el link del padre', () => {
  const p = configurable('RP2', 'SAUVAGE EDT', [['RV1', 'SAUVAGE EDT 60ML', 269300, 269300], ['RV2', 'SAUVAGE EDT 100ML', 306700, 400000], ['RV3', 'SAUVAGE EDT 200ML', 451300, 451300]]);
  const ofertas = lector.normalizarProducto(p);
  assert.deepEqual(ofertas.map((o) => [o.id, o.ml, o.precioActual, o.precioLista]), [['RV1', 60, 269300, 269300], ['RV2', 100, 306700, 400000], ['RV3', 200, 451300, 451300]]);
  assert.ok(ofertas.every((o) => o.productoId === 'RP2' && o.url === 'https://tienda.test/sauvage-edt'));
});

test('stock: la cantidad real si el sitio la informa, 0 si está agotado, un marcador si hay sin dato', () => {
  const [con] = lector.normalizarProducto(simple('A', 'X 50ML', 10, 10, { only_x_left_in_stock: 3 }));
  const [sin] = lector.normalizarProducto(simple('B', 'X 50ML', 10, 10));
  const [agotado] = lector.normalizarProducto(simple('C', 'X 50ML', 10, 10, { stock_status: 'OUT_OF_STOCK' }));
  assert.deepEqual([con.stock, sin.stock, agotado.stock], [3, 99999, 0]);
});

test('una unidad sin precio válido se descarta', () => {
  assert.deepEqual(lector.normalizarProducto(simple('A', 'X 50ML', 0, 0)), []);
  assert.deepEqual(lector.normalizarProducto(simple('A', 'X 50ML', null, null)), []);
});

test('con atributos conocidos, la oferta lleva ean, marca y la marca de "atributos pedidos"', () => {
  const [o] = lector.normalizarProducto(simple('RP1', 'SAUVAGE EDT 100ML', 10, 10), { saber: () => ({ ean: '3348901471534', marca: 'DIOR', completo: true }) });
  assert.deepEqual([o.ean, o.marca, o.attrs], ['3348901471534', 'DIOR', true]);
});

test('fixture real: ofertas válidas y los configurables apuntan al padre', () => {
  const ofertas = listado.items.flatMap((p) => parfumerie.normalizarProducto(p));
  assert.ok(ofertas.length >= listado.items.length);
  for (const o of ofertas) {
    assert.ok(o.precioActual > 0 && o.precioLista >= o.precioActual);
    assert.ok(o.url.startsWith('https://www.parfumerie.com.ar/'));
  }
  const padre = listado.items.find((i) => i.variants);
  const hijas = ofertas.filter((o) => o.productoId === padre.sku);
  assert.equal(hijas.length, padre.variants.length);
  assert.ok(hijas.every((o) => o.url === `https://www.parfumerie.com.ar/${padre.url_key}${padre.url_suffix ?? ''}`));
});

// ---------- Lectura ----------

/** API GraphQL falsa: lista paginada y consulta de atributos por SKU. Registra cada consulta recibida. */
function graphqlFalso({ productos, atributosPorSku = {}, fallar = () => null }) {
  const consultas = [];
  return {
    consultas,
    cliente: {
      async obtenerJson(url, { cuerpo } = {}) {
        assert.ok(url.endsWith('/graphql'));
        const q = cuerpo.query;
        consultas.push(q);
        const error = fallar(q);
        if (error) throw error;
        if (q.includes('category_id')) {
          const pagina = Number(/currentPage:(\d+)/.exec(q)[1]);
          const tam = Number(/pageSize:(\d+)/.exec(q)[1]);
          const items = productos.slice((pagina - 1) * tam, pagina * tam);
          return { datos: { data: { products: { total_count: productos.length, page_info: { total_pages: Math.ceil(productos.length / tam) }, items } } } };
        }
        const skus = JSON.parse(/sku:\{in:(\[.*?\])\}/.exec(q)[1]);
        const items = skus.filter((s) => atributosPorSku[s]).map((s) => atributosPorSku[s]);
        return { datos: { data: { products: { items } } } };
      },
    },
  };
}
const atr = (sku, gtin, marca) => ({ sku, custom_attributesV2: { items: [
  { code: 'mgs_brand', selected_options: [{ label: marca }] }, ...(gtin ? [{ code: 'gtin', value: gtin }] : []),
] } });

test('lee todas las páginas y deduplica por SKU', async () => {
  const productos = Array.from({ length: 25 }, (_, i) => simple(`S${i}`, `PRODUCTO ${i} 50ML`, 100, 100));
  productos.push(productos[3]); // un producto que se repite entre páginas
  const { cliente, consultas } = graphqlFalso({ productos });
  const { ofertas, informe } = await lector.leerCatalogo(cliente);
  assert.equal(ofertas.length, 25);
  assert.equal(informe.productosLeidos, 25);
  assert.equal(informe.catalogoTotal, 26);
  assert.equal(consultas.filter((q) => q.includes('category_id')).length, 3, 'páginas de 10 sobre 26 productos');
});

test('los atributos se piden solo de lo desconocido, y se reutilizan los del historial', async () => {
  const productos = [simple('K1', 'CONOCIDO 100ML', 10, 10), simple('N1', 'NUEVO UNO 100ML', 10, 10), simple('N2', 'NUEVO DOS 100ML', 10, 10)];
  const h = crearHistorial();
  registrar(h, { id: 'K1', ean: '7790000000017', marca: 'DIOR', nombre: 'CONOCIDO 100ML', ml: 100, categoria: null, precioActual: 10, precioLista: 10, stock: 1, url: 'u', attrs: true }, '2026-10-21');
  const { cliente, consultas } = graphqlFalso({ productos, atributosPorSku: { N1: atr('N1', '8433982029905', 'BENETTON'), N2: atr('N2', null, 'ARMAF') } });
  const { ofertas, informe } = await lector.leerCatalogo(cliente, { historial: h });

  const pedidos = consultas.filter((q) => q.includes('sku:{in:'));
  assert.equal(pedidos.length, 1);
  assert.ok(pedidos[0].includes('"N1"') && pedidos[0].includes('"N2"') && !pedidos[0].includes('"K1"'), 'K1 ya se conocía');
  const por = Object.fromEntries(ofertas.map((o) => [o.id, o]));
  assert.deepEqual([por.K1.ean, por.K1.marca], ['7790000000017', 'DIOR']);
  assert.deepEqual([por.N1.ean, por.N1.marca, por.N1.attrs], ['8433982029905', 'BENETTON', true]);
  assert.deepEqual([por.N2.ean, por.N2.marca, por.N2.attrs], [null, 'ARMAF', true], 'sin gtin: marca igual, y no se vuelve a pedir');
  assert.equal(informe.enriquecidos, 2);
  assert.equal(informe.sinAtributos, 0);
});

test('un producto sin gtin ya consultado no se vuelve a pedir en la corrida siguiente', async () => {
  const productos = [simple('N2', 'NUEVO DOS 100ML', 10, 10)];
  const h = crearHistorial();
  const api = graphqlFalso({ productos, atributosPorSku: { N2: atr('N2', null, 'ARMAF') } });
  const primera = await lector.leerCatalogo(api.cliente, { historial: h });
  for (const o of primera.ofertas) registrar(h, o, '2026-10-21');
  assert.equal(h.productos.N2.attrs, 1);

  const api2 = graphqlFalso({ productos });
  await lector.leerCatalogo(api2.cliente, { historial: h });
  assert.equal(api2.consultas.filter((q) => q.includes('sku:{in:')).length, 0);
});

test('el tope por corrida limita los atributos y el resto sigue en la corrida siguiente', async () => {
  const productos = Array.from({ length: 10 }, (_, i) => simple(`S${i}`, `PRODUCTO ${i} 50ML`, 10, 10));
  const atributosPorSku = Object.fromEntries(productos.map((p) => [p.sku, atr(p.sku, `77900000000${String(10 + Number(p.sku.slice(1)))}`, 'MARCA')]));
  const chico = crearLectorMagento({ ...cfg, maxProductosAtributos: 4, loteAtributos: 2 });
  const h = crearHistorial();

  const api = graphqlFalso({ productos, atributosPorSku });
  const r1 = await chico.leerCatalogo(api.cliente, { historial: h });
  assert.equal(r1.informe.enriquecidos, 4);
  assert.equal(r1.informe.sinAtributos, 6);
  assert.equal(api.consultas.filter((q) => q.includes('sku:{in:')).length, 2, 'dos lotes de 2');
  assert.equal(r1.ofertas.length, 10, 'todos se leen igual, con o sin atributos');
  for (const o of r1.ofertas) registrar(h, o, '2026-10-21');

  const r2 = await chico.leerCatalogo(graphqlFalso({ productos, atributosPorSku }).cliente, { historial: h });
  assert.equal(r2.informe.enriquecidos, 4);
  assert.equal(r2.informe.sinAtributos, 2);
});

test('los hijos de un configurable se enriquecen a través del padre', async () => {
  const productos = [configurable('RP2', 'SAUVAGE EDT', [['RV1', 'SAUVAGE EDT 60ML', 10, 10], ['RV2', 'SAUVAGE EDT 100ML', 20, 20]])];
  const respuestaPadre = { sku: 'RP2', custom_attributesV2: { items: [] }, variants: [{ product: atr('RV1', '3348901471527', 'DIOR') }, { product: atr('RV2', '3348901471534', 'DIOR') }] };
  const { cliente } = graphqlFalso({ productos, atributosPorSku: { RP2: respuestaPadre } });
  const { ofertas } = await lector.leerCatalogo(cliente);
  assert.deepEqual(ofertas.map((o) => [o.id, o.ean, o.marca]), [['RV1', '3348901471527', 'DIOR'], ['RV2', '3348901471534', 'DIOR']]);
});

test('un gtin que no son 8 a 14 dígitos se descarta en vez de usarse', async () => {
  const productos = [simple('S1', 'PRODUCTO UNO 50ML', 10, 10)];
  const { cliente } = graphqlFalso({ productos, atributosPorSku: { S1: atr('S1', 'N/A', 'MARCA') } });
  const { ofertas } = await lector.leerCatalogo(cliente);
  assert.equal(ofertas[0].ean, null);
});

test('el pedido de atributos es un POST con la consulta sin descripciones', async () => {
  const productos = [simple('S1', 'PRODUCTO UNO 50ML', 10, 10)];
  const { cliente, consultas } = graphqlFalso({ productos, atributosPorSku: { S1: atr('S1', '7790000000017', 'M') } });
  await lector.leerCatalogo(cliente);
  const q = consultas.find((c) => c.includes('sku:{in:'));
  assert.ok(q.includes('is_wysiwyg_enabled:false'));
  assert.ok(q.includes('gtin') === false, 'se piden todos los atributos filtrados y se elige gtin al leer');
});

// ---------- Errores y lecturas parciales ----------

test('un errors de GraphQL es una respuesta inválida, no datos', async () => {
  const cliente = { async obtenerJson() { return { datos: { errors: [{ message: 'Syntax Error' }] } }; } };
  await assert.rejects(lector.leerCatalogo(cliente), (e) => e instanceof ErrorFuente && e.tipo === 'respuesta_invalida' && /Syntax Error/.test(e.message));
});

test('una página de la lista que falla deja la lectura parcial y se conserva lo leído', async () => {
  const productos = Array.from({ length: 30 }, (_, i) => simple(`S${i}`, `PRODUCTO ${i} 50ML`, 10, 10));
  const { cliente } = graphqlFalso({ productos, fallar: (q) => (q.includes('currentPage:3') ? new ErrorFuente('servidor', 'Error 500', { status: 500 }) : null) });
  const { ofertas, informe } = await lector.leerCatalogo(cliente);
  assert.equal(ofertas.length, 20);
  assert.deepEqual(informe.parciales.map((p) => [p.categoria, p.desde]), [['catálogo', 20]]);
});

test('si falla la consulta de atributos, las ofertas salen igual sin ellos y queda parcial', async () => {
  const productos = [simple('S1', 'PRODUCTO UNO 50ML', 10, 10)];
  const { cliente } = graphqlFalso({ productos, fallar: (q) => (q.includes('sku:{in:') ? new ErrorFuente('servidor', 'Error 500', { status: 500 }) : null) });
  const { ofertas, informe } = await lector.leerCatalogo(cliente);
  assert.equal(ofertas.length, 1);
  assert.equal(ofertas[0].ean, null);
  assert.deepEqual(informe.parciales.map((p) => p.categoria), ['atributos']);
});

test('un bloqueo (429) corta todo; si no se pudo leer nada se informa el error real', async () => {
  const bloqueado = { async obtenerJson() { throw new ErrorFuente('bloqueo', 'x', { status: 429 }); } };
  await assert.rejects(lector.leerCatalogo(bloqueado), (e) => e.tipo === 'bloqueo');
  const caido = { async obtenerJson() { throw new ErrorFuente('servidor', 'Error 500', { status: 500 }); } };
  await assert.rejects(lector.leerCatalogo(caido), (e) => e.tipo === 'servidor');
});

test('un catálogo vacío falla en vez de devolver cero ofertas', async () => {
  await assert.rejects(lector.leerCatalogo(graphqlFalso({ productos: [] }).cliente), (e) => e.tipo === 'respuesta_invalida');
});

// ---------- Integración con el resto ----------

test('una oferta sin marca (todavía sin atributos) se muestra bien y no rompe el cruce', () => {
  const [o] = lector.normalizarProducto(simple('S1', 'SAUVAGE EDT 100ML', 164000, 267605));
  const texto = formatearOferta(o, { tipo: 'sin-historial', descuento: 0.39, base: 267605, referencia: null });
  assert.ok(texto.startsWith('SAUVAGE EDT 100ML\n'));
  assert.equal(claveNombre(o), null, 'sin marca no hay clave por nombre');
});

test('Parfumerie compite con las demás: su precio por EAN fija el mercado de otra tienda', () => {
  const h = crearHistorial();
  registrar(h, { id: 'RV2', ean: '3348901471534', marca: 'DIOR', nombre: 'SAUVAGE EDT 100ML', ml: 100, categoria: null, precioActual: 250000, precioLista: 306700, stock: 5, url: 'u' }, '2026-10-22');
  const indice = construirIndice({ parfumerie: h }, '2026-10-22');
  const m = precioMercado(indice, { ean: '3348901471534', marca: 'DIOR', nombre: 'Sauvage EDT 100 ml', ml: 100, precioActual: 150000 }, 'juleriaque');
  assert.deepEqual([m.precio, m.fuente], [250000, 'parfumerie']);
});

test('configuración de Parfumerie coherente con el API', () => {
  const c = config.fuentes.parfumerie;
  assert.equal(c.categoriaId, '2');
  assert.ok(c.porPagina <= 300, 'Magento no deja páginas de más de 300');
  assert.ok(c.maxProductosAtributos >= c.loteAtributos);
  assert.ok(c.maxPaginas * c.porPagina >= 6357, 'alcanza para todo el catálogo');
});

// ---------- Variantes que también figuran como productos sueltos (dato real de Parfumerie) ----------

test('fixture real: una variante que también es producto simple se registra una sola vez y gana el link propio', async () => {
  const { cliente } = graphqlFalso({ productos: listado.items });
  const { ofertas } = await lector.leerCatalogo(cliente);
  assert.equal(new Set(ofertas.map((o) => o.id)).size, ofertas.length, 'cada SKU una sola vez');

  const suelto = listado.items.find((i) => i.sku === 'RV166709'); // figura como simple y como variante del RP166711
  assert.ok(suelto, 'la fixture trae el caso real');
  const o = ofertas.find((x) => x.id === 'RV166709');
  assert.equal(o.url, `https://tienda.test/${suelto.url_key}`, 'el link del simple, no el del padre');
});

test('si el configurable llega después del simple, igual gana el simple', async () => {
  const hijo = simple('RV9', 'X EDP 30ML', 100, 100);
  const padre = configurable('RP9', 'X EDP', [['RV9', 'X EDP 30ML', 100, 100], ['RV10', 'X EDP 50ML', 150, 150]]);
  const { cliente } = graphqlFalso({ productos: [hijo, padre] });
  const { ofertas } = await lector.leerCatalogo(cliente);
  assert.equal(ofertas.length, 2);
  assert.equal(ofertas.find((o) => o.id === 'RV9').url, `https://tienda.test/${hijo.url_key}`);
  assert.equal(ofertas.find((o) => o.id === 'RV10').url, 'https://tienda.test/x-edp', 'la que no figura suelta apunta al padre');
});

// ---------- Productos que el sitio no devuelve (los "fantasmas" de la prueba real) ----------

test('un producto que el sitio no devuelve se marca como consultado y no se vuelve a pedir', async () => {
  const productos = [simple('V1', 'VISIBLE UNO 50ML', 10, 10), simple('F1', 'FANTASMA UNO 50ML', 10, 10)];
  const h = crearHistorial();
  const api = graphqlFalso({ productos, atributosPorSku: { V1: atr('V1', '7790000000017', 'MARCA') } }); // F1 no vuelve
  const r1 = await lector.leerCatalogo(api.cliente, { historial: h });
  assert.deepEqual([r1.informe.enriquecidos, r1.informe.sinRespuesta], [1, 1]);
  const fantasma = r1.ofertas.find((o) => o.id === 'F1');
  assert.deepEqual([fantasma.ean, fantasma.marca, fantasma.attrs], [null, '', true], 'sin datos, pero marcado como consultado');
  for (const o of r1.ofertas) registrar(h, o, '2026-10-22');

  const api2 = graphqlFalso({ productos });
  const r2 = await lector.leerCatalogo(api2.cliente, { historial: h });
  assert.equal(api2.consultas.filter((q) => q.includes('sku:{in:')).length, 0, 'ya no se pide ni V1 ni F1');
  assert.equal(r2.informe.sinAtributos, 0);
});

test('si la consulta de atributos falla, los productos NO se marcan como consultados (se reintentan)', async () => {
  const productos = [simple('S1', 'PRODUCTO UNO 50ML', 10, 10)];
  const { cliente } = graphqlFalso({ productos, fallar: (q) => (q.includes('sku:{in:') ? new ErrorFuente('servidor', 'Error 500', { status: 500 }) : null) });
  const { ofertas, informe } = await lector.leerCatalogo(cliente);
  assert.equal(ofertas[0].attrs, false);
  assert.equal(informe.sinRespuesta, 0);
});
