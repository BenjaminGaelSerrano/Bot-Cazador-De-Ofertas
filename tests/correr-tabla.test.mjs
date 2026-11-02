import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { correrFuente } from '../src/correr.mjs';
import { crearHistorial, guardar, registrar } from '../src/nucleo/historial.mjs';

// Estas pruebas usan la configuración REAL: formato de tabla y avisar solo lo que vale la pena ("buena").

const TRES = '```';
const oferta = (id, extra = {}) => ({
  id: String(id), ean: `77912345678${String(id).padStart(2, '0')}`, marca: 'Nike', nombre: `ZAPATILLAS NIKE MODELO ${id} HOMBRE`, ml: null,
  categoria: 'Calzado', precioActual: 100000, precioLista: 100000, stock: 5, url: `https://x.test/producto-${id}/p`, ...extra,
});

async function entorno() {
  const directorioDatos = await mkdtemp(join(tmpdir(), 'cazador-'));
  const enviados = [];
  let catalogo = [];
  const base = {
    nombre: 'grid', titulo: 'Ofertas Grid', directorioDatos, pausaMensajesMs: 0, log: () => {}, reiniciarAlertasAntesDe: null, avisosPausados: false,
    leer: async () => ({ ofertas: catalogo, informe: { pedidos: 1, productosLeidos: catalogo.length } }),
    enviarFn: async (texto, { dryRun }) => {
      if (dryRun) return { enviado: false, motivo: 'dry-run' };
      enviados.push(texto);
      return { enviado: true };
    },
  };
  return {
    directorioDatos,
    enviados,
    poner: (nuevo) => { catalogo = nuevo; },
    correr: (fecha, extra = {}) => correrFuente({ ...base, fecha, ...extra }),
    leerJson: async (ruta) => JSON.parse(await readFile(join(directorioDatos, ruta), 'utf8')),
    /** Deja en `datos/<tienda>` lo que esa tienda tenía visto, para que la otra lo use de referencia. */
    sembrar: async (tienda, productos, fecha = '2026-10-22') => {
      const h = crearHistorial();
      for (const p of productos) registrar(h, p, fecha);
      await mkdir(join(directorioDatos, tienda), { recursive: true });
      await guardar(join(directorioDatos, tienda, 'historial.json'), h);
    },
  };
}

test('por defecto avisa solo las que valen la pena, en tabla, con su link numerado', async () => {
  const e = await entorno();
  await e.sembrar('moov', [oferta(1, { precioActual: 200000 })]);
  e.poner([oferta(1, { precioActual: 100000, precioLista: 200000 }), oferta(2, { precioActual: 70000, precioLista: 100000 })]);
  const r = await e.correr('2026-10-22');

  assert.equal(e.enviados.length, 1);
  const m = e.enviados[0];
  assert.ok(m.startsWith('*Ofertas Grid* · 1 que valen la pena'), m);
  assert.ok(m.includes(TRES), 'tabla en bloque de ancho fijo');
  assert.ok(m.includes('NIKE MODELO 1'));
  assert.ok(m.includes('100k') && m.includes('200k') && m.includes('+90%'), 'costo, mercado y ganancia');
  assert.ok(m.endsWith('1) https://x.test/producto-1/p'), 'el link, entero, al final');
  assert.ok(!m.includes('MODELO 2'), 'la que no tiene referencia no se avisa');
  assert.equal(r.reventa.buenas, 1);
  assert.equal(r.reventa.sinReferencia, 1);
});

test('lo que no vale la pena no se marca como avisado: se reevalúa y sale cuando otra tienda lo respalda', async () => {
  const e = await entorno();
  e.poner([oferta(2, { precioActual: 70000, precioLista: 100000 })]);
  await e.correr('2026-10-22');
  assert.equal(e.enviados.length, 0);
  assert.deepEqual(Object.keys(await e.leerJson('alertas.json')), [], 'sigue pendiente');

  await e.sembrar('moov', [oferta(2, { precioActual: 150000 })]);
  await e.correr('2026-10-22');
  assert.equal(e.enviados.length, 1, 'ahora vale la pena');
  assert.ok(e.enviados[0].includes('NIKE MODELO 2'));
});

