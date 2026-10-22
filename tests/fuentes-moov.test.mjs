import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { config } from '../src/config.mjs';
import * as moov from '../src/fuentes/moov.mjs';
import { crearLectorSfcc, decodificar, parsearGrilla } from '../src/fuentes/sfcc.mjs';
import { ErrorFuente } from '../src/nucleo/http.mjs';

const grilla = await readFile(new URL('./fixtures/moov-grilla.html', import.meta.url), 'utf8');

// ---------- Decodificación y parseo (fixture real) ----------

test('decodificar: entidades con nombre, decimales y hexadecimales', () => {
  assert.equal(decodificar('Zapatillas Mitchell &amp; Ness'), 'Zapatillas Mitchell & Ness');
  assert.equal(decodificar('Air Force 1 &#39;07'), "Air Force 1 '07");
  assert.equal(decodificar('Ni&ntilde;os &eacute;lite &#xF1;'), 'Niños élite ñ');
  assert.equal(decodificar('&desconocida; queda igual'), '&desconocida; queda igual');
});

test('parsearGrilla (fixture real): pid, nombre, link, precio y lista tachada', () => {
  const { productos, encontrados } = parsearGrilla(grilla);
  assert.equal(encontrados, 7);
  assert.equal(productos.length, 7);
  const por = Object.fromEntries(productos.map((p) => [p.pid, p]));
  assert.deepEqual([por.ADJI0079.nombre, por.ADJI0079.precio, por.ADJI0079.lista], ['Zapatillas adidas Superstar II Cuero', 219999, null]);
  assert.deepEqual([por.NBU204L4HH.nombre, por.NBU204L4HH.precio, por.NBU204L4HH.lista], ['Zapatillas New Balance 204L', 134999, 169999]);
  assert.deepEqual([por.ADH03472.precio, por.ADH03472.lista], [124999, 179999]);
  assert.ok(productos.every((p) => p.href.startsWith('/') && p.href.endsWith('.html')));
  assert.equal(productos.filter((p) => p.lista).length, 3);
});

test('parsearGrilla: una página vacía no tiene productos', () => {
  assert.deepEqual(parsearGrilla(''), { productos: [], encontrados: 0 });
  assert.deepEqual(parsearGrilla('<div>sin resultados</div>'), { productos: [], encontrados: 0 });
});

test('parsearGrilla: un producto sin precio se descarta pero se cuenta como encontrado', () => {
  const { productos, encontrados } = parsearGrilla('<div class="product" data-pid="X1"> <a class="link" href="/x.html" title="Algo">Algo</a> </div>');
  assert.deepEqual([productos.length, encontrados], [0, 1]);
});

// ---------- Normalización ----------

const cfg = { base: 'https://tienda.test', sitio: 'Sites-Test-Site', categorias: [{ cgid: 'hombre-calzado', genero: 'h' }, { cgid: 'mujer-calzado', genero: 'm' }], porPagina: 3, maxPaginas: 10 };
const lector = crearLectorSfcc(cfg);

test('normalizarProducto: marca, clave de modelo, género de la categoría y precio de lista', () => {
  const { productos } = parsearGrilla(grilla);
  const sup = productos.find((p) => p.pid === 'ADIH8659');
  const o = moov.normalizarProducto(sup, { genero: 'h' });
  assert.deepEqual(
    [o.id, o.marca, o.nombre, o.precioActual, o.precioLista, o.stock, o.genero, o.categoria],
    ['ADIH8659', 'Adidas', 'Zapatillas adidas Superstar II', 219999, 219999, 99999, 'h', 'Calzado'],
  );
  assert.equal(o.modelo, 'adidas|ii superstar');
  assert.equal(o.url, `https://www.moov.com.ar${sup.href}`);
  assert.equal(o.ean, null);
});

test('normalizarProducto: con lista tachada, la lista es la tachada', () => {
  const { productos } = parsearGrilla(grilla);
  const o = moov.normalizarProducto(productos.find((p) => p.pid === 'ADH03472'), { genero: 'h' });
  assert.deepEqual([o.precioActual, o.precioLista], [124999, 179999]);
});

test('el género del nombre manda sobre el de la categoría', () => {
  const o = lector.normalizarProducto({ pid: 'Z1', href: '/z.html', nombre: 'Zapatillas Nike Shox NZ Mujer', precio: 10, lista: null }, { genero: 'h' });
  assert.equal(o.genero, 'm');
});

