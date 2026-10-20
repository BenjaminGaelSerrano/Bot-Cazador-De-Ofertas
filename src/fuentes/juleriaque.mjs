import { config } from '../config.mjs';
import { ErrorFuente } from '../nucleo/http.mjs';

const cfg = config.fuentes.juleriaque;
const MAX_LECTURA = cfg.maxOffset + cfg.maxPorPedido; // lo máximo que se puede leer de una consulta (2550)

/** Tamaño en ml dentro del nombre del SKU ("Glycolic Acid 240 ml"); null si no lo trae. */
export function extraerMl(nombre) {
  const m = /(\d+(?:[.,]\d+)?)\s*ml\b/i.exec(nombre);
  return m ? Number(m[1].replace(',', '.')) : null;
}

/** Categoría raíz a partir de `categories` (la última entrada es la raíz: "/Tratamiento/"). */
export function categoriaRaiz(categories) {
  const raiz = categories?.at(-1);
  return raiz ? raiz.split('/').filter(Boolean)[0] ?? null : null;
}

/**
 * Convierte un producto de la API de VTEX en una lista de ofertas normalizadas, una por SKU
 * (cada SKU tiene su propio precio, EAN y tamaño). Descarta datos inválidos y categorías excluidas.
 */
export function normalizarProducto(p, { categoriasExcluidas = cfg.categoriasExcluidas, base = cfg.base } = {}) {
  const categoria = categoriaRaiz(p.categories);
  if (categoria && categoriasExcluidas.includes(categoria)) return [];

  const resultado = [];
  for (const item of p.items ?? []) {
    const oferta = item.sellers?.[0]?.commertialOffer;
    if (!oferta) continue;

    const precioActual = oferta.Price;
    const precioLista = oferta.ListPrice > 0 ? oferta.ListPrice : precioActual;
    if (!(precioActual > 0) || precioLista < precioActual) continue;

    const nombre = item.name.toLowerCase().includes(p.productName.toLowerCase())
      ? item.name
      : `${p.productName} ${item.name}`;

    resultado.push({
      id: String(item.itemId),
      productoId: String(p.productId),
      ean: item.ean || null,
      marca: p.brand,
      nombre,
      ml: extraerMl(item.name),
      categoria,
      precioActual,
      precioLista,
      moneda: 'ARS',
      url: p.link?.startsWith('http') ? p.link : `${base}${p.link}`,
      stock: oferta.AvailableQuantity ?? 0,
    });
  }
  return resultado;
}

const urlPagina = (base, ruta, desde, orden) => {
  const params = new URLSearchParams({
    fq: `C:${ruta}`,
    _from: String(desde),
    _to: String(desde + cfg.maxPorPedido - 1),
  });
  if (orden) params.set('O', orden);
  return `${base}/api/catalog_system/pub/products/search?${params}`;
};

/** Total de productos de la consulta, del header `resources: 0-49/11167`. */
function totalDe(headers, url) {
  const m = /\/(\d+)\s*$/.exec(headers.get('resources') ?? '');
  if (!m) throw new ErrorFuente('respuesta_invalida', `Falta el total de productos en la respuesta: ${url}`, { url });
  return Number(m[1]);
}

/**
 * Lee todo el catálogo. La API solo deja leer 2.550 productos por consulta, así que se recorre el
 * árbol de categorías configurado: una categoría que cabe se lee completa; una que no, se subdivide
 * en sus hijas; una hoja que todavía no cabe se lee con dos órdenes opuestos (cubre hasta 5.100).
 * Devuelve `{ ofertas, informe }`. El informe avisa si algo quedó truncado, incompleto o sin cubrir.
 */
export async function leerCatalogo(cliente, {
  base = cfg.base,
  categorias = cfg.categorias,
  excluidas = cfg.categoriasExcluidas,
  tolerancia = cfg.toleranciaCobertura,
  log = () => {},
} = {}) {
  const informe = { pedidos: 0, productosLeidos: 0, catalogoTotal: null, sinCubrir: null, truncados: [], incompletos: [] };
  const pedir = async (url) => {
    informe.pedidos++;
    return cliente.obtenerJson(url);
  };

  const ofertas = new Map(); // id de SKU -> oferta (deduplica productos presentes en varias categorías)
  const todosLosProductos = new Set();

  const absorber = (lista, vistos) => {
    for (const p of lista) {
      vistos.add(String(p.productId));
      todosLosProductos.add(String(p.productId));
      for (const oferta of normalizarProducto(p, { categoriasExcluidas: excluidas, base })) ofertas.set(oferta.id, oferta);
    }
  };

  async function leerPaginas(nodo, desde, limite, orden, vistos) {
    for (let i = desde; i < limite; i += cfg.maxPorPedido) {
      const { datos } = await pedir(urlPagina(base, nodo.ruta, i, orden));
      if (datos.length === 0) break;
      absorber(datos, vistos);
    }
  }

  async function leerNodo(nodo) {
    const vistos = new Set();
    const url = urlPagina(base, nodo.ruta, 0);
    const primera = await pedir(url);
    const total = totalDe(primera.headers, url);
    absorber(primera.datos, vistos);

    const hijos = nodo.children ?? [];
    if (total > MAX_LECTURA && hijos.length > 0) {
      log(`  ${nodo.name}: ${total} productos, se subdivide en ${hijos.length} categorías`);
      for (const hijo of hijos) for (const id of await leerNodo(hijo)) vistos.add(id);
      if (vistos.size < total * (1 - tolerancia)) informe.incompletos.push({ categoria: nodo.name, esperado: total, leido: vistos.size });
      return vistos;
    }

    if (total > MAX_LECTURA) {
      // Hoja que ya no cabe: dos órdenes opuestos cubren hasta el doble del tope.
      log(`  ${nodo.name}: ${total} productos, se lee con dos órdenes`);
      await leerPaginas(nodo, 0, MAX_LECTURA, 'OrderByNameASC', vistos);
      await leerPaginas(nodo, 0, MAX_LECTURA, 'OrderByNameDESC', vistos);
      if (vistos.size < total * (1 - tolerancia)) informe.truncados.push({ categoria: nodo.name, total, leido: vistos.size });
      return vistos;
    }

    await leerPaginas(nodo, cfg.maxPorPedido, total, undefined, vistos);
    log(`  ${nodo.name}: ${total} productos leídos`);
    return vistos;
  }

  for (const raiz of categorias) {
    if (excluidas.includes(raiz.name)) continue;
    await leerNodo(raiz);
  }

  if (ofertas.size === 0) throw new ErrorFuente('respuesta_invalida', 'El catálogo no devolvió ofertas válidas');
  informe.productosLeidos = todosLosProductos.size;

  // Control final: ¿hay productos en el sitio que no están en ninguna categoría configurada?
  try {
    const urlTotal = `${base}/api/catalog_system/pub/products/search?_from=0&_to=0`;
    const { headers } = await pedir(urlTotal);
    informe.catalogoTotal = totalDe(headers, urlTotal);
    informe.sinCubrir = Math.max(0, informe.catalogoTotal - informe.productosLeidos);
  } catch (error) {
    if (!(error instanceof ErrorFuente)) throw error;
    log(`  (no se pudo verificar el total del catálogo: ${error.message})`);
  }

  return { ofertas: [...ofertas.values()], informe };
}
