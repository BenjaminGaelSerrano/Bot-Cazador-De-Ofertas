import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claveModelo, compatibles } from '../src/nucleo/modelo.mjs';

const clave = (marca, nombre, gen) => claveModelo(marca, nombre, gen).clave;

// Pares reales Grid <-> Moov que el prototipo del 2026-10-22 emparejó (y que se revisaron a mano).
const PARES = [
  ['Adidas Originals', 'ZAPATILLAS ADIDAS ORIGINALS SUPERSTAR II HOMBRE', '', 'Zapatillas adidas Superstar II'],
  ['Adidas Originals', 'ZAPATILLAS ADIDAS ORIGINALS SAMBA OG', '', 'Zapatillas Urbanas adidas Samba OG Hombre'],
  ['Nike Sportswear', "ZAPATILLAS NIKE SPORTSWEAR AIR FORCE 1 '07 HOMBRE", '', "Zapatillas Nike Air Force 1 '07 Hombre"],
  ['Nike Sportswear', 'Zapatillas Nike Sportswear AIR FORCE 1 07 HOMBRE', '', "Zapatillas Nike Air Force 1 '07 Hombre"],
  ['New Balance', 'ZAPATILLAS NEW BALANCE 204L UNISEX', '', 'Zapatillas New Balance 204L'],
  ['Adidas Originals', 'Zapatillas Adidas Originals CAMPUS 00S HOMBRE', '', 'Zapatillas adidas Campus 00s Hombre'],
  ['Puma', 'ZAPATILLAS PUMA PUMA-180 PRO HOMBRE', '', 'Zapatillas Puma Puma-180 Pro'],
  ['Adidas Originals', 'ZAPATILLAS ADIDAS ORIGINALS FORUM LOW CL HOMBRE', '', 'Zapatillas adidas Forum Low CL Hombre'],
  ['Nike Sportswear', 'ZAPATILLAS NIKE SHOX NZ HOMBRE', '', 'Zapatillas Nike Shox NZ Hombre'],
  ['Jordan', 'Zapatillas AIR JORDAN 1 LOW HOMBRE', '', 'Zapatillas Jordan Air 1 Low de Hombre'],
  ['Adidas Originals', 'ZAPATILLAS ADIDAS ORIGINALS SAMBA XLG HOMBRE', '', 'Zapatillas adidas Samba XLG'],
];

test('los pares reales de Grid y Moov generan la misma clave', () => {
  for (const [marcaA, nombreA, marcaB, nombreB] of PARES) {
    const a = clave(marcaA, nombreA);
    const b = clave(marcaB, nombreB);
    assert.ok(a, `sin clave: ${nombreA}`);
    assert.equal(a, b, `${nombreA}  vs  ${nombreB}`);
  }
});

test('modelos distintos NO se emparejan (conservador)', () => {
  const casos = [
    ['Zapatillas adidas Superstar II', 'Zapatillas adidas Superstar II Cuero'],
    ['Zapatillas adidas Samba OG', 'Zapatillas adidas Samba XLG'],
    ["Zapatillas Nike Air Force 1 '07", 'Zapatillas Nike Air Force 1 Shadow'],
    ['Zapatillas Puma Puma-180 Pro', 'Zapatillas Puma Puma-180'],
    ['Zapatillas Nike Air Max 90', 'Zapatillas Nike Air Max 97'],
  ];
  for (const [a, b] of casos) assert.notEqual(clave('', a), clave('', b), `${a} vs ${b}`);
});

test('la misma palabra con otra marca no empareja', () => {
  assert.notEqual(clave('', 'Zapatillas Nike Classic'), clave('', 'Zapatillas Puma Classic'));
});

test('la marca puede venir del campo marca o del nombre', () => {
  assert.equal(clave('Nike Sportswear', 'Riñonera HERITAGE UNISEX'), clave('', 'Riñonera Nike Heritage'));
});

test('sin marca conocida no hay clave', () => {
  assert.equal(clave('', 'Zapatillas ON Cloudtilt Hombre CloudTec'), null);
  assert.equal(clave('Marca Rara', 'Zapatillas Modelo Uno'), null);
});

test('si el nombre es solo la marca y palabras genéricas no hay clave', () => {
  assert.equal(clave('Nike', 'ZAPATILLAS NIKE HOMBRE'), null);
});

test('nombre de la marca para mostrar', () => {
  assert.equal(claveModelo('', 'Zapatillas adidas Samba OG').nombreMarca, 'Adidas');
  assert.equal(claveModelo('New Balance', 'ZAPATILLAS NEW BALANCE 574').nombreMarca, 'New Balance');
  assert.equal(claveModelo('', 'Zapatillas Marca Rara 1').nombreMarca, null);
});

test('género: del nombre, o de la categoría si el nombre no lo dice', () => {
  assert.equal(claveModelo('', 'Zapatillas Nike Shox NZ Hombre').genero, 'h');
  assert.equal(claveModelo('', 'ZAPATILLAS NIKE AIR FORCE 1 07 DE MUJER').genero, 'm');
  assert.equal(claveModelo('', 'Zapatillas New Balance 204L UNISEX').genero, 'u');
  assert.equal(claveModelo('', 'ZAPATILLAS NIKE DUNK LOW NIÑOS').genero, 'n');
  assert.equal(claveModelo('', 'Zapatillas adidas Superstar II').genero, null);
  assert.equal(claveModelo('', 'Zapatillas adidas Superstar II', 'h').genero, 'h');
  assert.equal(claveModelo('', 'Zapatillas adidas Superstar II Mujer', 'h').genero, 'm', 'el nombre manda sobre la categoría');
});

test('el género no cambia la clave (se compara aparte)', () => {
  assert.equal(clave('Nike', 'ZAPATILLAS NIKE SHOX NZ HOMBRE'), clave('Nike', 'ZAPATILLAS NIKE SHOX NZ MUJER'));
});

test('compatibles: mismo género o unisex; un género desconocido NO es un comodín', () => {
  assert.equal(compatibles('h', 'h'), true);
  assert.equal(compatibles('h', 'm'), false);
  assert.equal(compatibles('h', 'n'), false);
  assert.equal(compatibles('u', 'm'), true);
  assert.equal(compatibles('h', 'u'), true);
  assert.equal(compatibles(null, null), true, 'dos desconocidos sí');
  assert.equal(compatibles(null, undefined), true);
  assert.equal(compatibles(null, 'm'), false, 'desconocido contra conocido: no');
  assert.equal(compatibles('h', undefined), false);
  assert.equal(compatibles(null, 'u'), true, 'unisex con cualquiera, incluso con desconocido');
});

test('acentos, apóstrofos y símbolos no cambian la clave', () => {
  assert.equal(clave('', "Zapatillas Nike Air Force 1 '07"), clave('', 'Zapatillas Nike Air Force 1 07'));
  assert.equal(clave('', 'Zapatillas Converse Chuck Taylor All Star'), clave('', 'ZAPATILLAS CONVERSE CHUCK TAYLOR ALL STAR'));
  assert.equal(clave('', 'Zapatillas Mitchell & Ness Champs'), clave('', 'ZAPATILLAS MITCHELL NESS CHAMPS'));
});

test('el orden de las palabras no importa', () => {
  assert.equal(clave('', 'Zapatillas Puma Mayze Lux'), clave('', 'Zapatillas Puma Lux Mayze'));
});
