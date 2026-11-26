import { ErrorFuente } from '../nucleo/http.mjs';

// Tiendanube (locales propios, spec 009): la lista /productos/ trae en cada producto un `data-variants` con precio,
// precio anterior, talle y disponibilidad. Se lee la lista por páginas; no hace falta abrir cada producto.

const sinEntidades = (s) => String(s).replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const ES_TALLE = /^(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|[sml]\/[sml]|\d{1,2}([.,]5)?|[uú]nico|talle\s.+)$/i;

/** Ofertas de una página de lista: `[{ id, nombre, url, precioActual, precioLista, talles, stock }]`. */
export function deListaTiendanube(html) {
  const ofertas = [];
  for (const bloque of String(html).split(/(?=<div[^>]*\bjs-item-product\b)/)) {
    const crudo = /data-variants="([^"]+)"/.exec(bloque)?.[1];
    const url = /href="(https?:\/\/[^"?#]*\/productos\/[^"?#/]+\/?)/.exec(bloque)?.[1];
    if (!crudo || !url) continue;
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

export async function leerTiendanube(cliente, { base, marca, maxPaginas = 60 }) {
  const ofertas = new Map();
  const vistos = new Set();
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    let datos;
    try {
      ({ datos } = await cliente.obtenerTexto(pagina === 1 ? `${base}/productos/` : `${base}/productos/page/${pagina}/`));
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