test('una regular no se avisa por defecto, y sí si se la agrega a la lista', async () => {
  const e = await entorno();
  // Costo 60.000; la otra tienda lo vende a 80.000, se revende a 76.000 (5 % menos): margen de 26,7 %, o sea "regular".
  await e.sembrar('moov', [oferta(1, { precioActual: 80000 })]);
  e.poner([oferta(1, { precioActual: 60000, precioLista: 100000 })]);
  const r = await e.correr('2026-10-22');
  assert.equal(r.reventa.regulares, 1);
  assert.equal(e.enviados.length, 0, 'regular: no se avisa por defecto');

  await e.correr('2026-10-22', { veredictosAvisables: ['buena', 'regular'] });
  assert.equal(e.enviados.length, 1);
  assert.ok(e.enviados[0].includes('+27%'));
});

test('el cruce por modelo se marca con "~" en la tabla', async () => {
  const e = await entorno();
  await e.sembrar('moov', [oferta(1, { ean: null, modelo: 'nike|blazer low', genero: 'h', precioActual: 200000 })]);
  e.poner([oferta(1, { ean: null, modelo: 'nike|blazer low', genero: 'h', precioActual: 100000, precioLista: 200000 })]);
  await e.correr('2026-10-22');
  assert.equal(e.enviados.length, 1);
  assert.ok(e.enviados[0].includes('~200k'), e.enviados[0]);
});

test('varias ofertas buenas se reparten en mensajes sin pasar el largo y con la numeración corrida', async () => {
  const e = await entorno();
  const n = 14;
  await e.sembrar('moov', Array.from({ length: n }, (_, i) => oferta(i + 1, { precioActual: 200000 })));
  e.poner(Array.from({ length: n }, (_, i) => oferta(i + 1, { precioActual: 100000 - i * 500, precioLista: 200000 })));
  const r = await e.correr('2026-10-22', { maxPrimeraCorrida: Infinity, maxMensajes: 8 });
  assert.equal(r.avisadas, n);
  assert.ok(e.enviados.length >= 2 && e.enviados.length <= 4, `${e.enviados.length} mensajes para ${n} ofertas`);
  const todo = e.enviados.join('\n');
  for (let i = 1; i <= n; i++) assert.equal(todo.split(`\n${i}) https`).length - 1, 1, `link ${i} una sola vez`);
  assert.equal(Object.keys(await e.leerJson('alertas.json')).length, n);
});

test('una oferta ya avisada no se repite', async () => {
  const e = await entorno();
  await e.sembrar('moov', [oferta(1, { precioActual: 200000 })]);
  e.poner([oferta(1, { precioActual: 100000, precioLista: 200000 })]);
  await e.correr('2026-10-22');
  await e.correr('2026-10-22');
  assert.equal(e.enviados.length, 1);
});

test('se registra el puntaje de cada aviso en avisos.jsonl', async () => {
  const e = await entorno();
  await e.sembrar('moov', [oferta(1, { precioActual: 200000 })]);
  e.poner([oferta(1, { precioActual: 100000, precioLista: 200000 })]);
  await e.correr('2026-10-22');
  const linea = JSON.parse((await readFile(join(e.directorioDatos, 'avisos.jsonl'), 'utf8')).trim());
  assert.deepEqual([linea.veredicto, linea.precio, linea.precioMercado, linea.margen, linea.via], ['buena', 100000, 200000, 90, 'ean']);
});

test('el formato anterior (detallado) sigue disponible por configuración', async () => {
  const e = await entorno();
  await e.sembrar('moov', [oferta(1, { precioActual: 200000 })]);
  e.poner([oferta(1, { precioActual: 100000, precioLista: 200000 })]);
  await e.correr('2026-10-22', { formato: 'detalle' });
  assert.ok(e.enviados[0].startsWith('Ofertas Grid (1)'));
  assert.ok(!e.enviados[0].includes(TRES));
});

