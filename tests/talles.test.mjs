import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluarTalles } from '../src/nucleo/talles.mjs';
import { agruparTabla, itemTabla } from '../src/notificar/tabla.mjs';
import { tallesDePagina } from '../src/fuentes/sfcc.mjs';

test('evaluarTalles: Yeezy con solo 34,5 y 35,5 (hombre) se marca', () => {
  assert.deepEqual(evaluarTalles([{ t: '34.5' }, { t: '35.5' }], 'h'), { texto: '⚠ talles 34.5, 35.5', alerta: true });
});

test('evaluarTalles: talles comerciales con stock no se marcan; pocas unidades sí', () => {
  assert.deepEqual(evaluarTalles([{ t: '43' }, { t: '43.5' }, { t: '44' }], 'h'), { texto: 'talles 43, 43.5, 44', alerta: false });
  assert.deepEqual(evaluarTalles([{ t: '39', us: '7', u: 1 }], 'h'), { texto: '⚠ talles 39 (1 u.)', alerta: true }, 'Blazer de Grid: queda 1');
  assert.equal(evaluarTalles([{ t: '40', u: 5 }, { t: '41', u: 3 }], 'h').alerta, false);
  assert.equal(evaluarTalles([{ t: '37', u: 4 }], 'm').alerta, false, 'mujer: 37 es comercial');
  assert.equal(evaluarTalles([{ t: '44', u: 4 }], 'm').alerta, true, 'mujer: 44 no');
});

test('evaluarTalles: ropa por letras, muchos talles y casos sin datos', () => {
  assert.equal(evaluarTalles([{ t: 'S', u: 3 }, { t: 'M', u: 4 }], 'h').alerta, false);
  const muchos = ['36', '37', '38', '39', '40', '41', '42', '43'].map((t) => ({ t, u: 3 }));
  assert.equal(evaluarTalles(muchos, 'h').texto, 'talles 36 a 43 (8 talles)');
  assert.equal(evaluarTalles(null, 'h'), null, 'la tienda no informa talles: no se dice nada');
  assert.deepEqual(evaluarTalles([], 'h'), { texto: 'sin talles con stock', alerta: true });
});

test('aviso: los talles van en la línea del link, antes de la URL', () => {
  const oferta = { nombre: 'Zapatillas adidas Yeezy Boost 350 V2', precioActual: 89999, url: 'https://moov/yeezy', genero: 'h', talles: [{ t: '34.5' }, { t: '35.5' }] };
  const item = itemTabla(oferta, { precioMercado: 370000, margen: 3.11, via: 'codigo' });
  const { mensajes } = agruparTabla([item], { titulo: 'Ofertas Moov', mono: true });
  assert.match(mensajes[0], /1\) ⚠ talles 34\.5, 35\.5 · https:\/\/moov\/yeezy/);
  const sinTalles = itemTabla({ ...oferta, talles: undefined }, { precioMercado: 1, margen: 0, via: 'ean' });
  assert.match(agruparTabla([sinTalles], { titulo: 'X', mono: true }).mensajes[0], /1\) https:\/\/moov\/yeezy/);
});

test('tallesDePagina (Moov/SFCC): solo los seleccionables', () => {
  const html = '&quot;id&quot;:&quot;size&quot;,&quot;values&quot;:[{&quot;displayValue&quot;:&quot;34.5&quot;,&quot;selectable&quot;:true},'
    + '{&quot;displayValue&quot;:&quot;36&quot;,&quot;selectable&quot;:false},{&quot;displayValue&quot;:&quot;35.5&quot;,&quot;selectable&quot;:true}]}';
  assert.deepEqual(tallesDePagina(html), [{ t: '34.5' }, { t: '35.5' }]);
  assert.equal(tallesDePagina('<html>sin producto</html>'), null);
});
