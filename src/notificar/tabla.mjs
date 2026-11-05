import { config } from '../config.mjs';
import { largoEfectivo } from './callmebot.mjs';
import { evaluarTalles } from '../nucleo/talles.mjs';

// Formato de tabla para WhatsApp (pedido del usuario, 2026-10-23): el mensaje por oferta de 3 a 4 líneas era
// ineficiente. Ahora cada oferta es UNA fila de ancho fijo y los links van abajo, numerados.
//
//   *Grid* · 6 que valen la pena
//   ```
//    #  Producto          Costo  Merc.  Gana
//    1  NIKE BLAZER LOW    100k  ~200k  +90%
//   ```
//   1) https://www.grid.com.ar/...
//
// El bloque va entre tres comillas invertidas para que WhatsApp use letra de ancho fijo y las columnas se alineen.
// Los links quedan afuera del bloque: dentro de él WhatsApp no los vuelve clickeables.

const ANCHO_NOMBRE = 16;

// Palabras que ocupan lugar en una columna angosta y no distinguen el producto.
const RELLENO = /\b(zapatillas?|ojotas|hombre|mujer|unisex|ni[nñ]os?|ni[nñ]as?|de|del|para|con|sportswear|originals|performance|eau|parfum)\b/gi;

const rellenarDerecha = (texto, ancho) => (texto.length >= ancho ? texto.slice(0, ancho) : texto + ' '.repeat(ancho - texto.length));
const rellenarIzquierda = (texto, ancho) => ' '.repeat(Math.max(0, ancho - texto.length)) + texto;

/** 143000 -> "143k". Una columna angosta no tiene lugar para $143.000; el link lleva al precio exacto. */
export const miles = (n) => `${Math.round(n / 1000)}k`;

/**
 * Nombre corto para la columna: sin las palabras de relleno, con la marca y, si es un perfume, con el tamaño al
 * final (50 y 100 ml no son lo mismo). Se recorta al ancho de la columna.
 */
export function nombreCorto(oferta, ancho = ANCHO_NOMBRE) {
  let nombre = oferta.nombre;
  if (oferta.marca && !nombre.toLowerCase().includes(oferta.marca.toLowerCase())) nombre = `${oferta.marca} ${nombre}`;
  nombre = nombre
    .replace(/\b\d+(?:[.,]\d+)?\s?ml\b/gi, ' ') // el tamaño se agrega al final, para que no lo corte el recorte
    .replace(RELLENO, ' ')
    .replace(/['’´`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sufijo = oferta.ml ? ` ${oferta.ml}ml` : '';
  return `${nombre.slice(0, Math.max(1, ancho - sufijo.length)).trimEnd()}${sufijo}`.toUpperCase();
}

/**
 * Marca de la referencia internacional (spec 006), un carácter delante del nombre: '' si está debajo del precio de
 * EE. UU. emparejado por código de barras, '~' si el emparejado fue por nombre (aproximado) y '*' si no hay precio de
 * EE. UU. Sin `ref` (referencia desactivada) no se marca nada.
 */
export function marcaInternacional(ref) {
  if (!ref) return '';
  if (ref.estado === 'ok') return ref.via === 'nombre' ? '~' : '';
  return '*';
}

/** Datos de una fila a partir de una oferta, su puntaje de reventa y (opcional) su referencia internacional. */
export function itemTabla(oferta, puntaje, ref = null) {
  const conReferencia = puntaje?.precioMercado !== undefined && puntaje?.precioMercado !== null;
  return {
    nombre: nombreCorto(oferta),
    marca: marcaInternacional(ref),
    costo: miles(oferta.precioActual),
    mercado: conReferencia ? `${puntaje.via === 'modelo' ? '~' : ''}${miles(puntaje.precioMercado)}` : '—',
    gana: conReferencia ? `${puntaje.margen >= 0 ? '+' : ''}${Math.round(puntaje.margen * 100)}%` : '—',
    url: oferta.url,
    // Calzado y ropa: talles disponibles, con ⚠ si solo quedan poco comerciales o muy pocas unidades (2026-11-05).
    talles: evaluarTalles(oferta.talles, oferta.genero)?.texto ?? null,
  };
}

export const ENCABEZADO = { nombre: 'Producto', costo: 'Costo', mercado: 'Merc.', gana: 'Gana' };

/** Leyenda cuando la referencia internacional está activa: `~` es siempre "cruce aproximado", en cualquier columna. */
/** Leyenda con el precio de mercado de eBay (spec 007). */
export const LEYENDA_EBAY = 'Costo · Merc. (eBay EE.UU., en pesos) · Gana (margen). ~ = aproximado';

export const LEYENDA_INTERNACIONAL = 'Costo · Merc. (otra tienda) · Gana (margen). ~ aproximado · * sin precio EE.UU.';

/**
 * Una fila de ancho fijo: número, nombre, costo, mercado y ganancia. La marca internacional ocupa el espacio entre
 * el número y el nombre, así la fila no se alarga.
 */
export function fila(numero, item, { mono = true } = {}) {
  const marca = item.marca ?? '';
  if (!mono) return `${numero} | ${marca}${item.nombre} | ${item.costo} | ${item.mercado} | ${item.gana}`;
  return `${rellenarIzquierda(String(numero), 2)}${marca || ' '}${rellenarDerecha(item.nombre, ANCHO_NOMBRE)} ${rellenarIzquierda(item.costo, 5)} ${rellenarIzquierda(item.mercado, 6)} ${rellenarIzquierda(item.gana, 5)}`;
}

const filaEncabezado = (mono) => (mono
  ? fila(' #', ENCABEZADO, { mono })
  : `N | ${ENCABEZADO.nombre} | ${ENCABEZADO.costo} | ${ENCABEZADO.mercado} | ${ENCABEZADO.gana}`);

/**
 * Agrupa ofertas (`itemTabla`) en mensajes de tabla respetando el largo que acepta CallMeBot (largo efectivo).
 * Devuelve `{ mensajes, porMensaje, incluidas }`, igual que `agrupar`, para poder marcar como avisadas solo las que
 * salieron. Lo que no entra se resume al final como "y N más".
 */
export function agruparTabla(items, {
  titulo,
  tituloContinuacion = `*${titulo}* (cont.)`,
  leyenda = 'Costo · Merc. (otra tienda) · Gana (margen). ~ = por modelo',
  maxMensajes = config.maxMensajesPorCorrida,
  maxCaracteres = config.maxCaracteres,
  mono = config.tabla.monoespaciado,
} = {}) {
  const componer = (cabecera, desde, hasta, conLeyenda) => {
    const filas = items.slice(desde, hasta).map((item, j) => fila(desde + j + 1, item, { mono }));
    const tabla = [filaEncabezado(mono), ...filas].join('\n');
    const bloque = mono ? `\`\`\`\n${tabla}\n\`\`\`` : tabla;
    const links = items.slice(desde, hasta)
      .map((item, j) => `${desde + j + 1}) ${item.talles ? `${item.talles} · ` : ''}${item.url}`).join('\n');
    return [cabecera, ...(conLeyenda && leyenda ? [leyenda] : []), bloque, links].join('\n');
  };

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

  if (i < items.length && mensajes.length > 0) mensajes[mensajes.length - 1] += `\ny ${items.length - i} más.`;
  return { mensajes, porMensaje, incluidas: i };
}
