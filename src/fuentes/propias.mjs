// Lectores propios (locales propios, spec 009): tiendas que no usan ninguno de los formatos comunes.
import { ErrorFuente } from '../nucleo/http.mjs';
import { composicionDe } from '../nucleo/calidad.mjs';

const pesos = (s) => Number(String(s ?? '').replace(/[^\d,]/g, '').replace(',', '.'));
const texto = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&#0?39;/g, "'").replace(/&#8211;/g, '-').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const base0 = { ean: null, ml: null, categoria: null, categorias: [] };

// --- Kevingston: la misma consulta que usa su página (POST /api/v1/products); category 1 = hombre. ---
export function deKevingston(x, base) {
  const precioActual = Number(x.precio);
  const lista = Number(x.precio_real);
  if (!(precioActual > 0) || !(Number(x.stock) > 0)) return null;
  return { ...base0, id: x.sku, nombre: texto(x.nombre), url: `${base}${x.url}`, precioActual, precioLista: lista > precioActual ? lista : precioActual, stock: Number(x.stock), talles: ['único'] };
}

export async function leerKevingston(cliente, { base, marca, categoria = '1', maxPaginas = 60 }) {
  const ofertas = new Map();
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const { datos } = await cliente.obtenerJson(`${base}/api/v1/products`, { formulario: { page: String(pagina), category: categoria, type: '', linea: '', condition: '', order: '', promotion: '', price_from: '', price_to: '', group_dto: '', is_bomba: '0', subcategory: '', porcentaje: '', idcolor: '', search: '' } });
    if (!datos?.data?.data) throw new ErrorFuente('respuesta_invalida', 'Kevingston cambió el formato de la lista');
    for (const x of Object.values(datos.data.data)) {
      const o = deKevingston(x, base);
      if (o) ofertas.set(o.id, { ...o, marca });
    }
    if (pagina >= Number(datos.data.count_page)) break;
  }
  return [...ofertas.values()];
}

export async function tallesKevingston(cliente, oferta, { base }) {
  const { datos } = await cliente.obtenerJson(`${base}/api/v1/product/size/${oferta.id}`);
  return (datos.data ?? []).filter((t) => Number(t.stock) > 0).map((t) => String(t.size_nombre).trim());
}

// --- PrestaShop (Brooksfield): pidiendo JSON, la categoría devuelve los productos con precio y precio anterior. ---
export function dePrestashop(x) {
  const precio = Number(x.price_amount);
  if (!(precio > 0)) return null;
  const antes = Number(x.regular_price_amount);
  // La dirección trae el talle de la variante que muestra ("#/26-talle-xl/..."): se quita.
  return { ...base0, id: String(x.id_product ?? x.id), nombre: texto(x.name), url: String(x.url).split('#')[0], precioActual: precio, precioLista: antes > precio ? antes : precio, stock: 1, talles: ['único'] };
}

export async function leerPrestashop(cliente, { base, marca, ruta, maxPaginas = 60 }) {
  const ofertas = new Map();
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const { datos } = await cliente.obtenerJson(`${base}${ruta}${pagina > 1 ? `?page=${pagina}` : ''}`);
    if (!Array.isArray(datos?.products)) throw new ErrorFuente('respuesta_invalida', 'La categoría no devolvió productos');
    for (const x of datos.products) {
      const o = dePrestashop(x);
      if (o) ofertas.set(o.id, { ...o, marca });
    }
    if (pagina >= Number(datos.pagination?.pages_count ?? 1)) break;
  }
  return [...ofertas.values()];
}

// --- Rotten Future: web propia sobre Tiendanube; los datos van incrustados en la página como texto JSON. ---
export function deRotten(html, base) {
  const t = String(html).replace(/\\"/g, '"');
  const ofertas = new Map();
  for (const m of t.matchAll(/"variants":(\[\{[^\]]*?(?:\["[^\]]*\][^\]]*?)*\}\])/g)) {
    let variantes;
    try { variantes = JSON.parse(m[1]); } catch { continue; }
    const antes = t.slice(Math.max(0, m.index - 12_000), m.index);
    const quien = [...antes.matchAll(/"handle":"([a-z0-9-]+)","name":"([^"]+)"/g)].at(-1);
    const hay = variantes.filter((v) => v.available === true && v.price > 0);
    if (!quien || hay.length === 0) continue;
    const elegida = hay.reduce((a, b) => (b.price < a.price ? b : a));
    ofertas.set(quien[1], {
      ...base0, id: quien[1], nombre: texto(quien[2]), url: `${base}/producto/${quien[1]}`, precioActual: elegida.price,
      precioLista: elegida.compareAtPrice > elegida.price ? elegida.compareAtPrice : elegida.price, stock: hay.length,
      talles: [...new Set(hay.map((v) => v.options?.[0]).filter(Boolean))], composicion: composicionDe(antes.slice(-3000)),
    });
  }
  return [...ofertas.values()];
}

export async function leerRotten(cliente, { base, marca, rutas = ['/categoria/hombre', '/productos'] }) {
  const ofertas = new Map();
  for (const ruta of rutas) {
    const { datos } = await cliente.obtenerTexto(`${base}${ruta}`);
    for (const o of deRotten(datos, base)) ofertas.set(o.id, { ...o, marca });
  }
  return [...ofertas.values()];
}
