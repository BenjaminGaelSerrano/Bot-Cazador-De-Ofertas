import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { crearHistorial, registrar } from '../src/nucleo/historial.mjs';
import { cargarOtros, claveNombre, construirIndice, eanValido, precioMercado } from '../src/nucleo/mercado.mjs';

const HOY = '2026-10-22';
const producto = (extra = {}) => ({
  id: '1', ean: '7791234567890', marca: 'CALVIN KLEIN', nombre: 'CK One EDT 200 ml', ml: 200, categoria: 'Fragancias',
  precioActual: 286000, precioLista: 286000, stock: 5, url: 'https://x.test/p', ...extra,
});

/** Historial de una tienda con los productos indicados, vistos en `fecha`. */
function tienda(productos, fecha = HOY) {
  const h = crearHistorial();
  for (const p of productos) registrar(h, p, fecha);
  return h;
}

// ---------- EAN y claves ----------

test('eanValido: acepta códigos reales y rechaza rellenos', () => {
  assert.equal(eanValido('7791234567890'), true);
  assert.equal(eanValido('769915195941'), true);
  for (const malo of ['', null, undefined, '0000000000000', '1111111111111', '12345', 'abc12345678', '77912345678901234']) {
    assert.equal(eanValido(malo), false, String(malo));
  }
});

test('claveNombre: no depende de mayúsculas, acentos, la marca repetida ni el "100 ml" del nombre', () => {
  const a = claveNombre({ marca: 'L´OREAL PARIS', nombre: 'Elvive Dream Lengths 200 ml', ml: 200 });
  const b = claveNombre({ marca: "L'Oréal Paris", nombre: "L'Oréal Paris Elvive Dream Lengths", ml: 200 });
  assert.ok(a);
  assert.equal(a, b);
});

test('claveNombre: sin tamaño o sin nombre útil no hay clave (la coincidencia sería dudosa)', () => {
  assert.equal(claveNombre({ marca: 'DIOR', nombre: 'Sauvage', ml: null }), null);
  assert.equal(claveNombre({ marca: 'DIOR', nombre: 'DIOR 100 ml', ml: 100 }), null);
});

test('claveNombre: EDP y EDT son productos distintos', () => {
  const edp = claveNombre({ marca: 'DIOR', nombre: 'Sauvage EDP 100 ml', ml: 100 });
  const edt = claveNombre({ marca: 'DIOR', nombre: 'Sauvage EDT 100 ml', ml: 100 });
  assert.notEqual(edp, edt);
});

test('claveNombre: distinto tamaño, distinta clave', () => {
  assert.notEqual(claveNombre({ marca: 'DIOR', nombre: 'Sauvage EDP 50 ml', ml: 50 }), claveNombre({ marca: 'DIOR', nombre: 'Sauvage EDP 100 ml', ml: 100 }));
});

// ---------- Índice y precio de mercado ----------

test('precioMercado: toma el precio de otra tienda con el mismo EAN', () => {
  const rouge = tienda([producto({ id: 'r1', precioActual: 286000 })]);
  const indice = construirIndice({ rouge }, HOY);
  const m = precioMercado(indice, producto({ id: 'j1', precioActual: 143000 }), 'juleriaque');
  assert.deepEqual([m.precio, m.fuente, m.via], [286000, 'rouge', 'ean']);
});

test('precioMercado: con varias tiendas, el precio de mercado es el menor', () => {
  const rouge = tienda([producto({ id: 'r1', precioActual: 286000 })]);
  const grid = tienda([producto({ id: 'g1', precioActual: 250000 })]);
  const indice = construirIndice({ rouge, grid }, HOY);
  const m = precioMercado(indice, producto({ precioActual: 143000 }), 'juleriaque');
  assert.deepEqual([m.precio, m.fuente], [250000, 'grid']);
});

test('precioMercado: nunca se compara con la propia tienda', () => {
  const juleriaque = tienda([producto({ id: 'j1', precioActual: 143000 })]);
  const indice = construirIndice({ juleriaque }, HOY);
  assert.equal(precioMercado(indice, producto({ precioActual: 143000 }), 'juleriaque'), null);
});