test('un producto de marca desconocida se lee igual, sin clave de modelo', () => {
  const o = lector.normalizarProducto({ pid: 'Z2', href: '/z.html', nombre: 'Zapatillas ON Cloudtilt Hombre', precio: 10, lista: null }, { genero: 'h' });
  assert.deepEqual([o.marca, o.modelo], ['', null]);
});

// ---------- Lectura ----------

const tile = (pid, nombre, precio, lista) => `<div class="product" data-pid="${pid}"> <div class="product-tile"> <a class="link" href="/${pid}.html" title="${nombre}">${nombre}</a> <div class="prices"> <span class="sales"> <span class="value" content="${precio}.00" data-js-marketing-price/> $${precio} </span>${lista ? ` <del> <span class="strike-through list"> <span class="value" content="${lista}.00"> $${lista} </span> </span> </del>` : ''} </span> </div> </div> </div>`;

/** Cliente falso: `paginas[cgid]` es la lista de páginas HTML que devuelve cada categoría; una de más devuelve vacío. */
function clienteFalso(paginas, fallar = () => null) {
  const pedidos = [];
  return {
    pedidos,
    cliente: {
      async obtenerTexto(url) {
        pedidos.push(url);
        const u = new URL(url);
        assert.ok(u.pathname.includes('/Sites-Test-Site/'));
        const cgid = u.searchParams.get('cgid');
        const inicio = Number(u.searchParams.get('start'));
        const error = fallar(cgid, inicio);
        if (error) throw error;
        return { datos: (paginas[cgid] ?? [])[inicio / 3] ?? '' };
      },
    },
  };
}
const pagina = (...tiles) => tiles.join('\n');

test('pagina hasta una página incompleta y arma las ofertas con el género de cada categoría', async () => {
  const { cliente, pedidos } = clienteFalso({
    'hombre-calzado': [pagina(tile('A1', 'Zapatillas Nike Air Max 90', 100), tile('A2', 'Zapatillas Nike Air Max 97', 200), tile('A3', 'Zapatillas Nike Dunk Low', 300)), pagina(tile('A4', 'Zapatillas Puma Suede', 400))],
    'mujer-calzado': [pagina(tile('B1', 'Zapatillas Nike Air Max 90', 110))],
  });
  const { ofertas, informe } = await lector.leerCatalogo(cliente);
  assert.equal(ofertas.length, 5);
  assert.equal(pedidos.length, 3, 'hombre: página llena + página incompleta; mujer: una página incompleta');
  assert.deepEqual(ofertas.filter((o) => o.id.startsWith('A')).map((o) => o.genero), ['h', 'h', 'h', 'h']);
  assert.equal(ofertas.find((o) => o.id === 'B1').genero, 'm');
  assert.equal(informe.productosLeidos, 5);
  assert.equal(informe.conModelo, 5);
  assert.deepEqual(informe.truncados, []);
});

test('si la última página viene justa, la siguiente vacía la cierra', async () => {
  const { cliente, pedidos } = clienteFalso({
    'hombre-calzado': [pagina(tile('A1', 'Zapatillas Nike Air Max 90', 100), tile('A2', 'Zapatillas Nike Air Max 97', 200), tile('A3', 'Zapatillas Nike Dunk Low', 300))],
  });
  const chico = crearLectorSfcc({ ...cfg, categorias: [{ cgid: 'hombre-calzado', genero: 'h' }] });
  const { ofertas } = await chico.leerCatalogo(cliente);
  assert.equal(ofertas.length, 3);
  assert.equal(pedidos.length, 2);
});

test('un producto que figura en dos categorías se registra una sola vez', async () => {
  const { cliente } = clienteFalso({
    'hombre-calzado': [pagina(tile('U1', 'Zapatillas Nike Shox NZ Unisex', 100))],
    'mujer-calzado': [pagina(tile('U1', 'Zapatillas Nike Shox NZ Unisex', 100))],
  });
  const { ofertas } = await lector.leerCatalogo(cliente);
  assert.equal(ofertas.length, 1);
});

test('una página que falla tras los reintentos deja la lectura parcial y se conserva lo leído', async () => {
  const { cliente } = clienteFalso({
    'hombre-calzado': [pagina(tile('A1', 'Zapatillas Nike Air Max 90', 100), tile('A2', 'Zapatillas Nike Air Max 97', 200), tile('A3', 'Zapatillas Nike Dunk Low', 300))],
    'mujer-calzado': [pagina(tile('B1', 'Zapatillas Nike Air Max 90', 110))],
  }, (cgid, inicio) => (cgid === 'hombre-calzado' && inicio === 3 ? new ErrorFuente('servidor', 'Error 500', { status: 500 }) : null));
  const { ofertas, informe } = await lector.leerCatalogo(cliente);
  assert.equal(ofertas.length, 4);
  assert.deepEqual(informe.parciales.map((p) => [p.categoria, p.desde]), [['hombre-calzado', 3]]);
});

