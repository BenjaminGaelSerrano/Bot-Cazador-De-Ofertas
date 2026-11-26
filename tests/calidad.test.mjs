import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composicionDe, lineaCalidad, nivelDeMarca } from '../src/nucleo/calidad.mjs';
import { esParaHombre } from '../src/nucleo/locales.mjs';
import { itemTarjeta, tarjeta } from '../src/notificar/tarjetas.mjs';

test('composicionDe: toma los porcentajes que publica la tienda, en los formatos reales', () => {
  assert.equal(composicionDe('"Material":["74% ALGODÓN, 23% POLIÉSTER, 3% ELASTANO"]'), '74% algodón, 23% poliéster, 3% elastano');
  assert.equal(composicionDe('• 100% ALGODÓN PIMA • Lavar con agua fría'), '100% algodón pima');
  assert.equal(composicionDe('Composici&oacute;n: 100 % poli&eacute;ster.'), '100% poliéster');
  assert.equal(composicionDe('Cotton 95%, Elastane 5%'), '95% algodón, 5% elastano');
  assert.equal(composicionDe('<p>con un 8% de elastano</p>'), '8% elastano');
  assert.equal(composicionDe(`100% algodón. ${'Texto largo sobre el diseño de la prenda. '.repeat(3)}Forro: 100% poliéster`), '100% algodón', 'solo la primera tanda');
});

test('composicionDe: no confunde descuentos ni inventa', () => {
  assert.equal(composicionDe('30% OFF en toda la tienda'), null);
  assert.equal(composicionDe('Remera de algodón suave'), null);
  assert.equal(composicionDe(''), null);
});

test('nivelDeMarca y lineaCalidad: sin datos de la marca no se opina', () => {
  assert.equal(nivelDeMarca('Adidas Originals'), 'media');
  assert.equal(nivelDeMarca('Tommy Hilfiger'), 'alta');
  assert.equal(nivelDeMarca('KEY BISCAYNE'), null);
  assert.equal(lineaCalidad({ marca: 'La Martina', composicion: '100% algodón' }), 'Marca: alta · 100% algodón');
  assert.equal(lineaCalidad({ marca: 'Frères' }), 'composición no publicada');
});

test('tarjeta: la línea de calidad aparece solo si viene', () => {
  const base = { nombre: 'Remera', url: 'https://x/p', precioActual: 1000, talles: null };
  const con = tarjeta(1, itemTarjeta({ ...base, calidad: 'Marca: media · 100% algodón' }, {}));
  assert.match(con, /Marca: media · 100% algodón/);
  assert.doesNotMatch(tarjeta(1, itemTarjeta(base, {})), /Marca:/);
});

test('Tommy: los códigos de mujer y de chicos quedan afuera', () => {
  const t = (cod) => esParaHombre({ nombre: 'Remera con logo', url: `https://ar.tommy.com/remera-con-logo-${cod}/p` });
  assert.ok(!t('dw0dw16185ybr') && !t('kn0kn01514dw5') && !t('ww0ww12345abc'));
  assert.ok(t('dm0dm12345c87') && t('mw0mw30422dw5'));
});
