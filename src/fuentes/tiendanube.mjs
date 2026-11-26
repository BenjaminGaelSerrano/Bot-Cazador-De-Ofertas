import { composicionDe } from '../nucleo/calidad.mjs';
import { ErrorFuente } from '../nucleo/http.mjs';

// Tiendanube (locales propios, spec 009): la lista /productos/ trae en cada producto un `data-variants` con precio,
// precio anterior, talle y disponibilidad. Se lee la lista por páginas; no hace falta abrir cada producto.

const sinEntidades = (s) => String(s).replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const pesos = (s) => Number(String(s ?? '').replace(/[^\d,]/g, '').replace(',', '.'));
const ES_TALLE = /^(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|[sml]\/[sml]|\d{1,2}([.,]5)?|[uú]nico|talle\s.+)$/i;

/** Ofertas de una página de lista: `[{ id, nombre, url, precioActual, precioLista, talles, stock }]`. */
export function deListaTiendanube(html) {
  const ofertas = [];
  for (const bloque of String(html).split(/(?=<div[^>]*\bjs-item-product\b)/)) {
    const crudo = /data-variants="([^"]+)"/.exec(bloque)?.[1];
    const url = /href="(https?:\/\/[^"?#]*\/productos\/[^"?#/]+\/?)/.exec(bloque)?.[1];
    if (!url) continue;
    if (!crudo) {
      // Temas sin data-variants: precio y precio anterior de la lista; los talles se miran después en la ficha.
      const precio = Number(/js-price-display[^>]*data-product-price="(\d+)"/.exec(bloque)?.[1]) / 100
        || pesos(/js-price-display[^>]*>\s*([^<]+)</.exec(bloque)?.[1]);
      const antes = pesos(/js-compare-price-display[^>]*>\s*([^<]+)</.exec(bloque)?.[1]);
      const id = /data-product-id="(\d+)"/.exec(bloque)?.[1];
      const titulo = /js-item-name[^>]*>\s*([^<]+)/.exec(bloque)?.[1] ?? /\btitle="([^"]{3,120})"/.exec(bloque)?.[1];
      if (id && titulo && precio > 0) {
        ofertas.push({ id, nombre: sinEntidades(titulo).trim(), url, ean: null, ml: null, categoria: null, categorias: [], precioActual: precio, precioLista: antes > precio ? antes : precio, stock: 1, talles: ['único'], faltanTalles: true });
      }
      continue;
    }
    let variantes;
    try { variantes = JSON.parse(sinEntidades(crudo)); } catch { continue; }
    const hay = variantes.filter((v) => v.available === true && v.price_number > 0);
    if (hay.length === 0) continue;
    const elegida = hay.reduce((a, b) => (b.price_number < a.price_number ? b : a));
    const lista = elegida.compare_at_price_number > elegida.price_number ? elegida.compare_at_price_number : elegida.price_number;
    // El talle puede estar en cualquiera de las opciones (la otra suele ser el color).
    const talles = hay.map((v) => [v.option0, v.option1, v.option2].find((o) => o && ES_TALLE.test(String(o).trim()))).filter(Boolean);
    const nombre = /js-item-name[^>]*>\s*([^<]+)/.exec(bloque)?.[1] ?? /\btitle="([^"]{3,120})"/.exec(bloque)?.[1];
    if (!nombre) continue;
    ofertas.push({
      id: String(elegida.product_id), nombre: sinEntidades(nombre).trim(), url, ean: null, ml: null, categoria: null, categorias: [],
      precioActual: elegida.price_number, precioLista: lista, stock: hay.length,
      talles: talles.length ? [...new Set(talles)] : ['único'],
    });
  }
  return ofertas;
}

export async function leerTiendanube(cliente, { base, marca, ruta = '/productos/', maxPaginas = 60 }) {
  const ofertas = new Map();
  const vistos = new Set();
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    let datos;
    try {
      ({ datos } = await cliente.obtenerTexto(pagina === 1 ? `${base}${ruta}` : `${base}${ruta}page/${pagina}/`));
    } catch (error) {
      if (pagina > 1 && error instanceof ErrorFuente && error.status === 404) break; // se terminaron las páginas
      throw error;
    }
    // Se sigue hasta que una página no traiga productos nuevos (o dé 404): los enlaces de página no siempre figuran.
    const ids = [...datos.matchAll(/data-product-id="(\d+)"/g)].map((m) => m[1]).filter((id) => !vistos.has(id));
    if (ids.length === 0) break;
    for (const id of ids) vistos.add(id);
    for (const o of deListaTiendanube(datos)) ofertas.set(o.id, { ...o, marca });
  }
  return [...ofertas.values()];
}

/** Talles disponibles según la ficha del producto (`LS.variants` o `data-variants`). */
export function tallesDeFichaTiendanube(html) {
  const crudo = /LS\.variants\s*=\s*(\[[\s\S]*?\]);/.exec(html)?.[1] ?? sinEntidades(/data-variants="([^"]+)"/.exec(html)?.[1] ?? '');
  let variantes;
  try { variantes = JSON.parse(crudo); } catch { return null; }
  const hay = variantes.filter((v) => v.available === true);
  const talles = hay.map((v) => [v.option0, v.option1, v.option2].find((o) => o && ES_TALLE.test(String(o).trim()))).filter(Boolean);
  return hay.length === 0 ? [] : talles.length ? [...new Set(talles)] : ['único'];
}

export async function tallesTiendanube(cliente, oferta) {
  const { datos } = await cliente.obtenerTexto(oferta.url);
  oferta.composicion = composicionDe(/"description"\s*:\s*"([^"]{20,1500})"/.exec(datos)?.[1] ?? '') ?? composicionDe(/class="[^"]*product-description[^"]*"[^>]*>([\s\S]{0,2000})/.exec(datos)?.[1] ?? '');
  return tallesDeFichaTiendanube(datos);
}
