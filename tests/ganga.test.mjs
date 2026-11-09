import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cargarAlertas, debeAvisar, guardarAlertas, limpiar, marcarAvisada } from '../src/nucleo/alertas.mjs';
import { evaluar } from '../src/nucleo/ganga.mjs';
import { config } from '../src/config.mjs';
import { crearHistorial, registrar } from '../src/nucleo/historial.mjs';
import { formatearOferta, pesos } from '../src/notificar/formato.mjs';

const oferta = (extra = {}) => ({
  id: '10', ean: '1', marca: 'DIOR', nombre: 'Sauvage EDP 100 ml', ml: 100, categoria: 'Fragancias',
  precioActual: 100000, precioLista: 100000, stock: 3, url: 'https://x.test/p', ...extra,
});

/** Historial con el precio indicado desde `desde` (30+ días antes de 2026-10-20 por defecto). */
function conHistorial(precio, desde = '2026-08-01') {
  const h = crearHistorial();
  registrar(h, oferta({ precioActual: precio, precioLista: precio }), desde);
  return h.productos['10'];
}

const HOY = '2026-10-20';

test('sin stock nunca es ganga', () => {
  assert.equal(evaluar(oferta({ precioActual: 10, precioLista: 100, stock: 0 }), undefined, HOY), null);
});

test('sin historial: usa el descuento declarado por el sitio', () => {
  const g = evaluar(oferta({ precioActual: 65000, precioLista: 100000 }), undefined, HOY);
  assert.equal(g.tipo, 'sin-historial');
  assert.equal(g.base, 100000);
  assert.equal(Math.round(g.descuento * 100), 35);
});

test('sin historial: justo 30 % califica, 29 % no', () => {
  assert.ok(evaluar(oferta({ precioActual: 70000, precioLista: 100000 }), undefined, HOY, { cfg: { ...config, descuentoMinimo: 0.30 } }));
  assert.equal(evaluar(oferta({ precioActual: 71000, precioLista: 100000 }), undefined, HOY, { cfg: { ...config, descuentoMinimo: 0.30 } }), null);
});

test('sin historial: sin descuento declarado no califica', () => {
  assert.equal(evaluar(oferta(), undefined, HOY), null);
});

test('con 30+ días de historial: compara contra el mínimo previo', () => {
  const registro = conHistorial(100000);
  const g = evaluar(oferta({ precioActual: 60000, precioLista: 100000 }), registro, HOY);
  assert.equal(g.tipo, 'historial');
  assert.equal(g.base, 100000);
  assert.equal(Math.round(g.descuento * 100), 40);
});

test('con historial: un "descuento" que el sitio declara pero que no es real no califica', () => {
  // el precio fue 50000 durante dos meses; la lista inflada de 100000 no cuenta
  const registro = conHistorial(50000);
  assert.equal(evaluar(oferta({ precioActual: 50000, precioLista: 100000 }), registro, HOY), null);
});

test('con historial: si ya estaba barato antes, bajar poco no califica', () => {
  const registro = conHistorial(80000);
  assert.equal(evaluar(oferta({ precioActual: 70000, precioLista: 150000 }), registro, HOY, { cfg: { ...config, descuentoMinimo: 0.30 } }), null);
});

test('menos de 30 días de historial: vuelve a la regla del sitio', () => {
  const registro = conHistorial(100000, '2026-10-10');
  const g = evaluar(oferta({ precioActual: 60000, precioLista: 100000 }), registro, HOY);
  assert.equal(g.tipo, 'sin-historial');
});

test('referencia internacional: si el precio la supera, no es ganga', () => {
  const o = oferta({ precioActual: 60000, precioLista: 100000 });
  assert.equal(evaluar(o, undefined, HOY, { referencia: 50000 }), null);
  const g = evaluar(o, undefined, HOY, { referencia: 80000 });
  assert.equal(g.referencia, 80000);
});

test('alertas: avisar la primera vez, no repetir, y volver a avisar con otra baja del 10 %', () => {
  const estado = {};
  assert.equal(debeAvisar(estado, 'j:10', 60000), true);
  marcarAvisada(estado, 'j:10', 60000, HOY);
  assert.equal(debeAvisar(estado, 'j:10', 60000), false);
  assert.equal(debeAvisar(estado, 'j:10', 55000), false); // -8 %
  assert.equal(debeAvisar(estado, 'j:10', 54000), true);  // -10 %
});

test('alertas.limpiar: olvida lo que dejó de ser ganga pero conserva sin stock y no vistos', () => {
  const estado = { 'j:1': { precio: 1 }, 'j:2': { precio: 1 }, 'j:3': { precio: 1 }, 'j:4': { precio: 1 } };
  limpiar(estado, {
    vistos: new Set(['j:1', 'j:2', 'j:3']),
    sinStock: new Set(['j:2']),
    gangasAhora: new Set(['j:3']),
  });
  // j:1 volvió a precio normal -> se olvida; j:2 sin stock -> se conserva; j:3 sigue en ganga; j:4 no apareció hoy
  assert.deepEqual(Object.keys(estado).sort(), ['j:2', 'j:3', 'j:4']);
});

test('alertas: archivo inexistente es vacío y uno roto falla', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'cazador-'));
  assert.deepEqual(await cargarAlertas(join(dir, 'no.json')), {});
  await guardarAlertas(join(dir, 'a.json'), { 'j:1': { precio: 5, fecha: HOY } });
  assert.deepEqual(await cargarAlertas(join(dir, 'a.json')), { 'j:1': { precio: 5, fecha: HOY } });
  await writeFile(join(dir, 'roto.json'), '{ roto');
  await assert.rejects(cargarAlertas(join(dir, 'roto.json')), SyntaxError);
});

