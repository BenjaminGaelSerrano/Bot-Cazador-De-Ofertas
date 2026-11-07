import { ErrorFuente, esRecuperable } from '../nucleo/http.mjs';
import { claveModelo } from '../nucleo/modelo.mjs';

/** Tamaño en ml dentro del nombre del SKU ("Glycolic Acid 240 ml"); null si no lo trae. */
export function extraerMl(nombre) {
  const m = /(\d+(?:[.,]\d+)?)\s*ml\b/i.exec(nombre);
  return m ? Number(m[1].replace(',', '.')) : null;
}

/**
 * Código de estilo del fabricante en la descripción ("... HOMBRE Código: DA6364-001"): identifica modelo Y color, así que
 * en eBay se busca el color exacto (pedido del usuario, 2026-11-05). Grid lo trae en ~84 % de los productos.
 */
export function codigoEstilo(descripcion) {
  const texto = String(descripcion ?? '').replace(/<[^>]+>/g, ' ');
  const m = /C[oó]digo:?\s*([A-Z0-9][A-Z0-9-]{4,15})\b/i.exec(texto);
  if (!m || !/\d/.test(m[1]) || !/[A-Z]/i.test(m[1]) && !m[1].includes('-')) return null;
  return m[1].toUpperCase();
}

/**
 * Código de estilo a partir de la referencia de Sporting (2026-11-05): "HJ8485001-000" -> HJ8485-001 (Nike: 6 + color
 * de 3), "6ID8760-000" -> ID8760 (Adidas, con un 6 adelante), "31399801-000" -> 313998-01 (Puma: 6 dígitos + color de 2).
 */
export function codigoDeReferencia(referencia) {
  const r = String(referencia ?? '').trim().toUpperCase().replace(/-0+$/, '');
  let m;
  if ((m = /^([A-Z]{2}\d{4})(\d{3})$/.exec(r))) return `${m[1]}-${m[2]}`;
  if ((m = /^6?([A-Z]{2}\d{4})$/.exec(r))) return m[1];
  if ((m = /^(\d{6})(\d{2})$/.exec(r))) return `${m[1]}-${m[2]}`;
  return null;
}

/** Código de barras limpio: Beauty 24 trae algunos con una letra al final ("8411061106297P"). */
export function limpiarEan(ean) {
  const texto = String(ean ?? '').trim();
  if (!texto) return null;
  const m = /^(\d{8,14})[A-Za-z]+$/.exec(texto);
  return m ? m[1] : texto;
}

/**
 * Talles con stock de un producto VTEX (cada SKU es un talle): `[{ t, us, u }]` = talle argentino, talle de EE. UU. (del
 * RefId "328-0013/07 *" -> "7", si está) y unidades disponibles.
 */
export function tallesDe(items) {
  const talles = [];
  for (const item of items ?? []) {
    const u = item.sellers?.[0]?.commertialOffer?.AvailableQuantity ?? 0;
    if (!(u > 0)) continue;
    let t = String(item.Talle?.[0] ?? item.name ?? '').trim();
    if (!t) continue;
    if (/^(talle\s*)?[uú]nico$|^u$/i.test(t)) t = 'único'; // gorras: "Talle Unico"
    const ref = item.referenceId?.find?.((r) => r.Key === 'RefId')?.Value ?? '';
    const us = /\/0*(\d+(?:\.\d)?)\b/.exec(ref)?.[1] ?? null;
    talles.push({ t, ...(us ? { us } : {}), u });
  }
  return talles;
}

/**
 * Género a partir de las categorías del producto (2026-11-06): las perfumerías y Sporting lo marcan ahí ("/Fragancias/
 * Premium/Femeninas/", "/Perfumes y fragancias/Perfumes de mujer/", "/SPORTING/Mujer/"). 'm', 'h', 'u' o null.
 */
export function generoDeCategorias(categories) {
  const segmentos = (categories ?? []).flatMap((c) => String(c).split('/')).map((s) => s.trim().toLowerCase());
  if (segmentos.some((s) => /^(femeninas?|mujer(es)?|perfumes de mujer|damas?)$/.test(s))) return 'm';
  if (segmentos.some((s) => /^(masculinas?|hombres?|perfumes de hombre)$/.test(s))) return 'h';
  if (segmentos.some((s) => /^(unisex|perfumes unisex)$/.test(s))) return 'u';
  return null;
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
      // Ropa y calzado: sin código de barras en común con otras tiendas, el cruce es por marca y modelo.
      const m = claveModelo(p.brand, p.productName);
      return [{
        ...comunes,
        id: String(p.productId),
        ean: null,
        nombre: p.productName,
        ml: extraerMl(p.productName),
        modelo: m.clave,
        genero: m.genero ?? generoDeCategorias(p.categories),
        // Grid y Dash lo traen en la descripción ("Código: DA6364-001"); Sporting, en la referencia del producto.
        codigo: cfg.codigoDe === 'referencia' ? codigoDeReferencia(p.productReference) : codigoEstilo(p.description),
        color: p.Color?.[0] ?? null,
        talles: tallesDe(p.items),
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
      const genero = generoDeCategorias(p.categories);
      resultado.push({ ...comunes, id: String(item.itemId), ean: limpiarEan(item.ean), nombre, ml: extraerMl(item.name), ...datos, ...(genero ? { genero } : {}) });
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
