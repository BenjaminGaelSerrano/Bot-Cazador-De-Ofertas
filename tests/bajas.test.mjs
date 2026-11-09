import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bajaHabitual, tramos } from '../src/bajas.mjs';

test('tramos: las filas que solo cambian el precio de lista se funden', () => {
  assert.deepEqual(tramos([['2026-10-21', 160, 160], ['2026-10-26', 120, 160], ['2026-11-01', 120, 200]]),
    [{ desde: '2026-10-21', precio: 160 }, { desde: '2026-10-26', precio: 120 }]);
});

test('bajaHabitual: contra el precio en el que estuvo la mayor parte del tiempo, no contra la lista', () => {
  const obs = [['2026-10-22', 200, 200], ['2026-10-28', 100, 200]];
  const b = bajaHabitual(obs, '2026-11-09');
  assert.equal(b.habitual, 200);
  assert.equal(b.baja, 0.5);
  assert.equal(b.desde, '2026-10-28');
  assert.equal(b.diasPrevios, 6);
});

test('bajaHabitual: sin historia previa suficiente o si el precio no bajó, no hay baja real', () => {
  assert.equal(bajaHabitual([['2026-11-07', 200, 200], ['2026-11-08', 100, 200]], '2026-11-09'), null, '1 día de historia no alcanza');
  assert.equal(bajaHabitual([['2026-10-22', 100, 200], ['2026-10-28', 150, 200]], '2026-11-09'), null, 'subió');
  assert.equal(bajaHabitual([['2026-10-22', 100, 200]], '2026-11-09'), null, 'nunca cambió');
});

test('bajaHabitual: un pico corto no es el precio habitual (mediana ponderada por días)', () => {
  const obs = [['2026-10-10', 100, 100], ['2026-10-25', 300, 300], ['2026-10-26', 100, 100]];
  assert.equal(bajaHabitual(obs, '2026-11-09'), null, 'volvió a 100: no es una baja');
  const obs2 = [['2026-10-10', 200, 200], ['2026-10-25', 300, 300], ['2026-10-26', 150, 300]];
  assert.equal(bajaHabitual(obs2, '2026-11-09').habitual, 200);
});
