import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { correrConAvisoDeFalla } from '../src/correr.mjs';
import { avisarFalla, marcarRecuperada, mensajeDeFalla, tipoDe } from '../src/nucleo/fallas.mjs';
import { ErrorFuente } from '../src/nucleo/http.mjs';
import { ErrorNotificacion, enviar } from '../src/notificar/callmebot.mjs';

const bloqueo = () => new ErrorFuente('bloqueo', 'El sitio bloqueó el pedido (429): https://x.test/api', { status: 429 });

async function entorno() {
  const directorioDatos = await mkdtemp(join(tmpdir(), 'cazador-'));
  const enviados = [];
  const enviarFn = async (texto) => { enviados.push(texto); return { enviado: true }; };
  const leerFallas = async () => JSON.parse(await readFile(join(directorioDatos, 'fallas.json'), 'utf8'));
  return { directorioDatos, enviados, enviarFn, leerFallas };
}

const base = (e, extra = {}) => ({ nombre: 'juleriaque', fecha: '2026-10-20', directorioDatos: e.directorioDatos, enviarFn: e.enviarFn, log: () => {}, ...extra });

test('tipoDe: usa el tipo del error y cae en "interno"', () => {
  assert.equal(tipoDe(bloqueo()), 'bloqueo');
  assert.equal(tipoDe(new ErrorNotificacion('x')), 'notificacion');
  assert.equal(tipoDe(new Error('boom')), 'interno');
});

test('mensajeDeFalla: legible, con detalle acotado y sin saltos de línea', () => {
  const m = mensajeDeFalla('juleriaque', new ErrorFuente('bloqueo', `x\n${'y'.repeat(500)}`));
  assert.match(m, /falla en juleriaque\. el sitio bloqueó al bot\./);
  assert.ok(!m.includes('\n'));
  assert.ok(m.length < 400);
});

test('primera falla: avisa una vez y la deja registrada', async () => {
  const e = await entorno();
  const r = await avisarFalla({ ...base(e), error: bloqueo() });
  assert.equal(r.avisada, true);
  assert.equal(e.enviados.length, 1);
  assert.deepEqual(await e.leerFallas(), { juleriaque: { tipo: 'bloqueo', desde: '2026-10-20', ultimaVez: '2026-10-20', avisado: true } });
});

test('la misma falla en corridas siguientes no se vuelve a avisar', async () => {
  const e = await entorno();
  await avisarFalla({ ...base(e), error: bloqueo() });
  const r = await avisarFalla({ ...base(e, { fecha: '2026-10-21' }), error: bloqueo() });
  assert.equal(r.avisada, false);
  assert.equal(e.enviados.length, 1);
  const estado = (await e.leerFallas()).juleriaque;
  assert.equal(estado.desde, '2026-10-20');
  assert.equal(estado.ultimaVez, '2026-10-21');
});

test('una falla de otro tipo sí se avisa', async () => {
  const e = await entorno();
  await avisarFalla({ ...base(e), error: bloqueo() });
  await avisarFalla({ ...base(e, { fecha: '2026-10-21' }), error: new ErrorFuente('respuesta_invalida', 'no es JSON') });
  assert.equal(e.enviados.length, 2);
});

test('tras recuperarse, una nueva falla vuelve a avisarse', async () => {
  const e = await entorno();
  await avisarFalla({ ...base(e), error: bloqueo() });
  assert.equal(await marcarRecuperada(base(e)), true);
  assert.equal(await marcarRecuperada(base(e)), false);
  await avisarFalla({ ...base(e, { fecha: '2026-10-22' }), error: bloqueo() });
  assert.equal(e.enviados.length, 2);
});

test('si el aviso no pudo salir, se reintenta en la corrida siguiente', async () => {
  const e = await entorno();
  const roto = async () => { throw new ErrorNotificacion('CallMeBot respondió 503'); };
  const r1 = await avisarFalla({ ...base(e, { enviarFn: roto }), error: bloqueo() });
  assert.equal(r1.avisada, false);
  assert.equal((await e.leerFallas()).juleriaque.avisado, false);
  const r2 = await avisarFalla({ ...base(e, { fecha: '2026-10-21' }), error: bloqueo() });
  assert.equal(r2.avisada, true);
  assert.equal(e.enviados.length, 1);
});

