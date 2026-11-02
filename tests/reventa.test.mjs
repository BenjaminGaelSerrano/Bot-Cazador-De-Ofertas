import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearHistorial, registrar, serializar } from '../src/nucleo/historial.mjs';
import { nivelDemanda, velocidadVenta } from '../src/nucleo/reventa.mjs';

const oferta = (extra = {}) => ({
  id: '1', ean: '7791234567890', marca: 'DIOR', nombre: 'Sauvage EDP 100 ml', ml: 100, categoria: 'Fragancias',
  precioActual: 100, precioLista: 100, stock: 20, url: 'https://x.test/1', ...extra,
});

/** Historial con el stock indicado día por día: { '2026-10-15': 20, ... }. */
function conStock(serie) {
  const h = crearHistorial();
  for (const [fecha, stock] of Object.entries(serie)) registrar(h, oferta({ stock }), fecha);
  return h.productos['1'];
}

// ---------- Registro del stock ----------

test('stk: un producto nuevo guarda su cantidad', () => {
  assert.deepEqual(conStock({ '2026-10-15': 20 }).stk, [['2026-10-15', 20]]);
});

test('stk: solo se agrega una entrada cuando la cantidad cambia', () => {
  const p = conStock({ '2026-10-15': 20, '2026-10-16': 20, '2026-10-17': 14, '2026-10-18': 14, '2026-10-19': 9 });
  assert.deepEqual(p.stk, [['2026-10-15', 20], ['2026-10-17', 14], ['2026-10-19', 9]]);
});

test('stk: una segunda lectura el mismo día reemplaza a la primera', () => {
  const h = crearHistorial();
  registrar(h, oferta({ stock: 20 }), '2026-10-15');
  registrar(h, oferta({ stock: 17 }), '2026-10-15');
  assert.deepEqual(h.productos['1'].stk, [['2026-10-15', 17]]);
});

test('stk: un producto guardado antes de que existiera el campo lo empieza a llevar', () => {
  const h = crearHistorial();
  registrar(h, oferta(), '2026-10-15');
  delete h.productos['1'].stk; // como quedó en la rama de datos antes de este cambio
  registrar(h, oferta({ stock: 12 }), '2026-10-16');
  assert.deepEqual(h.productos['1'].stk, [['2026-10-16', 12]]);
});

test('stk: viaja en el archivo guardado', () => {
  const h = crearHistorial();
  registrar(h, oferta(), '2026-10-15');
  assert.deepEqual(JSON.parse(serializar(h)).productos['1'].stk, [['2026-10-15', 20]]);
});

// ---------- Velocidad de venta ----------

test('velocidad: el stock que baja se cuenta como vendido, por día', () => {
  const p = conStock({ '2026-10-15': 20, '2026-10-18': 14, '2026-10-21': 8 }); // 12 unidades en 6 días
  const v = velocidadVenta(p, '2026-10-21');
  assert.equal(v.vendidas, 12);
  assert.equal(v.dias, 6);
  assert.equal(v.porDia, 2);
  assert.equal(v.stockActual, 8);
});

test('velocidad: la reposición (stock que sube) no resta ni suma', () => {
  const p = conStock({ '2026-10-15': 10, '2026-10-17': 4, '2026-10-18': 30, '2026-10-20': 24 });
  const v = velocidadVenta(p, '2026-10-20');
  assert.equal(v.vendidas, 6 + 6, 'bajó 6, repuso, y bajó otras 6');
});

test('velocidad: stock constante da cero, que es un dato válido si hay días suficientes', () => {
  const p = conStock({ '2026-10-15': 20, '2026-10-16': 20, '2026-10-19': 20 });
  const v = velocidadVenta(p, '2026-10-19');
  assert.equal(v.porDia, 0);
  assert.equal(v.dias, 4);
});

test('velocidad: con menos de 2 días de datos no se estima', () => {
  assert.equal(velocidadVenta(conStock({ '2026-10-20': 20 }), '2026-10-20'), null);
  assert.equal(velocidadVenta(conStock({ '2026-10-20': 20, '2026-10-21': 18 }), '2026-10-21'), null);
});

test('velocidad: las cantidades de relleno (99999) no se usan', () => {
  const p = conStock({ '2026-10-15': 99999, '2026-10-19': 99999 });
  assert.equal(velocidadVenta(p, '2026-10-19'), null);
  const q = conStock({ '2026-10-15': 50, '2026-10-17': 99999, '2026-10-19': 40 });
  assert.equal(velocidadVenta(q, '2026-10-19'), null, 'un valor de relleno en la ventana invalida la estimación');
});

test('velocidad: solo cuenta la ventana de los últimos 7 días', () => {
  // vendió 20 unidades hace un mes y desde hace 10 días no se mueve
  const p = conStock({ '2026-09-15': 50, '2026-09-20': 30, '2026-10-10': 30, '2026-10-20': 30 });
  const v = velocidadVenta(p, '2026-10-20');
  assert.equal(v.vendidas, 0);
  assert.equal(v.dias, 7);
});

test('velocidad: un producto sin serie de stock devuelve null', () => {
  assert.equal(velocidadVenta({ visto: '2026-10-20' }, '2026-10-20'), null);
  assert.equal(velocidadVenta({ stk: [], visto: '2026-10-20' }, '2026-10-20'), null);
});