test('en simulación no se envía ni se escribe nada', async () => {
  const e = await entorno();
  await e.sembrar('moov', [oferta(1, { precioActual: 200000 })]);
  e.poner([oferta(1, { precioActual: 100000, precioLista: 200000 })]);
  const r = await e.correr('2026-10-22', { dryRun: true });
  assert.equal(r.mensajes, 1);
  assert.equal(e.enviados.length, 0);
  await assert.rejects(readFile(join(e.directorioDatos, 'alertas.json')), { code: 'ENOENT' });
});

// ---------- Reinicio único de las marcas de "ya avisado" ----------

import { writeFile } from 'node:fs/promises';

/** Alertas como las dejaron las primeras corridas: marcadas como avisadas con fecha anterior. */
const marcasViejas = async (e, ids, fecha) => {
  const alertas = Object.fromEntries(ids.map((id) => [`grid:${id}`, { precio: 100000, fecha }]));
  await writeFile(join(e.directorioDatos, 'alertas.json'), JSON.stringify(alertas));
};

test('reinicio: una oferta buena que quedó marcada por la línea base de una corrida vieja ahora sale', async () => {
  const e = await entorno();
  await e.sembrar('moov', [oferta(1, { precioActual: 200000 })]);
  await marcasViejas(e, [1], '2026-10-21');
  e.poner([oferta(1, { precioActual: 100000, precioLista: 200000 })]);

  await e.correr('2026-10-23', { reiniciarAlertasAntesDe: '2026-10-23' });
  assert.equal(e.enviados.length, 1, 'la marca vieja se ignora');
  assert.equal((await e.leerJson('alertas.json'))['grid:1'].fecha, '2026-10-23', 'queda con la fecha nueva');
});

test('reinicio: una vez avisada con fecha nueva, no se repite', async () => {
  const e = await entorno();
  await e.sembrar('moov', [oferta(1, { precioActual: 200000 })]);
  await marcasViejas(e, [1], '2026-10-21');
  e.poner([oferta(1, { precioActual: 100000, precioLista: 200000 })]);
  await e.correr('2026-10-23', { reiniciarAlertasAntesDe: '2026-10-23' });
  await e.correr('2026-10-23', { reiniciarAlertasAntesDe: '2026-10-23' });
  await e.correr('2026-10-24', { reiniciarAlertasAntesDe: '2026-10-23' });
  assert.equal(e.enviados.length, 1);
});

test('reinicio: las marcas de la fecha de corte o posteriores se respetan', async () => {
  const e = await entorno();
  await e.sembrar('moov', [oferta(1, { precioActual: 200000 })]);
  await marcasViejas(e, [1], '2026-10-23');
  e.poner([oferta(1, { precioActual: 100000, precioLista: 200000 })]);
  await e.correr('2026-10-23', { reiniciarAlertasAntesDe: '2026-10-23' });
  assert.equal(e.enviados.length, 0);
});

test('reinicio: con null no se reinicia nada', async () => {
  const e = await entorno();
  await e.sembrar('moov', [oferta(1, { precioActual: 200000 })]);
  await marcasViejas(e, [1], '2026-10-21');
  e.poner([oferta(1, { precioActual: 100000, precioLista: 200000 })]);
  await e.correr('2026-10-23', { reiniciarAlertasAntesDe: null });
  assert.equal(e.enviados.length, 0);
});

test('reinicio: en simulación no se escribe nada', async () => {
  const e = await entorno();
  await e.sembrar('moov', [oferta(1, { precioActual: 200000 })]);
  await marcasViejas(e, [1], '2026-10-21');
  e.poner([oferta(1, { precioActual: 100000, precioLista: 200000 })]);
  await e.correr('2026-10-23', { reiniciarAlertasAntesDe: '2026-10-23', dryRun: true });
  assert.equal((await e.leerJson('alertas.json'))['grid:1'].fecha, '2026-10-21', 'el archivo no se tocó');
});

test('configuración: el reinicio apunta a una fecha concreta', async () => {
  const { config } = await import('../src/config.mjs');
  assert.match(config.reiniciarAlertasAntesDe, /^\d{4}-\d{2}-\d{2}$/);
});

// ---------- Referencia internacional (spec 006) ----------

