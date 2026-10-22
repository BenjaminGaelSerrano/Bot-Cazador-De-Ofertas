import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { correrFuente } from '../src/correr.mjs';
import { cargar, guardar, registrar, crearHistorial } from '../src/nucleo/historial.mjs';

const oferta = (id, extra = {}) => ({
  id: String(id), ean: null, marca: 'MARCA', nombre: `Producto ${id} 50 ml`, ml: 50, categoria: 'Fragancias',
  precioActual: 100000, precioLista: 100000, stock: 5, url: `https://x.test/${id}`, ...extra,
});

/** Contexto de prueba: carpeta temporal, "sitio" que devuelve lo que se le indique y WhatsApp falso. */
async function entorno() {
  const directorioDatos = await mkdtemp(join(tmpdir(), 'cazador-'));
  const enviados = [];
  let catalogo = [];
  const base = {
    nombre: 'juleriaque', titulo: 'Ofertas', directorioDatos, pausaMensajesMs: 0, log: () => {},
    // Estas pruebas miden la lógica de avisos, no el largo de los mensajes: sin tope de largo (hay pruebas aparte).
    limitesMensaje: { maxCaracteres: 1e9, maxCodificados: 1e9 },
    leer: async () => ({ ofertas: catalogo, informe: { pedidos: 1, productosLeidos: catalogo.length } }),
    enviarFn: async (texto, { dryRun }) => {
      if (dryRun) return { enviado: false, motivo: 'dry-run' };
      enviados.push(texto);
      return { enviado: true };
    },
  };
  return {
    directorioDatos, enviados,
    poner: (nuevo) => { catalogo = nuevo; },
    correr: (fecha, extra = {}) => correrFuente({ ...base, fecha, ...extra }),
    leerJson: async (ruta) => JSON.parse(await readFile(join(directorioDatos, ruta), 'utf8')),
  };
}

test('primera corrida: avisa las ofertas con el descuento contra la lista del sitio', async () => {
  const e = await entorno();
  e.poner([oferta(1, { precioActual: 50000 }), oferta(2, { precioActual: 70000 }), oferta(3)]);
  const r = await e.correr('2026-10-20');

  assert.equal(r.gangas, 2);
  assert.equal(e.enviados.length, 1);
  assert.match(e.enviados[0], /^Ofertas \(2\)\n\n1\) MARCA Producto 1 50 ml\n\$50\.000 · -50% vs lista \$100\.000\nSin referencia de otra tienda · quedan 5\nhttps:\/\/x\.test\/1\n\n2\) /);
  assert.ok(e.enviados[0].indexOf('Producto 1') < e.enviados[0].indexOf('Producto 2'), 'la de mayor descuento va primero');
  assert.deepEqual(Object.keys(await e.leerJson('alertas.json')).sort(), ['juleriaque:1', 'juleriaque:2']);
  assert.equal(Object.keys((await e.leerJson('juleriaque/historial.json')).productos).length, 3);
});

test('segunda corrida con los mismos datos: no repite ningún aviso', async () => {
  const e = await entorno();
  e.poner([oferta(1, { precioActual: 50000 })]);
  await e.correr('2026-10-20');
  const r = await e.correr('2026-10-20');
  assert.equal(r.pendientes, 0);
  assert.equal(e.enviados.length, 1);
});

test('vuelve a avisar solo si baja otro 10 %', async () => {
  const e = await entorno();
  e.poner([oferta(1, { precioActual: 50000 })]);
  await e.correr('2026-10-20');
  e.poner([oferta(1, { precioActual: 47000 })]); // -6 %
  await e.correr('2026-10-21');
  assert.equal(e.enviados.length, 1);
  e.poner([oferta(1, { precioActual: 44000 })]); // -12 % sobre lo avisado
  await e.correr('2026-10-22');
  assert.equal(e.enviados.length, 2);
});

test('con 30+ días de historial usa el mínimo previo y lo dice en el mensaje', async () => {
  const e = await entorno();
  const h = crearHistorial();
  registrar(h, oferta(1), '2026-08-01'); // precio 100000 desde hace más de 30 días
  await guardar(join(e.directorioDatos, 'juleriaque', 'historial.json'), h);

  e.poner([oferta(1, { precioActual: 60000, precioLista: 100000 })]);
  await e.correr('2026-10-20');
  assert.match(e.enviados[0], /-40% vs mín\. 30 días \$100\.000/);
});

