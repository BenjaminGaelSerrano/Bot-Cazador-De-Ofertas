import assert from 'node:assert/strict';
import { test } from 'node:test';
import { esMiTalle } from '../src/mitalle.mjs';

test('esMiTalle: 44,5 a 46, también en los talles dobles de Dexter', () => {
  for (const t of ['44.5', '45', '45.5', '46', '45-45.5', '44-44.5', '46-46.5', '45,5']) assert.ok(esMiTalle(t), t);
  for (const t of ['44', '43.5', '47', '42-42.5', 'S', 'único', '38-38.5']) assert.ok(!esMiTalle(t), t);
});
