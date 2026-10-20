import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { diasEntre, hoyArgentina, sumarDias } from '../src/nucleo/fechas.mjs';
import {
  cargar, crearHistorial, diasObservado, guardar, minimoPrevio, observacionEn, registrar, serializar,
} from '../src/nucleo/historial.mjs';

const producto = (extra = {}) => ({
  id: '18121', ean: '769915195941', marca: 'THE ORDINARY', nombre: 'Niacinamide 10% + Zinc 1%', ml: 30,
  categoria: 'Tratamiento', url: 'https://x.test/p', precioActual: 24100, precioLista: 24100, stock: 5, ...extra,
});

test('fechas: suma, diferencia y hoy en Buenos Aires', () => {
  assert.equal(sumarDias('2026-10-31', 1), '2026-11-01');
  assert.equal(sumarDias('2026-03-01', -1), '2026-02-28');
  assert.equal(diasEntre('2026-10-01', '2026-10-31'), 30);
  // 01:00 UTC del 21 todavía es 22:00 del 20 en Argentina (UTC-3)
  assert.equal(hoyArgentina(new Date('2026-10-21T01:00:00Z')), '2026-10-20');
});

test('registrar: producto nuevo', () => {
  const h = crearHistorial();
  assert.equal(registrar(h, producto(), '2026-10-01'), 'nuevo');
  assert.deepEqual(h.productos['18121'].obs, [['2026-10-01', 24100, 24100]]);
  assert.equal(h.productos['18121'].stock, 1);
});

test('registrar: mismo precio otro día no agrega observación', () => {
  const h = crearHistorial();
  registrar(h, producto(), '2026-10-01');
  assert.equal(registrar(h, producto(), '2026-10-02'), 'igual');
  assert.equal(h.productos['18121'].obs.length, 1);
  assert.equal(h.productos['18121'].visto, '2026-10-02');
});

test('registrar: cambio de precio o de lista agrega observación', () => {
  const h = crearHistorial();
  registrar(h, producto(), '2026-10-01');
  assert.equal(registrar(h, producto({ precioActual: 18000 }), '2026-10-02'), 'cambio');
  assert.equal(registrar(h, producto({ precioActual: 18000, precioLista: 30000 }), '2026-10-03'), 'cambio');
  assert.equal(h.productos['18121'].obs.length, 3);
});

test('registrar: varias lecturas el mismo día conservan el precio más bajo', () => {
  const h = crearHistorial();
  registrar(h, producto({ precioActual: 20000 }), '2026-10-01');
  assert.equal(registrar(h, producto({ precioActual: 15000 }), '2026-10-01'), 'cambio');
  assert.equal(registrar(h, producto({ precioActual: 22000 }), '2026-10-01'), 'igual');
  assert.deepEqual(h.productos['18121'].obs, [['2026-10-01', 15000, 24100]]);
});

test('registrar: sin stock queda marcado', () => {
  const h = crearHistorial();
  registrar(h, producto({ stock: 0 }), '2026-10-01');
  assert.equal(h.productos['18121'].stock, 0);
});

test('observacionEn: devuelve la vigente o null antes de la primera', () => {
  const h = crearHistorial();
  registrar(h, producto({ precioActual: 100 }), '2026-10-10');
  registrar(h, producto({ precioActual: 80 }), '2026-10-20');
  const p = h.productos['18121'];
  assert.equal(observacionEn(p, '2026-10-09'), null);
  assert.equal(observacionEn(p, '2026-10-15')[1], 100);
  assert.equal(observacionEn(p, '2026-10-20')[1], 80);
});

test('minimoPrevio: no cuenta el día de hoy', () => {
  const h = crearHistorial();
  registrar(h, producto({ precioActual: 100 }), '2026-10-01');
  registrar(h, producto({ precioActual: 60 }), '2026-10-20');
  assert.equal(minimoPrevio(h.productos['18121'], '2026-10-20', 30), 100);
});

test('minimoPrevio: toma el precio vigente al inicio de la ventana', () => {
  const h = crearHistorial();
  registrar(h, producto({ precioActual: 70 }), '2026-08-01'); // vigente hasta el 10/09
  registrar(h, producto({ precioActual: 100 }), '2026-09-10');
  // ventana del 20/09 al 19/10: el precio fue 100 todo el tiempo
  assert.equal(minimoPrevio(h.productos['18121'], '2026-10-20', 30), 100);
  // ventana del 01/09 al 30/09: incluye el 70 vigente hasta el 09/09
  assert.equal(minimoPrevio(h.productos['18121'], '2026-10-01', 30), 70);
});

test('minimoPrevio: toma el mínimo dentro de la ventana', () => {
  const h = crearHistorial();
  registrar(h, producto({ precioActual: 100 }), '2026-10-01');
  registrar(h, producto({ precioActual: 85 }), '2026-10-05');
  registrar(h, producto({ precioActual: 95 }), '2026-10-12');
  assert.equal(minimoPrevio(h.productos['18121'], '2026-10-20', 30), 85);
});

test('minimoPrevio: null si no hay datos en la ventana', () => {
  const h = crearHistorial();
  registrar(h, producto(), '2026-10-20');
  assert.equal(minimoPrevio(h.productos['18121'], '2026-10-20', 30), null);
});

test('diasObservado: cuenta desde la primera observación', () => {
  const h = crearHistorial();
  registrar(h, producto(), '2026-09-20');
  assert.equal(diasObservado(h.productos['18121'], '2026-10-20'), 30);
});

test('serializar: JSON válido con un producto por línea', () => {
  const h = crearHistorial();
  registrar(h, producto({ id: '1' }), '2026-10-01');
  registrar(h, producto({ id: '2' }), '2026-10-01');
  const texto = serializar(h);
  assert.deepEqual(JSON.parse(texto), h);
  assert.equal(texto.split('\n').length, 5); // apertura, 2 productos, cierre, salto final
});

test('serializar: historial vacío sigue siendo JSON válido', () => {
  assert.deepEqual(JSON.parse(serializar(crearHistorial())), crearHistorial());
});

test('guardar y cargar: ida y vuelta, y archivo inexistente empieza vacío', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cazador-'));
  const ruta = join(dir, 'datos', 'historial.json');
  assert.deepEqual(await cargar(ruta), crearHistorial());

  const h = crearHistorial();
  registrar(h, producto(), '2026-10-01');
  await guardar(ruta, h);
  assert.deepEqual(await cargar(ruta), h);
  assert.ok((await readFile(ruta, 'utf8')).endsWith('\n'));
});

test('cargar: un archivo roto falla en vez de reemplazarse por uno vacío', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cazador-'));
  const ruta = join(dir, 'historial.json');
  await writeFile(ruta, '{"schema":1,"productos":{ roto');
  await assert.rejects(cargar(ruta), SyntaxError);
});

test('cargar: versión de esquema desconocida falla', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cazador-'));
  const ruta = join(dir, 'historial.json');
  await writeFile(ruta, '{"schema":9,"productos":{}}');
  await assert.rejects(cargar(ruta), /Versión de historial desconocida/);
});
