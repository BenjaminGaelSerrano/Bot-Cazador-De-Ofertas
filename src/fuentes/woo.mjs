import { composicionDe } from '../nucleo/calidad.mjs';

// WooCommerce (locales propios, spec 009), por su API pública de tienda. Se piden solo los productos en oferta y con
// stock. La lista no dice qué talle queda: eso se mira por variación, solo para lo que se va a avisar (`tallesWoo`).

export function deWoo(p) {
  const divisor = 10 ** (p.prices?.currency_minor_unit ?? 2);
  const precioActual = Number(p.prices?.price) / divisor;
  const precioLista = Number(p.prices?.regular_price) / divisor;
  if (!(precioActual > 0) || p.is_in_stock === false) return null;
  const atributo = (nombre) => (p.attributes ?? []).find((a) => a.name.toLowerCase() === nombre)?.terms?.map((t) => t.name) ?? [];
  const genero = atributo('género').join(' ');
  return {
    id: String(p.id),
    nombre: p.name,
    marca: p.brands?.[0]?.name ?? atributo('marca')[0] ?? '',
    url: p.permalink,
    ean: null,
    ml: null,
    categoria: p.categories?.[0]?.name ?? null,
    categorias: [...(p.categories ?? []).map((c) => c.name), genero].filter(Boolean),
    // "Nene", "Nena", "Dama": no es para él.
    ...(/nen[ea]|dama|mujer|bebe/i.test(genero) && !/hombre|unisex|caballero/i.test(genero) ? { genero: 'n' } : {}),
    precioActual,
    precioLista: precioLista > precioActual ? precioLista : precioActual,
    stock: 1,
    talles: atributo('talle').length ? atributo('talle') : ['único'],
    variaciones: (p.variations ?? []).map((v) => ({ id: v.id, talle: v.attributes?.find((a) => /talle/i.test(a.name))?.value ?? null })),
    composicion: composicionDe(`${p.short_description ?? ''} ${p.description ?? ''}`),
  };
}

export async function leerWoo(cliente, { base, maxPaginas = 30 }) {
  const ofertas = new Map();
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const { datos } = await cliente.obtenerJson(`${base}/wp-json/wc/store/v1/products?on_sale=true&stock_status=instock&per_page=100&page=${pagina}`);
    for (const p of datos) {
      const o = deWoo(p);
      if (o) ofertas.set(o.id, o);
    }
    if (datos.length < 100) break;
  }
  return [...ofertas.values()];
}

/** Talles de un producto que hoy tienen stock (un pedido por variación). null si no se pudo saber. */
export async function tallesWoo(cliente, oferta, { base }) {
  if (!oferta.variaciones?.length) return oferta.talles;
  const hay = [];
  for (const v of oferta.variaciones) {
    const { datos } = await cliente.obtenerJson(`${base}/wp-json/wc/store/v1/products/${v.id}`);
    if (datos.is_in_stock && v.talle) hay.push(v.talle.toUpperCase());
  }
  return hay;
}
