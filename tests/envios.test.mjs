import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cupoDeCorrida, enviadosHoy, sumarEnviados } from '../src/nucleo/envios.mjs';

test('envíos del día: se suman en el mismo día y se reinician al cambiar de fecha', async () => {
  const ruta = join(await mkdtemp(join(tmpdir(), 'envios-')), 'envios.json');
  assert.equal(await enviadosHoy(ruta, '2026-11-02'), 0, 'sin archivo');
  await sumarEnviados(ruta, '2026-11-02', 12);
  assert.equal(await sumarEnviados(ruta, '2026-11-02', 10), 22);
  assert.equal(await enviadosHoy(ruta, '2026-11-03'), 0, 'otro día');
  assert.equal(await sumarEnviados(ruta, '2026-11-03', 3), 3);
});

test('cupoDeCorrida: el tope por corrida, sin pasar lo que queda del día', () => {
  assert.equal(cupoDeCorrida(40, 25, 0), 25);
  assert.equal(cupoDeCorrida(40, 25, 22), 3);
  assert.equal(cupoDeCorrida(40, 25, 30), 0);
  assert.equal(cupoDeCorrida(8, 25, 0), 8);
});
