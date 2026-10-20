import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerCatalogo } from '../src/fuentes/juleriaque.mjs';
import { ErrorFuente } from '../src/nucleo/http.mjs';

const BASE = 'https://sitio.test';

/** Producto crudo mínimo, con la forma de la API de VTEX. */
const crudo = (id, categoria = 'Fragancias') => ({
  productId: String(id), productName: `PRODUCTO ${id}`, brand: 'MARCA', link: `/producto-${id}/p`,
  categories: [`/${categoria}/`],
  items: [{ itemId: `sku${id}`, name: `Producto ${id} 50 ml`, ean: `ean${id}`,
    sellers: [{ commertialOffer: { Price: 100, ListPrice: 100, AvailableQuantity: 1 } }] }],
});
const rango = (desde, hasta, categoria) => Array.from({ length: hasta - desde + 1 }, (_, i) => crudo(desde + i, categoria));
const nodo = (name, ruta, children = []) => ({ name, ruta, children });

/**
 * API falsa. `catalogo`: { ruta: [productos] }. Impone los límites reales (máximo 50 por pedido y
 * `_from` <= 2500) y soporta el orden por nombre. Sin `fq` responde con el total global.
 */
function apiFalsa(catalogo, { totalGlobal } = {}) {
  const pedidos = [];
  return {
    pedidos,
    cliente: {
      async obtenerJson(urlTexto) {
        const url = new URL(urlTexto);
        pedidos.push(urlTexto);
        const desde = Number(url.searchParams.get('_from'));
        const hasta = Number(url.searchParams.get('_to'));
        assert.ok(hasta - desde <= 49, `pedido de más de 50: ${urlTexto}`);
        assert.ok(desde <= 2500, `_from mayor a 2500: ${urlTexto}`);

        const fq = url.searchParams.get('fq');
        if (!fq) {
          const unicos = new Set(Object.values(catalogo).flat().map((p) => p.productId));
          const total = totalGlobal ?? unicos.size;
          return { datos: [], headers: new Map([['resources', `0-0/${total}`]]) };
        }

        let lista = [...(catalogo[fq.slice(2)] ?? [])];
        const orden = url.searchParams.get('O');
        if (orden === 'OrderByNameASC') lista.sort((a, b) => a.productName.localeCompare(b.productName));
        if (orden === 'OrderByNameDESC') lista.sort((a, b) => b.productName.localeCompare(a.productName));
        return { datos: lista.slice(desde, hasta + 1), headers: new Map([['resources', `${desde}-${hasta}/${lista.length}`]]) };
      },
    },
  };
}

test('categoría chica: se lee completa en páginas de 50', async () => {
  const { cliente, pedidos } = apiFalsa({ '/1/': rango(1, 120) });
  const { ofertas, informe } = await leerCatalogo(cliente, { base: BASE, categorias: [nodo('Fragancias', '/1/')] });
  assert.equal(ofertas.length, 120);
  assert.equal(informe.productosLeidos, 120);
  assert.equal(pedidos.length, 3 + 1); // 3 páginas (50 + 50 + 20) + el control del total global
  assert.deepEqual(informe.truncados, []);
  assert.deepEqual(informe.incompletos, []);
  assert.equal(informe.sinCubrir, 0);
});

test('categoría grande: se subdivide en sus hijas', async () => {
  const todos = rango(1, 3000);
  const categorias = [nodo('Fragancias', '/1/', [nodo('Mujer', '/1/2/'), nodo('Hombre', '/1/3/')])];
  const { cliente } = apiFalsa({ '/1/': todos, '/1/2/': todos.slice(0, 1500), '/1/3/': todos.slice(1500) });
  const { ofertas, informe } = await leerCatalogo(cliente, { base: BASE, categorias });
  assert.equal(ofertas.length, 3000);
  assert.deepEqual(informe.incompletos, []);
  assert.deepEqual(informe.truncados, []);
});

test('subdivisión en varios niveles', async () => {
  const todos = rango(1, 6000);
  const categorias = [nodo('F', '/1/', [nodo('P', '/1/2/', [nodo('A', '/1/2/3/'), nodo('B', '/1/2/4/')]), nodo('L', '/1/5/')])];
  const { cliente } = apiFalsa({
    '/1/': todos, '/1/2/': todos.slice(0, 5000), '/1/2/3/': todos.slice(0, 2500), '/1/2/4/': todos.slice(2500, 5000), '/1/5/': todos.slice(5000),
  });
  const { ofertas, informe } = await leerCatalogo(cliente, { base: BASE, categorias });
  assert.equal(ofertas.length, 6000);
  assert.deepEqual(informe.incompletos, []);
});

test('hoja que supera 2.550 se lee con dos órdenes y queda completa', async () => {
  const { cliente } = apiFalsa({ '/1/': rango(1, 3000) });
  const { ofertas, informe } = await leerCatalogo(cliente, { base: BASE, categorias: [nodo('Fragancias', '/1/')] });
  assert.equal(ofertas.length, 3000);
  assert.deepEqual(informe.truncados, []);
});

test('hoja gigante (más de 5.100): se informa lo que quedó fuera', async () => {
  const { cliente } = apiFalsa({ '/1/': rango(1, 6000) });
  const { ofertas, informe } = await leerCatalogo(cliente, { base: BASE, categorias: [nodo('Fragancias', '/1/')] });
  assert.ok(ofertas.length >= 5000 && ofertas.length < 6000);
  assert.equal(informe.truncados.length, 1);
  assert.equal(informe.truncados[0].total, 6000);
});