test('si el precio vuelve a subir, se olvida el aviso y una nueva baja se avisa de nuevo', async () => {
  const e = await entorno();
  e.poner([oferta(1, { precioActual: 50000 })]);
  await e.correr('2026-10-20');
  e.poner([oferta(1, { precioActual: 100000 })]);
  await e.correr('2026-10-21');
  assert.deepEqual(await e.leerJson('alertas.json'), {});
  e.poner([oferta(1, { precioActual: 50000 })]);
  await e.correr('2026-10-22');
  assert.equal(e.enviados.length, 2);
});

test('sin stock no se avisa, y el aviso previo se conserva mientras no haya stock', async () => {
  const e = await entorno();
  e.poner([oferta(1, { precioActual: 50000 })]);
  await e.correr('2026-10-20');
  e.poner([oferta(1, { precioActual: 50000, stock: 0 })]);
  await e.correr('2026-10-21');
  e.poner([oferta(1, { precioActual: 50000 })]);
  await e.correr('2026-10-22');
  assert.equal(e.enviados.length, 1, 'al volver el stock no se repite el aviso');
});

test('dry-run: no escribe nada ni envía', async () => {
  const e = await entorno();
  e.poner([oferta(1, { precioActual: 50000 })]);
  const r = await e.correr('2026-10-20', { dryRun: true });
  assert.equal(r.pendientes, 1);
  assert.equal(e.enviados.length, 0);
  await assert.rejects(readFile(join(e.directorioDatos, 'alertas.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(e.directorioDatos, 'juleriaque', 'historial.json')), { code: 'ENOENT' });
});

test('sin credenciales: no marca nada como avisado (se intentará en la próxima corrida)', async () => {
  const e = await entorno();
  e.poner([oferta(1, { precioActual: 50000 })]);
  await e.correr('2026-10-20', { enviarFn: async () => ({ enviado: false, motivo: 'sin-credenciales' }) });
  assert.deepEqual(await e.leerJson('alertas.json'), {});
});

test('topes: lo que no entra queda sin marcar y se avisa en la corrida siguiente', async () => {
  const e = await entorno();
  const muchas = Array.from({ length: 30 }, (_, i) => oferta(i + 1, { precioActual: 50000 - i * 100 }));
  e.poner(muchas);
  await e.correr('2026-10-20', { maxPrimeraCorrida: Infinity, maxMensajes: 3 }); // 3 mensajes x 8 = 24 ofertas
  assert.equal(e.enviados.length, 3);
  assert.ok(e.enviados[2].endsWith('y 6 más.'));
  assert.equal(Object.keys(await e.leerJson('alertas.json')).length, 24);

  await e.correr('2026-10-21', { maxMensajes: 3 }); // las 6 restantes
  assert.equal(e.enviados.length, 4);
  assert.match(e.enviados[3], /^Ofertas \(6\)/);
  assert.equal(Object.keys(await e.leerJson('alertas.json')).length, 30);
});

test('si un envío es rechazado después de otros que salieron: es el límite, no una falla; se corta y se retoma', async () => {
  const e = await entorno();
  const muchas = Array.from({ length: 12 }, (_, i) => oferta(i + 1, { precioActual: 50000 - i * 100 }));
  e.poner(muchas);
  let n = 0;
  const enviarFn = async (texto) => {
    if (++n === 2) throw new Error('CallMeBot respondió 503');
    e.enviados.push(texto);
    return { enviado: true };
  };
  const logs = [];
  const r = await e.correr('2026-10-20', { enviarFn, maxPrimeraCorrida: Infinity, maxMensajes: 8, log: (t) => logs.push(t) });
  assert.match(r.limiteEnvio, /503/, 'la corrida termina bien e informa el límite');
  assert.equal(r.mensajesUsados, 1);
  assert.ok(logs.some((l) => /Límite de envío alcanzado tras 1 mensajes/.test(l)));
  assert.equal(Object.keys((await e.leerJson('juleriaque/historial.json')).productos).length, 12, 'el historial se guardó');
  assert.equal(Object.keys(await e.leerJson('alertas.json')).length, 8, 'solo las del primer mensaje, que sí salió');

  // La corrida siguiente retoma lo que quedó en cola, y las 4 restantes salen ahora.
  await e.correr('2026-10-21', { maxPrimeraCorrida: Infinity, maxMensajes: 8 });
  assert.equal(Object.keys(await e.leerJson('alertas.json')).length, 12);
});

test('si ni siquiera el primer mensaje sale, eso sí es una falla y se informa', async () => {
  const e = await entorno();
  e.poner([oferta(1, { precioActual: 50000 })]);
  const enviarFn = async () => { throw new Error('CallMeBot no respondió'); };
  await assert.rejects(e.correr('2026-10-20', { enviarFn }), /no respondió/);
  assert.deepEqual(Object.keys(await e.leerJson('alertas.json')), [], 'nada quedó marcado');
});

test('con el estado de envío ya bloqueado, no se intenta enviar y la oferta queda en cola', async () => {
  const e = await entorno();
  e.poner([oferta(1, { precioActual: 50000 })]);
  let llamado = false;
  const enviarFn = async () => { llamado = true; return { enviado: true }; };
  const r = await e.correr('2026-10-20', { enviarFn, estadoEnvio: { enviados: 5, bloqueado: true } });
  assert.equal(llamado, false);
  assert.equal(r.mensajesUsados, 0);
  assert.deepEqual(Object.keys(await e.leerJson('alertas.json')), [], 'sigue pendiente');
  assert.equal(Object.keys((await e.leerJson('juleriaque/historial.json')).productos).length, 1, 'igual se guardan los precios');
});

test('hay pausa entre mensajes, también entre el último de una tienda y el primero de la siguiente', async () => {
  const e = await entorno();
  e.poner([oferta(1, { precioActual: 50000 })]);
  const esperas = [];
  const dormir = async (ms) => { esperas.push(ms); };
  await e.correr('2026-10-20', { pausaMensajesMs: 3000, dormir, estadoEnvio: { enviados: 4, bloqueado: false } });
  assert.deepEqual(esperas, [3000], 'ya habían salido mensajes de otra tienda: espera antes del primero');
  const e2 = await entorno();
  e2.poner([oferta(1, { precioActual: 50000 })]);
  const esperas2 = [];
  await e2.correr('2026-10-20', { pausaMensajesMs: 3000, dormir: async (ms) => { esperas2.push(ms); } });
  assert.deepEqual(esperas2, [], 'si es el primer mensaje de la corrida no hace falta esperar');
});

test('si la fuente falla, no se toca el historial ni las alertas', async () => {
  const e = await entorno();
  e.poner([oferta(1, { precioActual: 50000 })]);
  await e.correr('2026-10-20');
  const antes = await readFile(join(e.directorioDatos, 'juleriaque', 'historial.json'), 'utf8');
  await assert.rejects(e.correr('2026-10-21', { leer: async () => { throw new Error('bloqueado'); } }), /bloqueado/);
  assert.equal(await readFile(join(e.directorioDatos, 'juleriaque', 'historial.json'), 'utf8'), antes);
});

test('un historial roto detiene la corrida en vez de empezar de cero', async () => {
  const e = await entorno();
  e.poner([oferta(1, { precioActual: 50000 })]);
  await e.correr('2026-10-20');
  await writeFile(join(e.directorioDatos, 'juleriaque', 'historial.json'), '{ roto');
  await assert.rejects(e.correr('2026-10-21'), SyntaxError);
  assert.equal(e.enviados.length, 1);
});

test('el historial guardado puede volver a cargarse', async () => {
  const e = await entorno();
  e.poner([oferta(1, { precioActual: 50000 })]);
  await e.correr('2026-10-20');
  const h = await cargar(join(e.directorioDatos, 'juleriaque', 'historial.json'));
  assert.deepEqual(h.productos['1'].obs, [['2026-10-20', 50000, 100000]]);
});

// ---------- Línea base de la primera corrida de una fuente ----------

const docena = () => Array.from({ length: 12 }, (_, i) => oferta(i + 1, { precioActual: 50000 - i * 1000 }));

test("primera corrida: avisa solo las N mejores y deja el resto como línea base", async () => {
  const e = await entorno();
  e.poner(docena());
  const r = await e.correr("2026-10-20", { maxPrimeraCorrida: 8 });
  assert.equal(r.primeraCorrida, true);
  assert.equal(r.silenciadas, 4);
  assert.equal(e.enviados.length, 1);
  assert.match(e.enviados[0], /^Ofertas · 1ª lectura, de 12 \(8\)/);
  assert.ok(e.enviados[0].includes("Producto 12 50 ml"), "la de mayor descuento va");
  assert.ok(!e.enviados[0].includes("Producto 1 50 ml"), "la de menor descuento queda en la línea base");
  assert.equal(Object.keys(await e.leerJson("alertas.json")).length, 12, "las 8 avisadas y las 4 de la línea base");
});

test("tras la línea base, la segunda corrida con los mismos datos no avisa nada", async () => {
  const e = await entorno();
  e.poner(docena());
  await e.correr("2026-10-20", { maxPrimeraCorrida: 8 });
  const r = await e.correr("2026-10-21", { maxPrimeraCorrida: 8 });
  assert.equal(r.primeraCorrida, false);
  assert.equal(r.pendientes, 0);
  assert.equal(e.enviados.length, 1);
});

test("tras la línea base, una oferta nueva o una baja del 10 % sí se avisa", async () => {
  const e = await entorno();
  e.poner(docena());
  await e.correr("2026-10-20", { maxPrimeraCorrida: 8 });
  const nueva = oferta(99, { precioActual: 40000 });
  const masBarata = oferta(12, { precioActual: 30000 }); // estaba en 39000 de la línea base
  e.poner([...docena().slice(0, 11), masBarata, nueva]);
  await e.correr("2026-10-21", { maxPrimeraCorrida: 8 });
  assert.equal(e.enviados.length, 2);
  assert.ok(e.enviados[1].includes("Producto 99") && e.enviados[1].includes("Producto 12"));
});

test("una fuente con historial previo no hace línea base: avisa todo (hasta los topes)", async () => {
  const e = await entorno();
  const h = crearHistorial();
  registrar(h, oferta(500, { precioActual: 100000 }), "2026-10-19");
  await guardar(join(e.directorioDatos, "juleriaque", "historial.json"), h);
  e.poner(docena());
  const r = await e.correr("2026-10-20", { maxPrimeraCorrida: 8 });
  assert.equal(r.primeraCorrida, false);
  assert.equal(r.silenciadas, 0);
  assert.match(e.enviados[0], /^Ofertas \(12\)/);
});

test("con 8 o menos ofertas, la primera corrida las avisa todas sin línea base", async () => {
  const e = await entorno();
  e.poner(docena().slice(0, 5));
  const r = await e.correr("2026-10-20", { maxPrimeraCorrida: 8 });
  assert.equal(r.silenciadas, 0);
  assert.match(e.enviados[0], /^Ofertas \(5\)/);
});

test("dry-run en la primera corrida informa la línea base pero no escribe nada", async () => {
  const e = await entorno();
  e.poner(docena());
  const r = await e.correr("2026-10-20", { maxPrimeraCorrida: 8, dryRun: true });
  assert.equal(r.silenciadas, 4);
  assert.equal(e.enviados.length, 0);
  await assert.rejects(readFile(join(e.directorioDatos, "alertas.json")), { code: "ENOENT" });
  await assert.rejects(readFile(join(e.directorioDatos, "juleriaque", "historial.json")), { code: "ENOENT" });
});

test("si falla el envío en la primera corrida, no se pierden las N mejores ni se repite la línea base", async () => {
  const e = await entorno();
  e.poner(docena());
  const roto = async () => { throw new Error("CallMeBot respondió 503"); };
  await assert.rejects(e.correr("2026-10-20", { maxPrimeraCorrida: 8, enviarFn: roto }), /503/);
  assert.equal(Object.keys(await e.leerJson("alertas.json")).length, 4, "solo la línea base quedó marcada");

  const r = await e.correr("2026-10-21", { maxPrimeraCorrida: 8 });
  assert.equal(r.primeraCorrida, false, "el historial ya se guardó");
  assert.equal(r.pendientes, 8, "las 8 mejores siguen pendientes");
  assert.match(e.enviados[0], /^Ofertas \(8\)/);
});

// ---------- Reventa: cruce con otras tiendas dentro de una corrida ----------

const { mkdir: crearDir } = await import('node:fs/promises');

/** Guarda en `datos/<tienda>/historial.json` lo que esa tienda tenía visto, para que las demás lo usen de referencia. */
async function sembrarTienda(e, tienda, productos, fecha = '2026-10-21') {
  const h = crearHistorial();
  for (const p of productos) registrar(h, p, fecha);
  await crearDir(join(e.directorioDatos, tienda), { recursive: true });
  await guardar(join(e.directorioDatos, tienda, 'historial.json'), h);
}
const conEan = (id, extra = {}) => oferta(id, { ean: `77912345678${String(id).padStart(2, '0')}`, ...extra });

test('reventa: una ganga que otra tienda vende al precio de lista sale buena, con el mercado y el margen', async () => {
  const e = await entorno();
  await sembrarTienda(e, 'rouge', [conEan(1, { precioActual: 100000 })]);
  e.poner([conEan(1, { precioActual: 50000 })]);
  const r = await e.correr('2026-10-22');
  assert.equal(r.reventa.buenas, 1);
  assert.match(e.enviados[0], /Mercado \$100\.000 \(Rouge\) · margen 90% · BUENA\nhttps:\/\/x\.test\/1/);
});

test('reventa: si otra tienda ya lo vende más barato, no se avisa ni se marca como avisada', async () => {
  const e = await entorno();
  await sembrarTienda(e, 'rouge', [conEan(1, { precioActual: 40000 })]);
  e.poner([conEan(1, { precioActual: 50000 }), conEan(2, { precioActual: 50000 })]);
  const r = await e.correr('2026-10-22');
  assert.equal(r.reventa.evitadas, 1);
  assert.equal(e.enviados.length, 1);
  assert.ok(!e.enviados[0].includes('Producto 1 '), 'la evitada no sale');
  assert.ok(e.enviados[0].includes('Producto 2 '), 'la que no tiene referencia sí');
  assert.deepEqual(Object.keys(await e.leerJson('alertas.json')), ['juleriaque:2'], 'la evitada no queda marcada');
});

test('reventa: una evitada se reevalúa y se avisa cuando la otra tienda sube el precio', async () => {
  const e = await entorno();
  await sembrarTienda(e, 'rouge', [conEan(1, { precioActual: 40000 })]);
  e.poner([conEan(1, { precioActual: 50000 })]);
  await e.correr('2026-10-22');
  assert.equal(e.enviados.length, 0);

  await sembrarTienda(e, 'rouge', [conEan(1, { precioActual: 100000 })], '2026-10-22');
  await e.correr('2026-10-22');
  assert.equal(e.enviados.length, 1);
});

test('reventa: se ordena buenas, luego regulares, luego sin referencia', async () => {
  const e = await entorno();
  await sembrarTienda(e, 'rouge', [conEan(1, { precioActual: 70000 }), conEan(2, { precioActual: 200000 })]);
  // 1: margen 33 % (regular); 2: margen 280 % (buena); 3: sin referencia aunque tiene el mayor descuento
  e.poner([conEan(1, { precioActual: 50000, precioLista: 100000 }), conEan(2, { precioActual: 50000, precioLista: 100000 }), conEan(3, { precioActual: 10000, precioLista: 100000 })]);
  await e.correr('2026-10-22');
  const nombres = [...e.enviados[0].matchAll(/Producto (\d)/g)].map((m) => m[1]);
  assert.deepEqual(nombres, ['2', '1', '3']);
});

test('reventa: cada aviso queda en avisos.jsonl con el puntaje que se le dio', async () => {
  const e = await entorno();
  await sembrarTienda(e, 'rouge', [conEan(1, { precioActual: 100000 })]);
  e.poner([conEan(1, { precioActual: 50000 }), conEan(2, { precioActual: 60000 })]);
  await e.correr('2026-10-22');
  const { readFile: leer } = await import('node:fs/promises');
  const lineas = (await leer(join(e.directorioDatos, 'avisos.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lineas.length, 2);
  const buena = lineas.find((l) => l.id === '1');
  assert.deepEqual([buena.fuente, buena.veredicto, buena.precio, buena.precioMercado, buena.fuenteMercado, buena.margen], ['juleriaque', 'buena', 50000, 100000, 'rouge', 90]);
  const sinRef = lineas.find((l) => l.id === '2');
  assert.deepEqual([sinRef.veredicto, sinRef.precioMercado, sinRef.margen], ['sin-referencia', null, null]);
});

test('reventa: en dry-run no se escribe avisos.jsonl', async () => {
  const e = await entorno();
  e.poner([conEan(1, { precioActual: 50000 })]);
  await e.correr('2026-10-22', { dryRun: true });
  await assert.rejects(readFile(join(e.directorioDatos, 'avisos.jsonl')), { code: 'ENOENT' });
});

test('reventa: los avisos entran en el largo del mensaje aunque lleven la línea de mercado', async () => {
  const e = await entorno();
  await sembrarTienda(e, 'rouge', Array.from({ length: 6 }, (_, i) => conEan(i + 1, { precioActual: 100000 })));
  e.poner(Array.from({ length: 6 }, (_, i) => conEan(i + 1, { precioActual: 50000 - i * 1000, nombre: `Producto con un nombre bastante largo número ${i + 1} edición especial 100 ml` })));
  await e.correr('2026-10-22', { limitesMensaje: {}, maxMensajes: 6 });
  for (const m of e.enviados) assert.ok(m.length <= 700, `mensaje de ${m.length} caracteres`);
});

test('reventa: el stock numérico queda registrado en el historial', async () => {
  const e = await entorno();
  e.poner([conEan(1, { precioActual: 50000, stock: 7 })]);
  await e.correr('2026-10-22');
  assert.deepEqual((await e.leerJson('juleriaque/historial.json')).productos['1'].stk, [['2026-10-22', 7]]);
});
