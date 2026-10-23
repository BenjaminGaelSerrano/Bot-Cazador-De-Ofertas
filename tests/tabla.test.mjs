import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config } from '../src/config.mjs';
import { agrupar, largoEfectivo } from '../src/notificar/callmebot.mjs';
import { formatearOferta } from '../src/notificar/formato.mjs';
import { agruparTabla, fila, itemTabla, miles, nombreCorto } from '../src/notificar/tabla.mjs';

const TRES = '```';

// ---------- Piezas ----------

test('miles: precios en "k" (la columna es angosta; el link lleva al precio exacto)', () => {
  assert.equal(miles(143000), '143k');
  assert.equal(miles(99999), '100k');
  assert.equal(miles(24694), '25k');
  assert.equal(miles(1239134), '1239k');
});

test('nombreCorto: saca el relleno y las palabras que no distinguen, y cabe en la columna', () => {
  const o = { marca: 'Nike Sportswear', nombre: 'ZAPATILLAS NIKE SPORTSWEAR AIR MAX 90 HOMBRE', ml: null };
  assert.equal(nombreCorto(o), 'NIKE AIR MAX 90');
  const g = { marca: 'Adidas Originals', nombre: 'ZAPATILLAS ADIDAS ORIGINALS SAMBA OG UNISEX', ml: null };
  assert.equal(nombreCorto(g), 'ADIDAS SAMBA OG');
});

test('nombreCorto: antepone la marca si el nombre no la trae y nunca pasa del ancho', () => {
  const o = { marca: 'Puma', nombre: 'Cali Court Lth de Mujer', ml: null };
  assert.equal(nombreCorto(o), 'PUMA CALI COURT'); // "Lth" no entra: el carácter 16 es un espacio
  for (const nombre of ['Un nombre larguísimo de producto que no entra en la columna', 'X']) {
    assert.ok(nombreCorto({ marca: '', nombre, ml: null }).length <= 17);
  }
});

test('nombreCorto: un perfume conserva su tamaño al final aunque haya que recortar el nombre', () => {
  const o = { marca: 'DIOR', nombre: 'Sauvage Eau de Toilette Intense 100 ml', ml: 100 };
  const corto = nombreCorto(o);
  assert.ok(corto.endsWith(' 100ML'), corto);
  assert.ok(corto.length <= 17, corto);
  assert.notEqual(nombreCorto({ ...o, ml: 50 }), corto, '50 y 100 ml se distinguen');
});

test('itemTabla: costo, mercado y ganancia; "~" cuando el cruce es por modelo', () => {
  const oferta = { nombre: 'ZAPATILLAS NIKE BLAZER LOW HOMBRE', marca: 'Nike', precioActual: 99999, ml: null, url: 'https://x.test/p' };
  const porEan = itemTabla(oferta, { veredicto: 'buena', precioMercado: 199999, margen: 0.9, via: 'ean' });
  assert.deepEqual([porEan.costo, porEan.mercado, porEan.gana], ['100k', '200k', '+90%']);
  const porModelo = itemTabla(oferta, { veredicto: 'buena', precioMercado: 199999, margen: 0.9, via: 'modelo' });
  assert.equal(porModelo.mercado, '~200k');
  const sinRef = itemTabla(oferta, { veredicto: 'sin-referencia' });
  assert.deepEqual([sinRef.mercado, sinRef.gana], ['—', '—']);
  assert.equal(itemTabla(oferta, { precioMercado: 100000, margen: -0.1, via: 'ean' }).gana, '-10%');
});

test('fila: todas las filas miden lo mismo (si no, las columnas no se alinean)', () => {
  const items = [
    { nombre: 'NIKE BLAZER LOW', costo: '100k', mercado: '~200k', gana: '+90%', url: 'u' },
    { nombre: 'X', costo: '9k', mercado: '12k', gana: '+5%', url: 'u' },
    { nombre: 'ADIDAS SAMBA OG', costo: '1239k', mercado: '~1500k', gana: '+300%', url: 'u' },
  ];
  const largos = items.map((it, i) => fila(i + 1, it).length);
  assert.equal(new Set(largos).size, 1, largos.join(','));
  assert.equal(largos[0], 38, 'entra en una línea de teléfono');
  assert.equal(fila(12, items[0]).length, 38, 'también con número de dos cifras');
});

