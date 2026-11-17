import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearHistorial, registrar } from '../src/nucleo/historial.mjs';
import { bajaReal, ordenarParaConsultar, relacionPorMarca } from '../src/nucleo/prioridad.mjs';

const producto = (id, marca, precioActual, precioLista) => ({ id, marca, nombre: `P${id}`, precioActual, precioLista, stock: 1, url: 'u' });

function historialCon(dias) {
  const h = crearHistorial();
  for (const [fecha, productos] of dias) for (const p of productos) registrar(h, p, fecha);
  return h;
}

test('bajaReal: contra el menor precio de los días anteriores, no contra el precio de lista', () => {
  const h = historialCon([
    ['2026-10-25', [producto('1', 'A', 250000, 300000), producto('2', 'A', 150000, 300000)]],
    ['2026-11-02', [producto('1', 'A', 150000, 300000), producto('2', 'A', 150000, 300000)]],
  ]);
  assert.equal(bajaReal(h.productos['1'], 150000, '2026-11-02'), 0.4, 'bajó de 250k a 150k: baja real');
  assert.equal(bajaReal(h.productos['2'], 150000, '2026-11-02'), 0, 'siempre costó 150k: el "-50 %" es falso');
  assert.equal(bajaReal(undefined, 150000, '2026-11-02'), null);
});

test('relacionPorMarca: costo ÷ precio de EE. UU., mediana por marca', () => {
  const r = relacionPorMarca([
    { oferta: { marca: 'Calvin Klein', precioActual: 130000 }, precio: 100000 },
    { oferta: { marca: 'CALVIN KLEIN', precioActual: 150000 }, precio: 100000 },
    { oferta: { marca: 'Viktor&Rolf', precioActual: 70000 }, precio: 100000 },
  ]);
  assert.equal(r.get('calvin klein'), 1.4);
  assert.equal(r.get('viktor rolf'), 0.7);
});

test('ordenarParaConsultar: caché primero; después baja real y marca, no el descuento declarado', async () => {
  const h = historialCon([
    ['2026-10-25', [producto('falso', 'CK', 100000, 200000), producto('real', 'Otra', 200000, 220000), producto('ck2', 'CK', 120000, 240000)]],
    ['2026-11-02', [producto('falso', 'CK', 100000, 200000), producto('real', 'Otra', 120000, 220000), producto('ck2', 'CK', 120000, 240000)]],
  ]);
  const g = (id, marca, actual, descuento) => ({ oferta: { id, marca, precioActual: actual }, evaluacion: { descuento } });
  const gangas = [
    g('falso', 'CK', 100000, 0.5),      // "-50 %" pero siempre costó lo mismo
    g('real', 'Otra', 120000, 0.45),    // bajó de 200k a 120k
    g('nuevo', 'Otra', 50000, 0.6),     // sin días anteriores: cuenta la mitad del descuento (0,3)
    g('ck2', 'CK', 120000, 0.5),        // ya en caché: CK sale 1,5 veces lo de EE. UU.
  ];
  const enCache = async (o) => (o.id === 'ck2' ? { estado: 'ok', precio: 80000 } : null);
  const { orden, relacion } = await ordenarParaConsultar(gangas, { historial: h, fecha: '2026-11-02', enCache });
  assert.deepEqual(orden.map((x) => x.oferta.id), ['ck2', 'real', 'nuevo', 'falso']);
  assert.equal(relacion.get('ck'), 1.5);
  assert.equal(gangas[3].ebay.precio, 80000, 'la cacheada ya queda resuelta');
});

test('puntajeAviso: margen por confianza en las ventas (pedido del usuario, 2026-11-05)', async () => {
  const { puntajeAviso } = await import('../src/nucleo/prioridad.mjs');
  const ofertas = [
    { n: 'The Move', margen: 0.14, ventas: 0 },
    { n: 'Fuel for Life', margen: 0.09, ventas: 174 },
    { n: 'Zuecos', margen: 0.36, ventas: 3 },
    { n: 'Botitas', margen: 0.28, ventas: 26 },
    { n: 'Yeezy', margen: 3.11, ventas: 21 },
  ];
  const orden = ofertas.sort((a, b) => puntajeAviso(b) - puntajeAviso(a)).map((o) => o.n);
  assert.deepEqual(orden, ['Yeezy', 'Botitas', 'Zuecos', 'Fuel for Life', 'The Move']);
  assert.equal(puntajeAviso({ margen: 0.5, ventas: 0 }), 0, 'sin ventas no suma');
  assert.equal(puntajeAviso({ margen: 0.4, ventas: undefined }), 0.2, 'sin dato: confianza media');
});