test('formato: pesos argentinos y línea de WhatsApp', () => {
  assert.equal(pesos(185000), '$185.000');
  assert.equal(pesos(380005.22), '$380.005');
  const o = oferta({ precioActual: 65000 });
  const sinHist = formatearOferta(o, { tipo: 'sin-historial', descuento: 0.35, base: 100000, referencia: null });
  assert.equal(sinHist, 'DIOR Sauvage EDP 100 ml\n$65.000 · -35% vs lista $100.000\nhttps://x.test/p');
  const hist = formatearOferta(o, { tipo: 'historial', descuento: 0.4, base: 108000, referencia: 90000 });
  assert.match(hist, /-40% vs mín\. 30 días \$108\.000 · ref\. intl \$90\.000/);
});

test('formato: no repite la marca si el nombre ya la trae', () => {
  const o = oferta({ nombre: 'Dior Sauvage EDP 100 ml' });
  assert.ok(formatearOferta(o, { tipo: 'sin-historial', descuento: 0.3, base: 1, referencia: null }).startsWith('Dior Sauvage'));
});

test('formato: tampoco la repite si el nombre la menciona en el medio', () => {
  const o = oferta({ marca: 'Nike Sportswear', nombre: 'ZAPATILLAS NIKE SPORTSWEAR KILLSHOT 2 HOMBRE' });
  const linea = formatearOferta(o, { tipo: 'sin-historial', descuento: 0.3, base: 1, referencia: null });
  assert.ok(linea.startsWith('ZAPATILLAS NIKE SPORTSWEAR KILLSHOT 2 HOMBRE\n'));
});

test('formato: el nombre largo se recorta pero el link nunca', () => {
  const url = 'https://www.perfumeriasrouge.com/clean-reserve-limpiador-equilibrante-buriti-x80543100000/p';
  const o = oferta({ nombre: 'Clean Beauty Collective Clean Reserve Limpiador equilibrante buriti 146 ml', marca: 'Clean', url });
  const [nombre, , linkLinea] = formatearOferta(o, { tipo: 'sin-historial', descuento: 0.65, base: 1, referencia: null }).split('\n');
  assert.ok(nombre.length <= 60 && nombre.endsWith('...'));
  assert.equal(linkLinea, url, 'el link va entero en su propia línea');
});

test('formato: ninguna línea empieza con "N." (WhatsApp la convertiría en lista numerada)', async () => {
  const { agrupar } = await import('../src/notificar/callmebot.mjs');
  const { mensajes } = agrupar([1, 2, 3].map((n) => ({ texto: `Nombre ${n}\n$1 · -50%\nhttps://x.test/${n}` })), { titulo: 'T' });
  for (const linea of mensajes.join('\n').split('\n')) assert.ok(!/^\d+\.\s/.test(linea), `línea con formato de lista: ${linea}`);
});

test('formato: la línea de reventa va antes del link y dice mercado, margen y veredicto', () => {
  const puntaje = { veredicto: 'buena', margen: 0.9, precioMercado: 286000, fuente: 'rouge', demanda: 'alta' };
  const [nombre, precio, mercado, link] = formatearOferta(oferta({ precioActual: 143000 }), { tipo: 'sin-historial', descuento: 0.5, base: 286000, referencia: null }, { puntaje }).split('\n');
  assert.ok(nombre && precio);
  assert.equal(mercado, 'Mercado $286.000 (Rouge) · margen 90% · BUENA · demanda alta');
  assert.equal(link, 'https://x.test/p');
});

test('formato: sin otra tienda dice "sin referencia" y nombra bien a New Era', () => {
  const ev = { tipo: 'sin-historial', descuento: 0.5, base: 2, referencia: null };
  assert.ok(formatearOferta(oferta(), ev, { puntaje: { veredicto: 'sin-referencia' } }).includes('\nSin referencia de otra tienda · quedan 3\n'));
  const relleno = formatearOferta(oferta({ stock: 99999 }), ev, { puntaje: { veredicto: 'sin-referencia' } });
  assert.ok(relleno.includes('\nSin referencia de otra tienda\n'), 'un stock de relleno (99999) no se muestra como cantidad');
  const p = { veredicto: 'regular', margen: 0.25, precioMercado: 100000, fuente: 'newera', demanda: null };
  assert.ok(formatearOferta(oferta(), ev, { puntaje: p }).includes('(New Era) · margen 25% · REGULAR\n'));
});

test('formato: el cruce por modelo se marca con "~" y el de código de barras no', () => {
  const ev = { tipo: 'sin-historial', descuento: 0.5, base: 2, referencia: null };
  const base = { veredicto: 'buena', margen: 0.9, precioMercado: 259999, fuente: 'moov', demanda: null };
  assert.ok(formatearOferta(oferta(), ev, { puntaje: { ...base, via: 'modelo' } }).includes('Mercado ~$259.999 (Moov)'));
  assert.ok(formatearOferta(oferta(), ev, { puntaje: { ...base, via: 'ean' } }).includes('Mercado $259.999 (Moov)'));
  assert.ok(formatearOferta(oferta(), ev, { puntaje: { ...base, via: 'nombre' } }).includes('Mercado $259.999 (Moov)'));
});
