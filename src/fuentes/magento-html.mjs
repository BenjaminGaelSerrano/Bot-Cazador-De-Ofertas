import { composicionDe } from '../nucleo/calidad.mjs';
import { ErrorFuente } from '../nucleo/http.mjs';

// Tiendas Magento leídas por sus páginas de categoría (Open Sports, Quiksilver, DC, RVCA): la lista trae nombre, precio
// y precio anterior; los talles se miran en la página del producto, solo para lo que se va a avisar.

const texto = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/** Ofertas de una página de categoría (solo lo que tiene precio anterior). */
export function deListaMagento(html) {
  const ofertas = [];
  for (const bloque of String(html).split(/(?=<div class="product-item-info)/)) {
    const enlace = /class="product-item-link"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(bloque);
    const final = Number(/data-price-amount="([\d.]+)"\s+data-price-type="finalPrice"/.exec(bloque)?.[1]);
    const antes = Number(/data-price-amount="([\d.]+)"\s+data-price-type="oldPrice"/.exec(bloque)?.[1]);
    if (!enlace || !(final > 0) || !(antes > final)) continue;
    const url = enlace[1];
    ofertas.push({
      id: url, url, nombre: texto(enlace[2]), ean: null, ml: null, categoria: null, categorias: [],
      precioActual: Math.round(final), precioLista: Math.round(antes), stock: 1, talles: ['único'],
    });
  }
  return ofertas;
}

export async function leerMagentoHtml(cliente, { base, marca, rutas, maxPaginas = 40 }) {
  const ofertas = new Map();
  for (const ruta of rutas) {
    const vistos = new Set();
    for (let pagina = 1; pagina <= maxPaginas; pagina++) {
      let datos;
      try {
        ({ datos } = await cliente.obtenerTexto(`${base}${ruta}${pagina > 1 ? `?p=${pagina}` : ''}`));
      } catch (error) {
        if (error instanceof ErrorFuente && error.status === 404) break;
        throw error;
      }
      // Magento repite la última página cuando se pide una de más: se corta al no ver productos nuevos.
      const enlaces = [...datos.matchAll(/class="product-item-link"\s+href="([^"]+)"/g)].map((m) => m[1]).filter((u) => !vistos.has(u));
      if (enlaces.length === 0) break;
      for (const u of enlaces) vistos.add(u);
      for (const o of deListaMagento(datos)) ofertas.set(o.id, { ...o, marca });
    }
  }
  return [...ofertas.values()];
}

/** El arreglo JSON que empieza en \`desde\`, contando corchetes. */
function arregloDesde(t, desde) {
  let nivel = 0;
  for (let i = desde; i < t.length; i++) {
    if (t[i] === '[') nivel++;
    else if (t[i] === ']' && --nivel === 0) return t.slice(desde, i + 1);
  }
  return null;
}

/** Talles con stock según la configuración del producto (\`jsonConfig\`); ['único'] si no tiene talles. */
export function tallesDeFichaMagento(html) {
  const t = String(html);
  const m = /"code":"[a-z_]*(?:talle|size)[a-z_]*","label":"[^"]*","options":/.exec(t);
  if (!m) return ['único'];
  const opciones = JSON.parse(arregloDesde(t, m.index + m[0].length) ?? '[]');
  // Solo las opciones con algún producto a la venta; "Talle 42,5" -> "42,5".
  return [...new Set(opciones.filter((o) => o.products?.length).map((o) => String(o.label).trim()))];
}

export async function tallesMagento(cliente, oferta) {
  const { datos } = await cliente.obtenerTexto(oferta.url);
  oferta.composicion = composicionDe(datos.replace(/<script[\s\S]*?<\/script>/g, ' '));
  return tallesDeFichaMagento(datos);
}
