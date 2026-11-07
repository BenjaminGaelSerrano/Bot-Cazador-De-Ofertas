import { config } from '../config.mjs';
import { largoEfectivo } from './callmebot.mjs';
import { miles } from './tabla.mjs';
import { evaluarTalles } from '../nucleo/talles.mjs';

// Formato de tarjetas (pedido del usuario, 2026-11-06: "me gusta el formato que le das acá, es muy distinto al que
// devuelve Telegram"). Telegram no muestra tablas: cada oferta es una tarjeta de 2 o 3 líneas con el nombre completo
// como link, precio acá → eBay, ahorro en negrita, ventas en eBay y color · talles.
//
//   *1. [Adidas Superstar](https://...)*
//   $55k → $113k · *+106%* · 17 vendidas
//   Negro · talle 43.5
//
// Telegram convierte [texto](url) en link (`aHtml`); para la copia por WhatsApp, `paraWhatsapp` lo pasa a texto + URL.

export const LEYENDA_TARJETAS = 'Precio acá → eBay EE.UU. · ahorro · ventas en eBay del mismo modelo y color';

/** Nombre legible: sin mayúsculas sostenidas, sin "Zapatillas Running", sin "Sportswear" ni códigos pegados al final. */
export function nombreLindo(nombre) {
  let s = String(nombre ?? '').replace(/\s+/g, ' ').trim();
  if (s && s === s.toUpperCase()) s = s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  s = s.replace(/^zapatillas?\s+((running|urbanas|b[aá]squet|entrenamiento|training|moda|skate)\s+)?/i, '');
  s = s.replace(/\b(sportswear|performance|originals)\b\s*/gi, '');
  s = s.replace(/\s+[A-Za-z]{0,2}\d[\dA-Za-z]{5,}(\s+0{3})?$/, ''); // "... 6jy8623 000", "... X6291107454856"
  s = s.replace(/[[\]*]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}

/** Datos de una tarjeta a partir de una oferta (con `vendidas` = ventas en eBay) y su puntaje de reventa. */
export function itemTarjeta(oferta, puntaje) {
  const conReferencia = puntaje?.precioMercado !== undefined && puntaje?.precioMercado !== null;
  const talles = evaluarTalles(oferta.talles, oferta.genero);
  return {
    nombre: nombreLindo(oferta.nombre),
    url: oferta.url,
    costo: `$${miles(oferta.precioActual)}`,
    mercado: conReferencia ? `${puntaje.via === 'modelo' ? '~' : ''}$${miles(puntaje.precioMercado)}` : '—',
    gana: conReferencia ? `${puntaje.margen >= 0 ? '+' : ''}${Math.round(puntaje.margen * 100)}%` : '—',
    ventas: Number.isFinite(oferta.vendidas) ? oferta.vendidas : null,
    detalle: [oferta.color ? String(oferta.color) : null, talles?.texto ?? null].filter(Boolean).join(' · '),
    alerta: Boolean(talles?.alerta),
  };
}

export function tarjeta(numero, item) {
  const lineas = [
    `*${numero}. [${item.nombre}](${item.url})*`,
    `${item.costo} → ${item.mercado} · *${item.gana}*${item.ventas !== null ? ` · ${item.ventas} vendidas` : ''}`,
  ];
  if (item.detalle || item.alerta) lineas.push(`${item.alerta ? '⚠ ' : ''}${item.detalle}`.trim());
  return lineas.join('\n');
}

/** Agrupa tarjetas en mensajes, con el mismo contrato que `agruparTabla`: `{ mensajes, porMensaje, incluidas }`. */
export function agruparTarjetas(items, {
  titulo,
  tituloContinuacion = `*${titulo}* (cont.)`,
  leyenda = LEYENDA_TARJETAS,
  maxMensajes = config.maxMensajesPorCorrida,
  maxCaracteres = config.maxCaracteres,
} = {}) {
  const componer = (cabecera, desde, hasta, conLeyenda) => [
    cabecera,
    ...(conLeyenda && leyenda ? [leyenda] : []),
    '',
    items.slice(desde, hasta).map((item, j) => tarjeta(desde + j + 1, item)).join('\n\n'),
  ].join('\n');

  const mensajes = [];
  const porMensaje = [];
  let i = 0;
  while (i < items.length && mensajes.length < maxMensajes) {
    const cabecera = mensajes.length === 0 ? `*${titulo}* · ${items.length} que valen la pena` : tituloContinuacion;
    const conLeyenda = mensajes.length === 0;
    let hasta = i + 1; // siempre entra al menos una
    while (hasta < items.length && largoEfectivo(componer(cabecera, i, hasta + 1, conLeyenda)) <= maxCaracteres) hasta++;
    mensajes.push(componer(cabecera, i, hasta, conLeyenda));
    porMensaje.push(hasta - i);
    i = hasta;
  }
  if (i < items.length && mensajes.length > 0) mensajes[mensajes.length - 1] += `\n\ny ${items.length - i} más.`;
  return { mensajes, porMensaje, incluidas: i };
}

/** WhatsApp no tiene links con nombre: "*1. [Nombre](url)*" -> "*1. Nombre*" y la URL abajo. */
export function paraWhatsapp(texto) {
  return texto
    .replace(/\*(\d+\. )\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)\*/g, '*$1$2*\n$3')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1: $2');
}