test('un bloqueo (429) corta todo; si no se pudo leer nada se informa el error real', async () => {
  const bloqueado = { async obtenerTexto() { throw new ErrorFuente('bloqueo', 'x', { status: 429 }); } };
  await assert.rejects(lector.leerCatalogo(bloqueado), (e) => e.tipo === 'bloqueo');
  const caido = { async obtenerTexto() { throw new ErrorFuente('servidor', 'Error 500', { status: 500 }); } };
  await assert.rejects(lector.leerCatalogo(caido), (e) => e.tipo === 'servidor');
});

test('si el HTML cambia (hay productos pero no se les lee el precio) falla a la vista', async () => {
  const roto = '<div class="product" data-pid="A1"> <p>otro formato</p> </div>\n<div class="product" data-pid="A2"> <p>otro formato</p> </div>';
  const { cliente } = clienteFalso({ 'hombre-calzado': [roto] });
  await assert.rejects(lector.leerCatalogo(cliente), (e) => e instanceof ErrorFuente && e.tipo === 'respuesta_invalida' && /cambió de formato/.test(e.message));
});

test('un catálogo sin productos falla en vez de devolver cero ofertas', async () => {
  const { cliente } = clienteFalso({});
  await assert.rejects(lector.leerCatalogo(cliente), (e) => e.tipo === 'respuesta_invalida');
});

test('si se alcanza el tope de páginas, lo informa', async () => {
  const llena = (n) => pagina(tile(`P${n}a`, `Zapatillas Nike Air Max ${n}`, 100), tile(`P${n}b`, `Zapatillas Nike Dunk ${n}`, 100), tile(`P${n}c`, `Zapatillas Nike Shox ${n}`, 100));
  const { cliente } = clienteFalso({ 'hombre-calzado': [llena(1), llena(2), llena(3)] });
  const corto = crearLectorSfcc({ ...cfg, maxPaginas: 2, categorias: [{ cgid: 'hombre-calzado', genero: 'h' }] });
  const { ofertas, informe } = await corto.leerCatalogo(cliente);
  assert.equal(ofertas.length, 6);
  assert.equal(informe.truncados.length, 1);
});

// ---------- Configuración ----------

test('configuración de Moov coherente con el sitio', () => {
  const c = config.fuentes.moov;
  assert.equal(c.sitio, 'Sites-Moov-Site');
  assert.deepEqual(c.categorias.map((x) => [x.cgid, x.genero]), [['hombre-calzado', 'h'], ['mujer-calzado', 'm']]);
  assert.ok(c.porPagina === 48 && c.maxPaginas * c.porPagina >= 960, 'alcanza para las categorías relevadas');
});

// ---------- Un producto que figura en hombre y en mujer es unisex ----------

test('un producto en las dos categorías, sin género en el nombre, queda unisex', async () => {
  const { cliente } = clienteFalso({
    'hombre-calzado': [pagina(tile('S1', 'Zapatillas adidas Superstar II', 100))],
    'mujer-calzado': [pagina(tile('S1', 'Zapatillas adidas Superstar II', 100))],
  });
  const { ofertas } = await lector.leerCatalogo(cliente);
  assert.equal(ofertas.length, 1);
  assert.equal(ofertas[0].genero, 'u');
});

test('si el nombre dice el género, no se pisa aunque aparezca en otra categoría', async () => {
  const { cliente } = clienteFalso({
    'hombre-calzado': [pagina(tile('S2', 'Zapatillas Nike Shox NZ Hombre', 100))],
    'mujer-calzado': [pagina(tile('S2', 'Zapatillas Nike Shox NZ Hombre', 100))],
  });
  const { ofertas } = await lector.leerCatalogo(cliente);
  assert.equal(ofertas[0].genero, 'h');
});

test('un producto que está en una sola categoría conserva el género de esa categoría', async () => {
  const { cliente } = clienteFalso({
    'hombre-calzado': [pagina(tile('S3', 'Zapatillas Puma Suede Classic', 100))],
    'mujer-calzado': [pagina(tile('S4', 'Zapatillas Puma Cali Court', 100))],
  });
  const { ofertas } = await lector.leerCatalogo(cliente);
  assert.deepEqual(ofertas.map((o) => [o.id, o.genero]), [['S3', 'h'], ['S4', 'm']]);
});