// ---------- Mensajes ----------

const url = (n) => `https://www.grid.com.ar/zapatillas-nike-blazer-low-77-vintage-moda-hombre-${3000000 + n}/p`;
const item = (n, extra = {}) => ({ nombre: `NIKE MODELO ${n}`, costo: '100k', mercado: '~200k', gana: '+90%', url: url(n), ...extra });
const items = (cuantos) => Array.from({ length: cuantos }, (_, i) => item(i + 1));

test('un mensaje: título con la cantidad, leyenda, tabla en bloque de ancho fijo y los links numerados afuera', () => {
  const { mensajes, porMensaje, incluidas } = agruparTabla(items(3), { titulo: 'Ofertas Grid', maxMensajes: 5, maxCaracteres: 700, mono: true });
  assert.equal(mensajes.length, 1);
  assert.deepEqual([porMensaje, incluidas], [[3], 3]);
  const m = mensajes[0];
  assert.ok(m.startsWith('*Ofertas Grid* · 3 que valen la pena\n'));
  assert.ok(m.includes('Costo · Merc. (otra tienda) · Gana (margen). ~ = por modelo'));
  assert.equal(m.split(TRES).length - 1, 2, 'un solo bloque de ancho fijo');
  const [antes, bloque, despues] = m.split(TRES);
  assert.ok(bloque.includes('Producto') && bloque.includes('NIKE MODELO 2'));
  assert.ok(!bloque.includes('https://'), 'los links no van dentro del bloque (no serían clickeables)');
  assert.ok(despues.includes(`1) ${url(1)}\n2) ${url(2)}\n3) ${url(3)}`), 'links numerados como las filas');
  assert.ok(antes.includes('que valen la pena'));
});

test('los links se muestran enteros, sin recortar', () => {
  const largo = 'https://www.perfumeriasrouge.com/clean-reserve-limpiador-equilibrante-buriti-x80543100000/p';
  const { mensajes } = agruparTabla([item(1, { url: largo })], { titulo: 'Ofertas Rouge', maxMensajes: 1, maxCaracteres: 700, mono: true });
  assert.ok(mensajes[0].includes(`1) ${largo}`));
});

test('sin ancho fijo: filas con barras, sin bloque', () => {
  const { mensajes } = agruparTabla(items(2), { titulo: 'Ofertas Grid', maxMensajes: 1, maxCaracteres: 700, mono: false });
  assert.ok(!mensajes[0].includes(TRES));
  assert.ok(mensajes[0].includes('N | Producto | Costo | Merc. | Gana'));
  assert.ok(mensajes[0].includes('1 | NIKE MODELO 1 | 100k | ~200k | +90%'));
});

test('varios mensajes: la numeración sigue, el título de continuación va solo desde el segundo y la leyenda solo en el primero', () => {
  const { mensajes, porMensaje } = agruparTabla(items(12), { titulo: 'Ofertas Grid', maxMensajes: 10, maxCaracteres: 700, mono: true });
  assert.ok(mensajes.length >= 2);
  assert.equal(porMensaje.reduce((a, b) => a + b, 0), 12);
  assert.ok(mensajes.slice(1).every((m) => m.startsWith('*Ofertas Grid* (cont.)')));
  assert.ok(mensajes.slice(1).every((m) => !m.includes('Costo · Merc.')));
  const todo = mensajes.join('\n');
  for (let n = 1; n <= 12; n++) assert.equal(todo.split(`\n${n}) https`).length - 1, 1, `link ${n} una sola vez`);
  assert.ok(mensajes[1].includes(`\n${porMensaje[0] + 1}) ${url(porMensaje[0] + 1)}`), 'el segundo mensaje sigue la numeración');
});

test('ningún mensaje supera el largo que acepta CallMeBot', () => {
  const { mensajes } = agruparTabla(items(40), { titulo: 'Ofertas Grid', maxMensajes: 40, maxCaracteres: config.maxCaracteres, mono: true });
  for (const m of mensajes) assert.ok(largoEfectivo(m) <= config.maxCaracteres, `largo efectivo ${largoEfectivo(m)}`);
});

test('siempre entra al menos una oferta por mensaje, aunque el tope sea mínimo', () => {
  const { mensajes, porMensaje } = agruparTabla(items(3), { titulo: 'T', maxMensajes: 5, maxCaracteres: 10, mono: true });
  assert.equal(mensajes.length, 3);
  assert.deepEqual(porMensaje, [1, 1, 1]);
});