test('sin credenciales tampoco se da por avisada', async () => {
  const e = await entorno();
  const sinCredenciales = async () => ({ enviado: false, motivo: 'sin-credenciales' });
  await avisarFalla({ ...base(e, { enviarFn: sinCredenciales }), error: bloqueo() });
  assert.equal((await e.leerFallas()).juleriaque.avisado, false);
});

test('dry-run: no escribe ni envía', async () => {
  const e = await entorno();
  await avisarFalla({ ...base(e, { dryRun: true }), error: bloqueo() });
  await assert.rejects(readFile(join(e.directorioDatos, 'fallas.json')), { code: 'ENOENT' });
});

test('un fallas.json roto no impide avisar', async () => {
  const e = await entorno();
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(e.directorioDatos, 'fallas.json'), '{ roto');
  const r = await avisarFalla({ ...base(e), error: bloqueo() });
  assert.equal(r.avisada, true);
});

test('correrConAvisoDeFalla: avisa una vez, relanza el error y no toca el historial', async () => {
  const e = await entorno();
  const opciones = { ...base(e), titulo: 'Ofertas', cliente: null, pausaMensajesMs: 0, leer: async () => { throw bloqueo(); } };
  await assert.rejects(correrConAvisoDeFalla(opciones), (err) => err.tipo === 'bloqueo');
  await assert.rejects(correrConAvisoDeFalla({ ...opciones, fecha: '2026-10-21' }), (err) => err.tipo === 'bloqueo');
  assert.equal(e.enviados.length, 1);
  await assert.rejects(readFile(join(e.directorioDatos, 'juleriaque', 'historial.json')), { code: 'ENOENT' });
});

test('correrConAvisoDeFalla: una corrida exitosa borra la falla', async () => {
  const e = await entorno();
  const ofertas = [{ id: '1', ean: null, marca: 'M', nombre: 'P', ml: null, categoria: 'F', precioActual: 100, precioLista: 100, stock: 1, url: 'https://x.test/1' }];
  const bien = { ...base(e), titulo: 'Ofertas', cliente: null, pausaMensajesMs: 0, leer: async () => ({ ofertas, informe: { pedidos: 1, productosLeidos: 1 } }) };
  await avisarFalla({ ...base(e), error: bloqueo() });
  await correrConAvisoDeFalla(bien);
  assert.deepEqual(await e.leerFallas(), {});
});

test('un error al enviar ofertas se registra como falla de notificación', async () => {
  const e = await entorno();
  const ofertas = [{ id: '1', ean: null, marca: 'M', nombre: 'P', ml: null, categoria: 'F', precioActual: 50, precioLista: 100, stock: 1, url: 'https://x.test/1' }];
  let llamadas = 0;
  const enviarFn = async (texto) => {
    llamadas++;
    if (texto.startsWith('Ofertas')) throw new ErrorNotificacion('CallMeBot respondió 503');
    return { enviado: true };
  };
  await assert.rejects(
    correrConAvisoDeFalla({ ...base(e, { enviarFn }), titulo: 'Ofertas', cliente: null, pausaMensajesMs: 0, leer: async () => ({ ofertas, informe: {} }) }),
    (err) => err.tipo === 'notificacion',
  );
  assert.ok(llamadas >= 2);
  assert.equal((await e.leerFallas()).juleriaque.tipo, 'notificacion');
});

test('enviar: un fallo de red lanza ErrorNotificacion sin filtrar la clave', async () => {
  await assert.rejects(
    enviar('hola', { phone: '1', apikey: 'secreta', fetchFn: async () => { throw new TypeError('fetch failed: https://api.callmebot.com/?apikey=secreta'); } }),
    (err) => err instanceof ErrorNotificacion && !err.message.includes('secreta'),
  );
});
