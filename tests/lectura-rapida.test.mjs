import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearLector } from '../src/fuentes/vtex.mjs';
import { anotarCompleta, leerRapido } from '../src/nucleo/lecturas.mjs';

const producto = (id, descuento) => ({
  productId: String(id), productName: `Producto ${id}`, brand: 'X', link: `/p${id}/p`, categories: ['/Fragancias/'],
  items: [{ itemId: String(id), name: `Producto ${id}`, ean: '', sellers: [{ commertialOffer: { Price: 100 * (1 - descuento), ListPrice: 100, AvailableQuantity: 5 } }] }],
});

// Catálogo de 400 productos ordenado por descuento: los primeros 120 tienen 30 %, el resto 0 %.
const CATALOGO = Array.from({ length: 400 }, (_, i) => producto(i, i < 120 ? 0.3 : 0));
function clienteSimulado() {
  const pedidos = [];
  return {
    pedidos,
    obtenerJson: async (url) => {
      pedidos.push(url);
      const u = new URL(url);
      const desde = Number(u.searchParams.get('_from'));
      const hasta = Number(u.searchParams.get('_to'));
      const ordenado = u.searchParams.get('O') === 'OrderByBestDiscountDESC';
      const lista = ordenado ? CATALOGO : [...CATALOGO].reverse(); // sin orden, el catálogo viene mezclado
      const headers = new Map([['resources', `${desde}-${hasta}/${CATALOGO.length}`]]);
      return { datos: lista.slice(desde, hasta + 1), headers };
    },
  };
}
const cfg = { base: 'https://tienda.test', maxPorPedido: 50, maxOffset: 2500, agrupar: 'producto', categoriasExcluidas: [], categorias: [{ name: 'Fragancias', ruta: '/1/' }], toleranciaCobertura: 1 };

test('lectura rápida: pide el catálogo ordenado por descuento y corta tras 3 páginas sin descuento', async () => {
  const cliente = clienteSimulado();
  const { leerCatalogo } = crearLector(cfg);
  const { ofertas, informe } = await leerCatalogo(cliente, { rapido: true, minDescuento: 0.10 });
  assert.equal(ofertas.filter((o) => 1 - o.precioActual / o.precioLista >= 0.1).length, 120, 'trae todas las que tienen descuento');
  assert.ok(cliente.pedidos.every((u) => u.includes('O=OrderByBestDiscountDESC')), 'siempre ordenado por descuento');
  assert.equal(cliente.pedidos.length, 6, '3 páginas con descuento (120 productos: la 3ª mezcla) + 3 sin descuento');
  assert.equal(informe.parcial, true);
  assert.equal(informe.catalogoTotal, null);
});

test('lectura rápida: no corta mientras haya descuento en alguna de las últimas páginas', async () => {
  const mezclado = Array.from({ length: 300 }, (_, i) => producto(i, i === 120 ? 0.4 : i < 100 ? 0.3 : 0)); // uno suelto en la 3ª
  const adaptado = { obtenerJson: async (u) => { const x = new URL(u); return { datos: mezclado.slice(Number(x.searchParams.get('_from')), Number(x.searchParams.get('_to')) + 1), headers: new Map() }; } };
  const { leerCatalogo } = crearLector(cfg);
  const { ofertas } = await leerCatalogo(adaptado, { rapido: true, minDescuento: 0.10 });
  assert.ok(ofertas.some((o) => o.id === '120'), 'el suelto de la 3ª página se lee');
});

test('lecturas: rápida solo si hoy ya hubo una completa de esa tienda; no cuenta si quedó algo parcial', () => {
  const lecturas = { grid: '2026-11-18' };
  assert.equal(leerRapido(lecturas, 'grid', '2026-11-18'), true);
  assert.equal(leerRapido(lecturas, 'grid', '2026-11-19'), false, 'día nuevo: completa');
  assert.equal(leerRapido(lecturas, 'dash', '2026-11-18'), false, 'esa tienda todavía no la tuvo');
  assert.equal(leerRapido(lecturas, 'grid', '2026-11-18', { forzarCompleta: true }), false);
  assert.equal(anotarCompleta(lecturas, 'dash', '2026-11-18', { parciales: [{ categoria: 'x' }] }), false);
  assert.equal(lecturas.dash, undefined);
  assert.equal(anotarCompleta(lecturas, 'dash', '2026-11-18', { parciales: [], truncados: [] }), true);
  assert.equal(lecturas.dash, '2026-11-18');
});