test('precioMercado: sin otra tienda que lo venda devuelve null, no un número inventado', () => {
  const rouge = tienda([producto({ ean: '7790000000017', precioActual: 10 })]);
  const indice = construirIndice({ rouge }, HOY);
  assert.equal(precioMercado(indice, producto({ ean: '7799999999990' }), 'juleriaque'), null);
});

test('indice: no cuenta productos sin stock ni vistos hace más de 3 días', () => {
  const sinStock = tienda([producto({ id: 'r1', stock: 0 })]);
  assert.equal(precioMercado(construirIndice({ rouge: sinStock }, HOY), producto(), 'juleriaque'), null);

  const viejo = tienda([producto({ id: 'r1' })], '2026-10-15');
  assert.equal(precioMercado(construirIndice({ rouge: viejo }, HOY), producto(), 'juleriaque'), null);

  const reciente = tienda([producto({ id: 'r1' })], '2026-10-20');
  assert.ok(precioMercado(construirIndice({ rouge: reciente }, HOY), producto(), 'juleriaque'), 'hace 2 días sí vale');
});

test('precioMercado: descarta precios ajenos absurdamente bajos (otro formato del producto)', () => {
  const rouge = tienda([producto({ id: 'r1', precioActual: 20000 })]); // un mini de 5 ml con el mismo EAN de relleno
  const indice = construirIndice({ rouge }, HOY);
  assert.equal(precioMercado(indice, producto({ precioActual: 143000 }), 'juleriaque'), null);
});

test('indice: un EAN que se repite en muchos productos de una tienda es un relleno y se ignora', () => {
  const rouge = tienda(Array.from({ length: 8 }, (_, i) => producto({ id: `r${i}`, nombre: `Producto distinto ${i} 50 ml`, ml: 50 })));
  const indice = construirIndice({ rouge }, HOY);
  assert.equal(precioMercado(indice, producto({ nombre: 'Otra cosa 30 ml', ml: 30 }), 'juleriaque'), null);
});

test('precioMercado: sin EAN empareja por marca + tamaño + nombre', () => {
  const rouge = tienda([producto({ id: 'r1', ean: null, marca: 'Calvin Klein', nombre: 'CK One EDT 200 ml', precioActual: 286000 })]);
  const indice = construirIndice({ rouge }, HOY);
  const m = precioMercado(indice, producto({ ean: null, precioActual: 143000 }), 'juleriaque');
  assert.deepEqual([m.precio, m.via], [286000, 'nombre']);
});

test('precioMercado: si coincide por EAN no se mira el nombre', () => {
  const rouge = tienda([
    producto({ id: 'r1', precioActual: 286000 }),
    producto({ id: 'r2', ean: '7790000000024', precioActual: 180000 }), // mismo nombre, otro EAN: no se mezcla
  ]);
  const indice = construirIndice({ rouge }, HOY);
  assert.equal(precioMercado(indice, producto({ precioActual: 143000 }), 'juleriaque').precio, 286000);
});

test('precioMercado: el mismo nombre con distinto tamaño no empareja', () => {
  const rouge = tienda([producto({ id: 'r1', ean: null, nombre: 'CK One EDT 100 ml', ml: 100, precioActual: 200000 })]);
  const indice = construirIndice({ rouge }, HOY);
  assert.equal(precioMercado(indice, producto({ ean: null, precioActual: 143000 }), 'juleriaque'), null);
});

// ---------- Carga de las otras tiendas ----------

test('cargarOtros: lee las que existen, saltea la propia y las que aún no tienen archivo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cazador-'));
  for (const f of ['rouge', 'grid']) {
    await mkdir(join(dir, f), { recursive: true });
    await writeFile(join(dir, f, 'historial.json'), JSON.stringify(tienda([producto({ id: f })])));
  }
  const otros = await cargarOtros(dir, 'grid', ['juleriaque', 'grid', 'rouge', 'newera']);
  assert.deepEqual(Object.keys(otros), ['rouge']);
});

test('cargarOtros: un historial roto falla en vez de ignorarse', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cazador-'));
  await mkdir(join(dir, 'rouge'), { recursive: true });
  await writeFile(join(dir, 'rouge', 'historial.json'), '{ roto');
  await assert.rejects(cargarOtros(dir, 'juleriaque', ['rouge']), SyntaxError);
});