test('pasaFiltroAviso: margen y ventas mínimas, y solo las marcas o modelos de la lista', async () => {
  const { pasaFiltroAviso } = await import('../src/nucleo/prioridad.mjs');
  const cfg = { margenMinimo: 0.30, ventasMinimas: 10, soloTerminos: [] };
  const superstar = { oferta: { marca: 'adidas', nombre: 'Zapatillas Adidas Superstar' }, margen: 1.06, ventas: 17 };
  assert.equal(pasaFiltroAviso(superstar, cfg), true);
  assert.equal(pasaFiltroAviso({ ...superstar, margen: 0.16 }, cfg), false, 'margen chico');
  assert.equal(pasaFiltroAviso({ ...superstar, ventas: 4 }, cfg), false, 'pocas ventas');
  assert.equal(pasaFiltroAviso({ ...superstar, ventas: undefined }, cfg), false, 'sin dato de ventas');
  assert.equal(pasaFiltroAviso(superstar, { ...cfg, soloTerminos: ['jordan', 'samba'] }), false);
  assert.equal(pasaFiltroAviso(superstar, { ...cfg, soloTerminos: ['superstar'] }), true);
  const ch = { oferta: { marca: 'Carolina Herrera', nombre: 'Bad Boy EDT 100 ml' }, margen: 0.4, ventas: 50 };
  assert.equal(pasaFiltroAviso(ch, { ...cfg, soloTerminos: ['carolina herrera'] }), true);
  assert.equal(pasaFiltroAviso(ch, { ...cfg, soloTerminos: ['herrer'] }), false, 'palabras enteras');
  assert.equal(pasaFiltroAviso(superstar, {}), true, 'sin filtro');
});

test('esDeMujer: por género de la tienda o por el nombre; unisex y hombre se quedan', async () => {
  const { esDeMujer } = await import('../src/nucleo/prioridad.mjs');
  const { generoDeCategorias } = await import('../src/fuentes/vtex.mjs');
  assert.equal(generoDeCategorias(['/Fragancias/Premium/Femeninas/', '/Fragancias/']), 'm');
  assert.equal(generoDeCategorias(['/Perfumes y fragancias/Perfumes de hombre/']), 'h');
  assert.equal(generoDeCategorias(['/Perfume/Unisex/']), 'u');
  assert.equal(generoDeCategorias(['/Calzado/Zapatillas/']), null);
  assert.equal(esDeMujer({ nombre: 'Good Girl EDP 80 ml', genero: 'm' }), true);
  assert.equal(esDeMujer({ nombre: 'ZAPATILLAS NIKE CORTEZ MUJER' }), true);
  assert.equal(esDeMujer({ nombre: 'Lady Million EDP' }), true);
  assert.equal(esDeMujer({ nombre: 'Carolina Herrera Bad Boy EDT' }), false, '"Herrera" no es "her"');
  assert.equal(esDeMujer({ nombre: 'Zapatillas Adidas Superstar', genero: 'u' }), false);
  assert.equal(esDeMujer({ nombre: 'CK One EDT', genero: 'u' }), false);
});

test('pasaFiltroAviso: las ventas mínimas valen para zapatillas y ropa, no para perfumes (2026-11-17)', async () => {
  const { pasaFiltroAviso } = await import('../src/nucleo/prioridad.mjs');
  const cfg = { margenMinimo: 0.05, ventasMinimas: 5 };
  const perfume = { oferta: { marca: 'Mercedes-Benz', nombre: 'The Move EDT 100 ml' }, margen: 0.10, ventas: 0, via: 'ean' };
  assert.equal(pasaFiltroAviso(perfume, cfg), true, 'perfume con 0 ventas pasa si es más barato que eBay');
  assert.equal(pasaFiltroAviso({ ...perfume, margen: 0.02 }, cfg), false, 'pero con margen mínimo');
  assert.equal(pasaFiltroAviso({ ...perfume, via: 'codigo' }, cfg), false, 'zapatilla con 0 ventas no pasa');
  assert.equal(pasaFiltroAviso({ ...perfume, via: 'codigo', ventas: 5 }, cfg), true);
});

