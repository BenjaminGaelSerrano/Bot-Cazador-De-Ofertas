import { ErrorFuente, esRecuperable } from '../nucleo/http.mjs';

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

/** Total de productos de la consulta, del header `resources: 0-49/11167`. */
function totalDe(headers, url) {
  const m = /\/(\d+)\s*$/.exec(headers.get('resources') ?? '');
  if (!m) throw new ErrorFuente('respuesta_invalida', `Falta el total de productos en la respuesta: ${url}`, { url });
  return Number(m[1]);
}

/** Precio, lista y stock de un SKU, o null si el dato no sirve (precio 0 o lista menor que el precio). */
function ofertaDeItem(item) {
  const oferta = item.sellers?.[0]?.commertialOffer;
  if (!oferta) return null;
  const precioActual = oferta.Price;
  const precioLista = oferta.ListPrice > 0 ? oferta.ListPrice : precioActual;
  if (!(precioActual > 0) || precioLista < precioActual) return null;
  return { precioActual, precioLista, stock: oferta.AvailableQuantity ?? 0 };
}

/**
 * Crea el lector de una tienda VTEX a partir de su configuración:
 *  - `base`, `maxPorPedido`, `maxOffset`, `categorias`, `categoriasExcluidas`, `toleranciaCobertura`
 *  - `agrupar`: 'sku' (una oferta por SKU: cada SKU tiene su propio precio, ej. perfumes por tamaño) o
 *    'producto' (una por producto: los SKU son talles con el mismo precio, ej. indumentaria).
 *  - una raíz de `categorias` con `ruta: null` significa "leer todo sin filtro" (catálogos que caben en
 *    una consulta).
 */
export function crearLector(cfg) {
  const MAX_LECTURA = cfg.maxOffset + cfg.maxPorPedido; // lo máximo que deja leer una consulta (2550)
  const agrupar = cfg.agrupar ?? 'sku';

  /**
   * Convierte un producto de la API en ofertas normalizadas. Descarta datos inválidos y categorías
   * excluidas.
   */
  function normalizarProducto(p, { categoriasExcluidas = cfg.categoriasExcluidas, base = cfg.base } = {}) {
    const categoria = categoriaRaiz(p.categories);
    if (categoria && categoriasExcluidas.includes(categoria)) return [];

    const url = p.link?.startsWith('http') ? p.link : `${base}${p.link}`;
    const comunes = { productoId: String(p.productId), marca: p.brand, categoria, moneda: 'ARS', url };

    if (agrupar === 'producto') {
      const validos = (p.items ?? []).map(ofertaDeItem).filter(Boolean);
      if (validos.length === 0) return [];
      // El precio es el del SKU más barato con stock; si ninguno tiene stock, el más barato de todos.
      const conStock = validos.filter((v) => v.stock > 0);
      const elegido = (conStock.length ? conStock : validos).reduce((a, b) => (b.precioActual < a.precioActual ? b : a));
      return [{
        ...comunes,
        id: String(p.productId),
        ean: null,
        nombre: p.productName,
        ml: extraerMl(p.productName),
        precioActual: elegido.precioActual,
        precioLista: elegido.precioLista,
        stock: validos.reduce((suma, v) => suma + v.stock, 0),
      }];
    }

    const resultado = [];
    for (const item of p.items ?? []) {
      const datos = ofertaDeItem(item);
      if (!datos) continue;
      const nombre = item.name.toLowerCase().includes(p.productName.toLowerCase())
        ? item.name
        : `${p.productName} ${item.name}`;
      resultado.push({ ...comunes, id: String(item.itemId), ean: item.ean || null, nombre, ml: extraerMl(item.name), ...datos });
    }
    return resultado;
  }

  const urlPagina = (base, ruta, desde, orden) => {
    const params = new URLSearchParams();
    if (ruta !== null) params.set('fq', `C:${ruta}`);
    params.set('_from', String(desde));
    params.set('_to', String(desde + cfg.maxPorPedido - 1));
    if (orden) params.set('O', orden);
    return `${base}/api/catalog_system/pub/products/search?${params}`;
  };

  /**
   * Lee todo el catálogo. La API solo deja leer 2.550 productos por consulta, así que se recorre el
   * árbol de categorías configurado: una categoría que cabe se lee completa; una que no, se subdivide
   * en sus hijas; una hoja que todavía no cabe se lee con dos órdenes opuestos (cubre hasta 5.100).
   * Devuelve `{ ofertas, informe }`. El informe avisa si algo quedó truncado, incompleto o sin cubrir.
   */
  async function leerCatalogo(cliente, {
    base = cfg.base,
    categorias = cfg.categorias,
    excluidas = cfg.categoriasExcluidas,
    tolerancia = cfg.toleranciaCobertura ?? 0.01,
    log = () => {},
  } = {}) {
    const informe = { pedidos: 0, productosLeidos: 0, catalogoTotal: null, sinCubrir: null, truncados: [], incompletos: [], parciales: [] };
    const erroresParciales = [];
    const pedir = async (url) => {
      informe.pedidos++;
      return cliente.obtenerJson(url);
    };

    const ofertas = new Map(); // id -> oferta (deduplica productos presentes en varias categorías)
    const todosLosProductos = new Set();
    let totalSinFiltro = null;

    const absorber = (lista, vistos) => {
      for (const p of lista) {
        vistos.add(String(p.productId));
        todosLosProductos.add(String(p.productId));
        for (const oferta of normalizarProducto(p, { categoriasExcluidas: excluidas, base })) ofertas.set(oferta.id, oferta);
      }
    };

    /**
     * Un error pasajero del sitio (5xx o corte de red que sigue después de los reintentos) no tira toda la
     * lectura: se anota como parcial, se deja de leer esa categoría y se sigue con las demás. Un bloqueo
     * (403/429) sí corta todo, porque insistir sería maltratar al sitio.
     */
    const registrarParcial = (error, categoria, desde) => {
      if (!esRecuperable(error)) throw error;
      informe.parciales.push({ categoria, desde, motivo: error.message });
      erroresParciales.push(error);
    };

    async function leerPaginas(nodo, desde, limite, orden, vistos) {
      for (let i = desde; i < limite; i += cfg.maxPorPedido) {
        let datos;
        try {
          ({ datos } = await pedir(urlPagina(base, nodo.ruta, i, orden)));
        } catch (error) {
          registrarParcial(error, nodo.name, i);
          return;
        }
        if (datos.length === 0) break;
        absorber(datos, vistos);
      }
    }

    async function leerNodo(nodo) {
      const vistos = new Set();
      const url = urlPagina(base, nodo.ruta, 0);
      let primera;
      try {
        primera = await pedir(url);
      } catch (error) {
        registrarParcial(error, nodo.name, 0);
        return vistos;
      }
      const total = totalDe(primera.headers, url);
      if (nodo.ruta === null) totalSinFiltro = total;
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

    // Si no se pudo leer nada, no hay lectura parcial que valga: se informa el error real del sitio.
    if (ofertas.size === 0 && erroresParciales.length > 0) throw erroresParciales[0];
    if (ofertas.size === 0) throw new ErrorFuente('respuesta_invalida', 'El catálogo no devolvió ofertas válidas');
    informe.productosLeidos = todosLosProductos.size;

    if (totalSinFiltro !== null) {
      // Se leyó todo sin filtro: el propio total del sitio es la cobertura.
      informe.catalogoTotal = totalSinFiltro;
      informe.sinCubrir = Math.max(0, totalSinFiltro - informe.productosLeidos);
      return { ofertas: [...ofertas.values()], informe };
    }

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

  return { normalizarProducto, leerCatalogo };
}
