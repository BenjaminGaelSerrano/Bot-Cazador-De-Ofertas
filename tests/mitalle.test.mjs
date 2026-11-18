import assert from 'node:assert/strict';
import { test } from 'node:test';
import { esMiTalle } from '../src/mitalle.mjs';

test('esMiTalle: 44,5 a 46, también en los talles dobles de Dexter', () => {
  for (const t of ['44.5', '45', '45.5', '46', '45-45.5', '44-44.5', '46-46.5', '45,5']) assert.ok(esMiTalle(t), t);
  for (const t of ['44', '43.5', '47', '42-42.5', 'S', 'único', '38-38.5']) assert.ok(!esMiTalle(t), t);
});

test('distanciaKm: Parque Chas a Abasto ronda los 6 km, a Dot Baires menos de 7', async () => {
  const { CASA, distanciaKm } = await import('../src/mitalle.mjs');
  const abasto = { lat: -34.6035, lng: -58.4106 };
  const dot = { lat: -34.5486, lng: -58.4899 };
  const kmAbasto = distanciaKm(CASA, abasto);
  assert.ok(kmAbasto > 5 && kmAbasto < 8, `Abasto ${kmAbasto}`);
  assert.ok(distanciaKm(CASA, dot) < 7);
  assert.equal(distanciaKm(CASA, CASA), 0);
});

test('skusDeMisTalles: código por talle solo de los talles míos con stock', async () => {
  const { skusDeMisTalles } = await import('../src/mitalle.mjs');
  const v = (id, sel, sku) => `{&quot;id&quot;:&quot;${id}&quot;,&quot;description&quot;:null,&quot;displayValue&quot;:&quot;${id}&quot;,&quot;value&quot;:&quot;${id}&quot;,&quot;selected&quot;:false,&quot;selectable&quot;:${sel},&quot;sku&quot;:&quot;${sku}&quot;}`;
  const html = [v('43', true, 'X_10_1'), v('44.5', true, 'X_11.5_1'), v('45', false, 'X_12_1'), v('45-45.5', true, 'X_12_2'), v('46', true, 'X_13_1')].join(',');
  assert.deepEqual(skusDeMisTalles(html), [{ id: '44.5', sku: 'X_11.5_1' }, { id: '45-45.5', sku: 'X_12_2' }, { id: '46', sku: 'X_13_1' }]);
});