test('subdivisión que deja fuera casi nada: no se informa (tolerancia del 1 %)', async () => {
  const todos = rango(1, 3000);
  const categorias = [nodo('Fragancias', '/1/', [nodo('Mujer', '/1/2/')])];
  // la hija tiene todos menos 1, y ese 1 no está en la primera página de la raíz
  const { cliente } = apiFalsa({ '/1/': todos, '/1/2/': todos.slice(0, 2999) });
  const { informe } = await leerCatalogo(cliente, { base: BASE, categorias });
  assert.deepEqual(informe.incompletos, []);
});

test('subdivisión que deja fuera mucho: se informa como incompleta', async () => {
  const todos = rango(1, 3000);
  const categorias = [nodo('Fragancias', '/1/', [nodo('Mujer', '/1/2/')])];
  const { cliente } = apiFalsa({ '/1/': todos, '/1/2/': todos.slice(0, 1000) });
  const { informe } = await leerCatalogo(cliente, { base: BASE, categorias });
  assert.deepEqual(informe.incompletos, [{ categoria: 'Fragancias', esperado: 3000, leido: 1000 }]);
});

test('deduplica SKU de productos presentes en varias categorías', async () => {
  const compartidos = rango(1, 30);
  const categorias = [nodo('Fragancias', '/1/'), nodo('Tratamiento', '/2/')];
  const { cliente } = apiFalsa({ '/1/': compartidos, '/2/': [...compartidos, ...rango(31, 40)] });
  const { ofertas, informe } = await leerCatalogo(cliente, { base: BASE, categorias });
  assert.equal(ofertas.length, 40);
  assert.equal(informe.productosLeidos, 40);
});

test('no recorre las categorías excluidas', async () => {
  const categorias = [nodo('Fragancias', '/1/'), nodo('Testers', '/9/')];
  const { cliente, pedidos } = apiFalsa({ '/1/': rango(1, 10), '/9/': rango(100, 150, 'Testers') });
  const { ofertas } = await leerCatalogo(cliente, { base: BASE, categorias, excluidas: ['Testers'] });
  assert.equal(ofertas.length, 10);
  assert.ok(!pedidos.some((p) => p.includes('%2F9%2F')));
});

test('filtra las ofertas de categorías excluidas que aparecen dentro de otra categoría', async () => {
  const { cliente } = apiFalsa({ '/1/': [crudo(1), crudo(2, 'Testers')] });
  const { ofertas } = await leerCatalogo(cliente, { base: BASE, categorias: [nodo('Fragancias', '/1/')], excluidas: ['Testers'] });
  assert.deepEqual(ofertas.map((o) => o.id), ['sku1']);
});

test('categoría vacía no rompe', async () => {
  const categorias = [nodo('Fragancias', '/1/'), nodo('Vacía', '/2/')];
  const { cliente } = apiFalsa({ '/1/': rango(1, 5) });
  const { ofertas } = await leerCatalogo(cliente, { base: BASE, categorias });
  assert.equal(ofertas.length, 5);
});

test('detecta productos fuera de las categorías configuradas (sinCubrir)', async () => {
  const { cliente } = apiFalsa({ '/1/': rango(1, 100) }, { totalGlobal: 130 });
  const { informe } = await leerCatalogo(cliente, { base: BASE, categorias: [nodo('Fragancias', '/1/')] });
  assert.equal(informe.catalogoTotal, 130);
  assert.equal(informe.sinCubrir, 30);
});

test('si el control del total falla con 429, no se pierde la lectura', async () => {
  const { cliente: base } = apiFalsa({ '/1/': rango(1, 10) });
  const cliente = {
    async obtenerJson(url) {
      if (!new URL(url).searchParams.get('fq')) throw new ErrorFuente('bloqueo', 'bloqueado', { status: 429 });
      return base.obtenerJson(url);
    },
  };
  const { ofertas, informe } = await leerCatalogo(cliente, { base: BASE, categorias: [nodo('Fragancias', '/1/')] });
  assert.equal(ofertas.length, 10);
  assert.equal(informe.catalogoTotal, null);
  assert.equal(informe.sinCubrir, null);
});

test('un catálogo sin ofertas válidas falla en vez de devolver vacío', async () => {
  const { cliente } = apiFalsa({ '/1/': [] });
  await assert.rejects(leerCatalogo(cliente, { base: BASE, categorias: [nodo('Fragancias', '/1/')] }),
    (e) => e instanceof ErrorFuente && e.tipo === 'respuesta_invalida');
});

test('si falta el header con el total, falla', async () => {
  const cliente = { async obtenerJson() { return { datos: [crudo(1)], headers: new Map() }; } };
  await assert.rejects(leerCatalogo(cliente, { base: BASE, categorias: [nodo('Fragancias', '/1/')] }), (e) => e.tipo === 'respuesta_invalida');
});

test('un error del cliente a mitad de camino se propaga (no devuelve datos parciales)', async () => {
  let n = 0;
  const { cliente: bueno } = apiFalsa({ '/1/': rango(1, 200) });
  const cliente = {
    async obtenerJson(url) {
      if (++n === 2) throw new ErrorFuente('bloqueo', 'bloqueado', { status: 429 });
      return bueno.obtenerJson(url);
    },
  };
  await assert.rejects(leerCatalogo(cliente, { base: BASE, categorias: [nodo('Fragancias', '/1/')] }), (e) => e.tipo === 'bloqueo');
});

test('la configuración real cubre las raíces conocidas y respeta los topes de la API', async () => {
  const { config } = await import('../src/config.mjs');
  const nombres = config.fuentes.juleriaque.categorias.map((c) => c.name);
  for (const esperado of ['Fragancias', 'Tratamiento', 'Maquillaje', 'Capilar']) assert.ok(nombres.includes(esperado));
  const premium = config.fuentes.juleriaque.categorias[0].children[1];
  assert.equal(premium.name, 'Premium');
  assert.equal(premium.children.length, 3);
});
