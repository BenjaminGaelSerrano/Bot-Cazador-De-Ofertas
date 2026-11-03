import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { crearUpcitemdb, precioDeOfertas } from '../src/nucleo/upcitemdb.mjs';

// Respuesta real de UPCitemdb para One Million EDT 100 ml (3349666007921), bajada el 2026-11-02.
const REAL = JSON.parse(await readFile(new URL('./fixtures/upcitemdb-one-million.json', import.meta.url), 'utf8'));
const AHORA = Math.floor(Date.parse('2026-11-02T22:00:00Z') / 1000);

test('precioDeOfertas (datos reales): solo ofertas recientes en dólares; mediana de las 3 más baratas', () => {
  const r = precioDeOfertas(REAL.items[0].offers, AHORA, { diasOferta: 120, tomar: 3 });
  // Recientes en USD: Target 60,99 · UnbeatableSale 87,31 · Kohl's 126 · Bloomingdale's 126. Fuera: Fragrancex (GBP),
  // StrawberryNET (RUB) y todo lo de 2015 a 2025.
  assert.equal(r.usd, 87.31);
  assert.equal(r.n, 4);
  assert.deepEqual(r.tiendas, ['Target', 'UnbeatableSale.com', "Kohl's"]);
});

test('precioDeOfertas: sin ofertas recientes no hay precio', () => {
  assert.equal(precioDeOfertas(REAL.items[0].offers, AHORA + 400 * 86400, { diasOferta: 120, tomar: 3 }), null);
  assert.equal(precioDeOfertas([], AHORA), null);
});

const cfg = { vigenciaDias: 7, diasOferta: 120, tomarMasBaratas: 3, maxConsultasPorCorrida: 2, pausaMs: 0 };
const oferta = { id: '1', ean: '3349666007921', nombre: 'One Million EDT 100 ml' };

function fetchSimulado(estado = 200, cuerpo = REAL) {
  const pedidos = [];
  return { pedidos, fetchFn: async (url) => { pedidos.push(url); return { status: estado, ok: estado === 200, json: async () => cuerpo }; } };
}

test('servicio: convierte a pesos, guarda en caché y no consulta lo que no tiene código de barras', async () => {
  const { fetchFn, pedidos } = fetchSimulado();
  const s = crearUpcitemdb({ dolar: 1555, hoy: '2026-11-02', rutaCache: 'x', fetchFn, cfg, ahora: () => AHORA, log: () => {} });
  const r = await s.precio(oferta);
  assert.equal(r.estado, 'ok');
  assert.equal(r.precio, Math.round(87.31 * 1555));
  assert.ok(pedidos[0].includes('upc=3349666007921'));
  await s.precio(oferta);
  assert.equal(pedidos.length, 1, 'del caché');
  assert.deepEqual(await s.precio({ id: 'NICW2288-111', ean: null, nombre: 'Air Force 1' }), { estado: 'sin' });
  assert.equal(pedidos.length, 1);
});

test('servicio: el límite diario (429) corta la corrida y deja pendiente; el cupo propio también', async () => {
  const bloqueado = fetchSimulado(429);
  const s = crearUpcitemdb({ dolar: 1555, hoy: '2026-11-02', rutaCache: 'x', fetchFn: bloqueado.fetchFn, cfg, ahora: () => AHORA, log: () => {} });
  assert.deepEqual(await s.precio(oferta), { estado: 'pendiente' });
  assert.deepEqual(await s.precio({ ...oferta, ean: '3605521172525' }), { estado: 'pendiente' });
  assert.equal(bloqueado.pedidos.length, 1);
  assert.ok(s.corte);

  const ok = fetchSimulado();
  const c = crearUpcitemdb({ dolar: 1555, hoy: '2026-11-02', rutaCache: 'x', fetchFn: ok.fetchFn, cfg: { ...cfg, maxConsultasPorCorrida: 1 }, ahora: () => AHORA, log: () => {} });
  await c.precio(oferta);
  assert.deepEqual(await c.precio({ ...oferta, ean: '3605521172525' }), { estado: 'pendiente' });
});

test('ofertasDe: por código de modelo solo cuentan los ítems con ese código; se descartan los de chicos y las repetidas', async () => {
  const { ofertasDe } = await import('../src/nucleo/upcitemdb.mjs');
  const items = [
    { title: "Nike Air Force 1 07 Mens Style : Cw2288-111", model: '5670735', offers: [{ merchant: "Bloomingdale's", price: 115 }] },
    { title: "Nike Air Force 1 07 Mens Style : Cw2288-111", model: '5670737', offers: [{ merchant: "Bloomingdale's", price: 115 }] },
    { title: 'Nike Air Force 1 Low GS White', model: 'DH2920-111', offers: [{ merchant: 'Kids Store', price: 90 }] },
    { title: 'Nike Air Force 1 Shadow', model: 'CI0919-100', offers: [{ merchant: 'Otra', price: 130 }] },
  ];
  const porCodigo = ofertasDe(items, { via: 'codigo', params: { q: 'nike CW2288-111' } });
  assert.deepEqual(porCodigo.map((o) => o.price), [115], 'el código coincide sin importar guiones ni mayúsculas, sin repetidas');
  const porNombre = ofertasDe(items, { via: 'nombre', params: { q: 'nike air force 1 mens' } });
  assert.deepEqual(porNombre.map((o) => o.price).sort(), [115, 130], 'el GS (de chicos) no cuenta');
});

test('servicio: con buscarPorNombre en false, Grid (sin códigos) no gasta cupo', async () => {
  const pedidos = [];
  const fetchFn = async (url) => { pedidos.push(url); return { status: 200, ok: true, json: async () => ({ items: [] }) }; };
  const s = crearUpcitemdb({ dolar: 1555, hoy: '2026-11-03', rutaCache: 'x', fetchFn, cfg: { ...cfg, buscarPorNombre: false }, ahora: () => AHORA, log: () => {} });
  const zapatilla = { id: '2329', marca: 'Adidas Originals', nombre: 'ZAPATILLAS ADIDAS ORIGINALS SAMBA OG', km: 'adidas|og samba', gen: 'h' };
  assert.deepEqual(await s.precio(zapatilla, 'grid'), { estado: 'sin' });
  assert.equal(pedidos.length, 0);
  await s.precio({ id: 'NICW2288-111', marca: 'Nike', nombre: 'Air Force 1', km: 'nike|1 air force' }, 'moov');
  assert.ok(pedidos[0].includes('search?s=nike%20CW2288-111'), 'Moov sí, por código');
});