test('ordenarParaConsultar: sin baja real, el mayor descuento declarado se consulta primero (2026-11-18)', async () => {
  const h = historialCon([
    ['2026-10-25', [producto('a', 'X', 100000, 200000), producto('b', 'Y', 100000, 130000), producto('c', 'Z', 100000, 160000)]],
    ['2026-11-02', [producto('a', 'X', 100000, 200000), producto('b', 'Y', 100000, 130000), producto('c', 'Z', 100000, 160000)]],
  ]);
  const g = (id, marca, descuento) => ({ oferta: { id, marca, precioActual: 100000 }, evaluacion: { descuento } });
  const { orden } = await ordenarParaConsultar([g('b', 'Y', 0.23), g('a', 'X', 0.5), g('c', 'Z', 0.37)], { historial: h, fecha: '2026-11-02', enCache: async () => null });
  assert.deepEqual(orden.map((x) => x.oferta.id), ['a', 'c', 'b'], 'todas con baja real 0: manda el descuento declarado');
});

test('pasaPerfil: perfumes de diseñador o nacionales; calzado de las marcas elegidas; sin rendimiento (2026-11-18)', async () => {
  const { pasaPerfil } = await import('../src/nucleo/prioridad.mjs');
  const { config } = await import('../src/config.mjs');
  const perfil = config.avisar.perfil;
  const perfume = (marca, nombre = 'EDP 100 ml') => pasaPerfil({ marca, nombre }, { esPerfumeria: true, perfil });
  assert.ok(perfume('Carolina Herrera') && perfume('RABANNE') && perfume('BANDERAS') && perfume('Adolfo Dominguez'), 'diseñador');
  assert.ok(perfume('Cher') && perfume('Caro Cuore') && perfume('Ciel'), 'nacionales');
  assert.ok(!perfume('Lattafa') && !perfume('Hamidi') && !perfume('Shakira') && !perfume('David Beckham'), 'árabes de nicho y celebrities, no');
  const z = (marca, nombre) => pasaPerfil({ marca, nombre }, { perfil });
  assert.ok(z('Nike Sportswear', 'ZAPATILLAS NIKE SPORTSWEAR DUNK LOW RETRO HOMBRE'), 'Nike lifestyle');
  assert.ok(z('Jordan', 'ZAPATILLAS AIR JORDAN 1 LOW') && z('Adidas Originals', 'Zapatillas adidas Samba OG') && z('Puma', 'Zapatillas Puma Suede Classic'));
  assert.ok(z('New Balance', 'Zapatillas New Balance 550') && z('Converse', 'Zapatillas Converse Star Player 76') && z('Vans', 'Zapatillas Vans Classic Slip-On'));
  assert.ok(!z('Topper', 'Zapatillas Topper Leroi King of the Kongo') && !z('Fila', 'Zapatillas Fila Arcade Low') && !z('Reebok', 'Zapatillas Reebok Premier Road'), 'otras marcas de calzado, no');
  assert.ok(!z('Nike', 'Zapatillas Running Nike Air Zoom Pegasus 40') && !z('Adidas Performance', 'Zapatillas adidas Galaxy 7 de Hombre'), 'running');
  assert.ok(!z('Adidas', 'Botines Futbol Adidas Predator Elite Fg'), 'botines');
  assert.ok(z('Mitchell & Ness', 'CAMISETA MITCHELL & NESS CHICAGO BULLS 1996') && !z('Nike', 'CALZA JORDAN DRI-FIT SPORT HOMBRE'), 'ropa de estilo sí, técnica no');
  assert.equal(pasaPerfil({ marca: 'X', nombre: 'Zapatillas Topper' }, {}), true, 'sin perfil, todo pasa');
});
