import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agruparTarjetas, itemTarjeta, nombreLindo, paraWhatsapp, tarjeta } from '../src/notificar/tarjetas.mjs';
import { aHtml } from '../src/notificar/telegram.mjs';

const superstar = {
  nombre: 'Zapatillas Adidas Superstar', url: 'https://www.moov.com.ar/zapatillas-adidas-superstar/ADEG4957.html', precioActual: 54999,
  genero: 'h', color: 'Negro', vendidas: 17, talles: [{ t: '43.5' }],
};
const puntaje = { precioMercado: 113000, margen: 1.06, via: 'codigo' };

test('nombreLindo: sin mayúsculas sostenidas, sin "Zapatillas Running" ni códigos pegados', () => {
  assert.equal(nombreLindo('ZAPATILLAS NIKE SPORTSWEAR CORTEZ HOMBRE'), 'Nike Cortez Hombre');
  assert.equal(nombreLindo('Zapatillas Running Nike Air Zoom Pegasus 40 Hombre'), 'Nike Air Zoom Pegasus 40 Hombre');
  assert.equal(nombreLindo('Musculosa Adidas Adizero F De Hombre 6jy8623 000'), 'Musculosa Adidas Adizero F De Hombre');
  assert.equal(nombreLindo('Majestic Rose EDP X6291107454856'), 'Majestic Rose EDP');
  assert.equal(nombreLindo('Diavolo EDT 100 Ml'), 'Diavolo EDT 100 Ml');
});

test('tarjeta: nombre con link, acá → eBay, ahorro, ventas y color · talles', () => {
  const item = itemTarjeta(superstar, puntaje);
  assert.equal(tarjeta(1, item), '*1. [Adidas Superstar](https://www.moov.com.ar/zapatillas-adidas-superstar/ADEG4957.html)*\n$55k → $113k · *+106%* · 17 vendidas\nNegro · talle 43.5');
  const yeezy = itemTarjeta({ ...superstar, nombre: 'Yeezy 350', color: 'Celeste', talles: [{ t: '34.5' }, { t: '35.5' }] }, puntaje);
  assert.match(tarjeta(2, yeezy), /\n⚠ Celeste · talles 34\.5, 35\.5$/);
  const perfume = itemTarjeta({ nombre: 'Diavolo EDT 100 ml', url: 'https://x/p', precioActual: 21000 }, { precioMercado: 29000, margen: 0.39, via: 'ean' });
  assert.equal(tarjeta(3, perfume), '*3. [Diavolo EDT 100 ml](https://x/p)*\n$21k → $29k · *+39%*');
});

test('Telegram: el link con nombre y la negrita; WhatsApp: el nombre y la URL abajo', () => {
  const texto = tarjeta(1, itemTarjeta(superstar, puntaje));
  assert.equal(aHtml(texto).split('\n')[0], '<b>1. <a href="https://www.moov.com.ar/zapatillas-adidas-superstar/ADEG4957.html">Adidas Superstar</a></b>');
  assert.equal(paraWhatsapp(texto).split('\n').slice(0, 2).join('\n'), '*1. Adidas Superstar*\nhttps://www.moov.com.ar/zapatillas-adidas-superstar/ADEG4957.html');
});

test('agruparTarjetas: respeta el largo, siempre entra una y cuenta las incluidas', () => {
  const items = Array.from({ length: 9 }, (_, i) => itemTarjeta({ ...superstar, nombre: `Modelo ${i}` }, puntaje));
  const { mensajes, porMensaje, incluidas } = agruparTarjetas(items, { titulo: 'Ofertas Moov', maxCaracteres: 700, maxMensajes: 10 });
  assert.equal(incluidas, 9);
  assert.equal(porMensaje.reduce((a, b) => a + b, 0), 9);
  assert.ok(mensajes[0].startsWith('*Ofertas Moov* · 9 que valen la pena\nPrecio acá → eBay'));
  assert.ok(mensajes.length > 1 && mensajes[1].startsWith('*Ofertas Moov* (cont.)'));
});
