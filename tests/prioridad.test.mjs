import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearHistorial, registrar } from '../src/nucleo/historial.mjs';
import { bajaReal, ordenarParaConsultar, relacionPorMarca } from '../src/nucleo/prioridad.mjs';

const producto = (id, marca, precioActual, precioLista) => ({ id, marca, nombre: `P${id}`, precioActual, precioLista, stock: 1, url: 'u' });

function historialCon(dias) {
  const h = crearHistorial();
  for (const [fecha, productos] of dias) for (const p of productos) registrar(h, p, fecha);
  return h;
}

test('bajaReal: contra el menor precio de los días anteriores, no contra el precio de lista', () => {
  const h = historialCon([
    ['2026-10-25', [producto('1', 'A', 250000, 300000), producto('2', 'A', 150000, 300000)]],
    ['2026-11-02', [producto('1', 'A', 150000, 300000), producto('2', 'A', 150000, 300000)]],
  ]);
  assert.equal(bajaReal(h.productos['1'], 150000, '2026-11-02'), 0.4, 'bajó de 250k a 150k: baja real');
  assert.equal(bajaReal(h.productos['2'], 150000, '2026-11-02'), 0, 'siempre costó 150k: el "-50 %" es falso');
  assert.equal(bajaReal(undefined, 150000, '2026-11-02'), null);
});

test('relacionPorMarca: costo ÷ precio de EE. UU., mediana por marca', () => {
  const r = relacionPorMarca([
    { oferta: { marca: 'Calvin Klein', precioActual: 130000 }, precio: 100000 },
    { oferta: { marca: 'CALVIN KLEIN', precioActual: 150000 }, precio: 100000 },
    { oferta: { marca: 'Viktor&Rolf', precioActual: 70000 }, precio: 100000 },
  ]);
  assert.equal(r.get('calvin klein'), 1.4);
  assert.equal(r.get('viktor rolf'), 0.7);
});

test('ordenarParaConsultar: caché primero; después baja real y marca, no el descuento declarado', async () => {
  const h = historialCon([
    ['2026-10-25', [producto('falso', 'CK', 100000, 200000), producto('real', 'Otra', 200000, 220000), producto('ck2', 'CK', 120000, 240000)]],
    ['2026-11-02', [producto('falso', 'CK', 100000, 200000), producto('real', 'Otra', 120000, 220000), producto('ck2', 'CK', 120000, 240000)]],
  ]);
  const g = (id, marca, actual, descuento) => ({ oferta: { id, marca, precioActual: actual }, evaluacion: { descuento } });
  const gangas = [
    g('falso', 'CK', 100000, 0.5),      // "-50 %" pero siempre costó lo mismo
    g('real', 'Otra', 120000, 0.45),    // bajó de 200k a 120k
    g('nuevo', 'Otra', 50000, 0.6),     // sin días anteriores: cuenta la mitad del descuento (0,3)
    g('ck2', 'CK', 120000, 0.5),        // ya en caché: CK sale 1,5 veces lo de EE. UU.
  ];
  const enCache = async (o) => (o.id === 'ck2' ? { estado: 'ok', precio: 80000 } : null);
  const { orden, relacion } = await ordenarParaConsultar(gangas, { historial: h, fecha: '2026-11-02', enCache });
  assert.deepEqual(orden.map((x) => x.oferta.id), ['ck2', 'real', 'nuevo', 'falso']);
  assert.equal(relacion.get('ck'), 1.5);
  assert.equal(gangas[3].ebay.precio, 80000, 'la cacheada ya queda resuelta');
});

test('puntajeAviso: margen por confianza en las ventas (pedido del usuario, 2026-11-05)', async () => {
  const { puntajeAviso } = await import('../src/nucleo/prioridad.mjs');
  const ofertas = [
    { n: 'The Move', margen: 0.14, ventas: 0 },
    { n: 'Fuel for Life', margen: 0.09, ventas: 174 },
    { n: 'Zuecos', margen: 0.36, ventas: 3 },
    { n: 'Botitas', margen: 0.28, ventas: 26 },
    { n: 'Yeezy', margen: 3.11, ventas: 21 },
  ];
  const orden = ofertas.sort((a, b) => puntajeAviso(b) - puntajeAviso(a)).map((o) => o.n);
  assert.deepEqual(orden, ['Yeezy', 'Botitas', 'Zuecos', 'Fuel for Life', 'The Move']);
  assert.equal(puntajeAviso({ margen: 0.5, ventas: 0 }), 0, 'sin ventas no suma');
  assert.equal(puntajeAviso({ margen: 0.4, ventas: undefined }), 0.2, 'sin dato: confianza media');
});
