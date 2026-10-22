import { ErrorFuente, esRecuperable } from '../nucleo/http.mjs';

/**
 * Crea el lector de una tienda Shopify a partir de su configuración (`base`, `porPagina`, `maxPaginas`,
 * `categoriasExcluidas`). Lee `/products.json` por páginas. Se avisa por producto, no por talle: las
 * variantes de una gorra son talles con el mismo precio.
 */
export function crearLectorShopify(cfg) {
  /** Convierte un producto de Shopify en una oferta, o en nada si no sirve (sin precio válido o excluido). */
  function normalizarProducto(p, { base = cfg.base, categoriasExcluidas = cfg.categoriasExcluidas } = {}) {
    if (categoriasExcluidas.includes(p.product_type)) return [];

    const variantes = (p.variants ?? [])
      .map((v) => {
        const precio = Number(v.price);
        const comparado = Number(v.compare_at_price);
        return { precio, lista: comparado > precio ? comparado : precio, disponible: v.available === true };
      })
      .filter((v) => Number.isFinite(v.precio) && v.precio > 0);
    if (variantes.length === 0) return [];

    // El precio es el de la variante más barata con stock; si ninguna tiene stock, la más barata de todas.
    const disponibles = variantes.filter((v) => v.disponible);
    const elegida = (disponibles.length ? disponibles : variantes).reduce((a, b) => (b.precio < a.precio ? b : a));

    return [{
      id: String(p.id),
      productoId: String(p.id),
      ean: null,
      marca: p.vendor,
      nombre: p.title,
      ml: null,
      categoria: p.product_type || null,
      precioActual: elegida.precio,
      precioLista: elegida.lista,
      moneda: 'ARS',
      url: `${base}/products/${p.handle}`,
      stock: disponibles.length,
    }];
  }

  /** Lee el catálogo completo. Devuelve `{ ofertas, informe }` con la misma forma que el lector VTEX. */
  async function leerCatalogo(cliente, { base = cfg.base, categoriasExcluidas = cfg.categoriasExcluidas, log = () => {} } = {}) {
    const informe = { pedidos: 0, productosLeidos: 0, catalogoTotal: null, sinCubrir: null, truncados: [], incompletos: [], parciales: [] };
    const ofertas = new Map(); // deduplica: si el catálogo cambia durante la lectura, un producto puede repetirse
    const productos = new Set();

    let terminado = false;
    let errorParcial = null;
    for (let pagina = 1; pagina <= cfg.maxPaginas && !terminado; pagina++) {
      const url = `${base}/products.json?limit=${cfg.porPagina}&page=${pagina}`;
      informe.pedidos++;
      let datos;
      try {
        ({ datos } = await cliente.obtenerJson(url));
      } catch (error) {
        // Un error pasajero del sitio no tira lo ya leído: la lectura queda parcial. Un bloqueo sí corta todo.
        if (!esRecuperable(error)) throw error;
        informe.parciales.push({ categoria: 'catálogo', desde: pagina, motivo: error.message });
        errorParcial = error;
        terminado = true; // sin truncados: no se llegó al tope de páginas, se cortó por el error
        break;
      }
      if (!Array.isArray(datos?.products)) {
        throw new ErrorFuente('respuesta_invalida', `La respuesta no trae la lista de productos: ${url}`, { url });
      }

      for (const p of datos.products) {
        productos.add(String(p.id));
        for (const oferta of normalizarProducto(p, { base, categoriasExcluidas })) ofertas.set(oferta.id, oferta);
      }
      log(`  página ${pagina}: ${datos.products.length} productos`);
      // Una página incompleta es la última: se ahorra el pedido que vendría vacío.
      terminado = datos.products.length < cfg.porPagina;
    }

    if (!terminado) informe.truncados.push({ categoria: 'catálogo', total: null, leido: productos.size });
    if (ofertas.size === 0 && errorParcial) throw errorParcial;
    if (ofertas.size === 0) throw new ErrorFuente('respuesta_invalida', 'El catálogo no devolvió ofertas válidas');

    informe.productosLeidos = productos.size;
    informe.catalogoTotal = productos.size; // Shopify no informa un total aparte; lo leído es lo que hay
    informe.sinCubrir = 0;
    return { ofertas: [...ofertas.values()], informe };
  }

  return { normalizarProducto, leerCatalogo };
}