test('lo que no entra se resume como "y N más" y no se incluye', () => {
  const { mensajes, incluidas } = agruparTabla(items(20), { titulo: 'T', maxMensajes: 2, maxCaracteres: 700, mono: true });
  assert.equal(mensajes.length, 2);
  assert.ok(incluidas < 20);
  assert.ok(mensajes.at(-1).endsWith(`y ${20 - incluidas} más.`));
});

test('sin ofertas no hay mensajes', () => {
  assert.deepEqual(agruparTabla([], { titulo: 'T', maxMensajes: 3, mono: true }).mensajes, []);
});

test('el título de la primera lectura se respeta', () => {
  const { mensajes } = agruparTabla(items(2), { titulo: 'Ofertas Moov · 1ª lectura, de 505', maxMensajes: 1, maxCaracteres: 700, mono: true });
  assert.ok(mensajes[0].startsWith('*Ofertas Moov · 1ª lectura, de 505* · 2 que valen la pena'));
});

test('la tabla entra bastante más ofertas por mensaje que el formato anterior', () => {
  const ofertas = Array.from({ length: 12 }, (_, i) => ({
    marca: 'Nike', nombre: `ZAPATILLAS NIKE MODELO ${i} HOMBRE`, ml: null, precioActual: 99999, precioLista: 199999, stock: 5, url: url(i),
  }));
  const puntaje = { veredicto: 'buena', precioMercado: 199999, margen: 0.9, fuente: 'moov', via: 'modelo', demanda: null };
  const detalle = agrupar(
    ofertas.map((o) => ({ texto: formatearOferta(o, { tipo: 'sin-historial', descuento: 0.5, base: 199999, referencia: null }, { puntaje }) })),
    { titulo: 'Ofertas Grid', maxMensajes: 20, maxCaracteres: config.maxCaracteres },
  );
  const tabla = agruparTabla(ofertas.map((o) => itemTabla(o, puntaje)), { titulo: 'Ofertas Grid', maxMensajes: 20, maxCaracteres: config.maxCaracteres, mono: true });
  assert.ok(tabla.mensajes.length < detalle.mensajes.length, `tabla: ${tabla.mensajes.length} mensajes, detalle: ${detalle.mensajes.length}`);
  assert.ok(tabla.porMensaje[0] >= 4, `la tabla lleva ${tabla.porMensaje[0]} ofertas en el primer mensaje`);
  assert.ok(tabla.porMensaje[0] > detalle.porMensaje[0]);
});

test('con links reales de Grid (~72 caracteres) entran 5 ofertas por mensaje', () => {
  const reales = [
    'https://www.grid.com.ar/zapatillas-new-balance-574-moda-hombre-8311299/p',
    'https://www.grid.com.ar/zapatillas-nike-blazer-low-77-vintage-moda-hombre-3180022/p',
    'https://www.grid.com.ar/ojotas-adidas-originals-adilette-22-moda-hombre-2663410/p',
    'https://www.grid.com.ar/zapatillas-puma-cali-court-lth-moda-mujer-9680121/p',
    'https://www.grid.com.ar/zapatillas-fila-uproot-moda-hombre-4321850/p',
    'https://www.grid.com.ar/zapatillas-adidas-originals-sl-72-og-moda-mujer-2664012/p',
    'https://www.grid.com.ar/zapatillas-nike-air-force-1-07-moda-hombre-3280506/p',
  ];
  const { porMensaje, mensajes } = agruparTabla(reales.map((u, i) => item(i + 1, { url: u })), { titulo: 'Ofertas Grid', maxMensajes: 5, maxCaracteres: config.maxCaracteres, mono: true });
  assert.ok(porMensaje[0] >= 4, `primer mensaje: ${porMensaje[0]} ofertas`);
  assert.ok(mensajes.length <= 2, 'las 7 entran en dos mensajes');
  for (const m of mensajes) assert.ok(largoEfectivo(m) <= config.maxCaracteres);
});

test('configuración: tabla y solo "buena" por defecto', () => {
  assert.equal(config.formatoMensaje, 'tabla');
  assert.deepEqual(config.avisar.veredictos, ['buena']);
  assert.equal(config.tabla.monoespaciado, true);
});