test('nivelDemanda: alta, media, baja y sin dato', () => {
  assert.equal(nivelDemanda({ porDia: 2 }), 'alta');
  assert.equal(nivelDemanda({ porDia: 1 }), 'alta');
  assert.equal(nivelDemanda({ porDia: 0.5 }), 'media');
  assert.equal(nivelDemanda({ porDia: 0.1 }), 'baja');
  assert.equal(nivelDemanda({ porDia: 0 }), 'baja');
  assert.equal(nivelDemanda(null), null);
});

// ---------- Puntaje de reventa (parámetros del usuario: Instagram, comisión 0, margen buscado 40 %) ----------

const { puntuar, compararPorReventa } = await import('../src/nucleo/reventa.mjs');
const mercado = (precio, fuente = 'rouge') => ({ precio, fuente });
// Mecánica del cálculo con los parámetros de la spec 003 (40 % de margen revendiendo 5 % bajo el mercado, demanda baja =
// regular). El criterio vigente del usuario (más barato que el mercado de EE. UU.) se prueba aparte, con la config real.
const SPEC_003 = { comision: 0, envio: 0, margenBueno: 0.4, margenRegular: 0.2, descuentoCompetitivo: 0.05, exigirDemanda: true };

test('puntuar: caso real del CK One (compra $143.000, otra tienda lo vende a $286.000) es buena', () => {
  const p = puntuar({ costo: 143000, mercado: mercado(286000) }, SPEC_003);
  assert.equal(p.veredicto, 'buena');
  assert.equal(Math.round(p.precioReventa), 271700, 'se revende un 5 % por debajo del mercado');
  assert.equal(Math.round(p.margen * 100), 90);
  assert.equal(p.fuente, 'rouge');
});

test('puntuar: 40 % de margen exacto es buena, justo debajo es regular', () => {
  // precioReventa = mercado × 0,95; margen = precioReventa / costo − 1
  assert.equal(puntuar({ costo: 100000, mercado: mercado(147368.42105263157) }, SPEC_003).veredicto, 'buena');
  assert.equal(puntuar({ costo: 100000, mercado: mercado(146000) }, SPEC_003).veredicto, 'regular');
});

test('puntuar: 20 % de margen es regular, menos es evitar', () => {
  assert.equal(puntuar({ costo: 100000, mercado: mercado(126315.78947368421) }, SPEC_003).veredicto, 'regular');
  assert.equal(puntuar({ costo: 100000, mercado: mercado(120000) }, SPEC_003).veredicto, 'evitar');
});

test('puntuar: si otra tienda lo vende más barato de lo que lo pagarías, se evita', () => {
  const p = puntuar({ costo: 145000, mercado: mercado(120000) }, SPEC_003);
  assert.equal(p.veredicto, 'evitar');
});

test('puntuar: una demanda baja degrada una "buena" a "regular"; media, alta o sin dato no', () => {
  const base = { costo: 100000, mercado: mercado(200000) };
  assert.equal(puntuar({ ...base, demanda: 'baja' }, SPEC_003).veredicto, 'regular');
  for (const demanda of ['media', 'alta', null]) assert.equal(puntuar({ ...base, demanda }, SPEC_003).veredicto, 'buena', String(demanda));
});

test('puntuar (config real, criterio del 2026-11-02): buena si cuesta menos que el mercado, por poco que sea, con cualquier demanda', () => {
  assert.equal(puntuar({ costo: 100000, mercado: mercado(101000), demanda: 'baja' }).veredicto, 'buena');
  assert.equal(Math.round(puntuar({ costo: 100000, mercado: mercado(101000) }).margen * 100), 1);
  assert.equal(puntuar({ costo: 100000, mercado: mercado(99000) }).veredicto, 'evitar');
  assert.notEqual(puntuar({ costo: 100000, mercado: mercado(100000) }).veredicto, 'buena', 'igual no es más barato: no se avisa');
});

test('puntuar: sin otra tienda que lo venda no se inventa nada', () => {
  const p = puntuar({ costo: 100000, mercado: null }, SPEC_003);
  assert.deepEqual(p, { veredicto: 'sin-referencia', demanda: null });
});

test('puntuar: la comisión y el envío configurables restan al ingreso', () => {
  const cfg = { comision: 0.15, envio: 5000, margenBueno: 0.4, margenRegular: 0.2, descuentoCompetitivo: 0.05 };
  const p = puntuar({ costo: 100000, mercado: mercado(200000) }, cfg);
  // ingreso = 200.000 × 0,95 × 0,85 − 5.000 = 156.500; margen = (156.500 − 100.000) / 100.000
  assert.equal(p.margen.toFixed(3), '0.565');
});

test('compararPorReventa: buenas, luego regulares, luego sin referencia; por margen o descuento dentro de cada grupo', () => {
  const g = (veredicto, margen, descuento) => ({ puntaje: { veredicto, margen }, evaluacion: { descuento } });
  const lista = [g('sin-referencia', undefined, 0.9), g('regular', 0.3, 0.5), g('buena', 0.5, 0.4), g('buena', 0.9, 0.3), g('sin-referencia', undefined, 0.6)];
  const orden = lista.sort(compararPorReventa).map((x) => [x.puntaje.veredicto, x.puntaje.margen ?? x.evaluacion.descuento]);
  assert.deepEqual(orden, [['buena', 0.9], ['buena', 0.5], ['regular', 0.3], ['sin-referencia', 0.9], ['sin-referencia', 0.6]]);
});