test('referencia internacional (sin consultar = esperar): lo más caro que en EE. UU. y lo sin consultar no se avisan ni se marcan; sin precio va con *', async () => {
  const e = await entorno();
  // Cuatro ofertas buenas (Moov las vende al doble). La referencia simulada decide qué pasa con cada una.
  await e.sembrar('moov', [1, 2, 3, 4].map((id) => oferta(id, { precioActual: 200000 })));
  e.poner([1, 2, 3, 4].map((id) => oferta(id, { precioActual: 100000, precioLista: 200000 })));
  const respuestas = {
    1: { estado: 'ok', usd: 80, pesos: 120000, via: 'ean' },     // más barata que en EE. UU.: se avisa sin marca
    2: { estado: 'ok', usd: 50, pesos: 80000, via: 'ean' },      // más cara que en EE. UU.: no se avisa
    3: { estado: 'sin' },                                         // sin precio de EE. UU.: se avisa con *
    4: { estado: 'pendiente' },                                   // sin consultar: espera a la próxima corrida
  };
  const consultadas = [];
  const referencias = { buscar: async (o) => { consultadas.push(o.id); return respuestas[o.id]; } };
  const r = await e.correr('2026-10-22', { referencias, avisarSinConsultar: false });

  assert.deepEqual(consultadas.sort(), ['1', '2', '3', '4']);
  assert.equal(e.enviados.length, 1);
  const m = e.enviados[0];
  assert.ok(m.includes('~ aproximado · * sin precio EE.UU.'), 'leyenda nueva');
  assert.ok(m.includes(' 1 NIKE MODELO 1'), m);
  assert.ok(m.includes(' 2*NIKE MODELO 3'), m);
  assert.ok(!m.includes('MODELO 2') && !m.includes('MODELO 4'), m);
  assert.deepEqual(r.internacional, { caras: 1, pendientes: 1, conPrecio: 1, sinPrecio: 1 });
  assert.deepEqual(Object.keys(await e.leerJson('alertas.json')).sort(), ['grid:1', 'grid:3'], 'la cara y la pendiente se reevalúan');

  const avisos = (await readFile(join(e.directorioDatos, 'avisos.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(avisos.find((a) => a.id === '1').usd, 80);
});

test('referencia internacional: solo se consulta lo que se va a avisar', async () => {
  const e = await entorno();
  e.poner([oferta(1, { precioActual: 70000, precioLista: 100000 })]); // sin otra tienda: "sin referencia", no se avisa
  const consultadas = [];
  await e.correr('2026-10-22', { referencias: { buscar: async (o) => { consultadas.push(o.id); return { estado: 'sin' }; } } });
  assert.deepEqual(consultadas, []);
});

test('referencia internacional (por defecto): lo que no se pudo consultar se avisa igual, con *', async () => {
  const e = await entorno();
  await e.sembrar('moov', [oferta(1, { precioActual: 200000 })]);
  e.poner([oferta(1, { precioActual: 100000, precioLista: 200000 })]);
  const r = await e.correr('2026-10-22', { referencias: { buscar: async () => ({ estado: 'pendiente' }) } });
  assert.equal(e.enviados.length, 1);
  assert.ok(e.enviados[0].includes(' 1*NIKE MODELO 1'), e.enviados[0]);
  assert.deepEqual(r.internacional, { caras: 0, pendientes: 1, conPrecio: 0, sinPrecio: 0 });
});

test('avisos pausados: no se manda ni se marca nada, pero el historial se guarda', async () => {
  const e = await entorno();
  await e.sembrar('moov', [oferta(1, { precioActual: 200000 })]);
  e.poner([oferta(1, { precioActual: 100000, precioLista: 200000 })]);
  const r = await e.correr('2026-10-22', { avisosPausados: true });
  assert.equal(e.enviados.length, 0);
  assert.equal(r.reventa.buenas, 1, 'se evalúa igual');
  assert.deepEqual(Object.keys(await e.leerJson('alertas.json')), [], 'no se marca: sale al reanudar');
  assert.ok((await e.leerJson('grid/historial.json')).productos['1']);
});
