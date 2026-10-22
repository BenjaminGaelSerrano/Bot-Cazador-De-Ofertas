import { ErrorFuente, esRecuperable } from '../nucleo/http.mjs';
import { extraerMl } from './vtex.mjs';

const STOCK_SIN_CANTIDAD = 99999; // hay stock pero el sitio no dice cuánto: un marcador, no una cantidad real
const PRECIO = 'price_range{ minimum_price{ regular_price{value} final_price{value} } }';
const ATRIBUTOS = 'custom_attributesV2(filters:{is_wysiwyg_enabled:false}){ items{ code ... on AttributeValue{ value } ... on AttributeSelectedOptions{ selected_options{ label } } } }';

/** Valor de un atributo personalizado: texto directo, o la etiqueta de la opción elegida. */
function valorAtributo(unidad, codigo) {
  const a = unidad.custom_attributesV2?.items?.find((x) => x.code === codigo);
  return a?.value ?? a?.selected_options?.[0]?.label ?? null;
}

/** Stock numérico: la cantidad real si el sitio la informa, 0 si está agotado, o un marcador si hay sin dato. */
function stockDe(unidad) {
  if (unidad.stock_status !== 'IN_STOCK') return 0;
  const cantidad = unidad.only_x_left_in_stock;
  return Number.isFinite(cantidad) ? cantidad : STOCK_SIN_CANTIDAD;
}

/** Productos simples se compran tal cual; los configurables se compran por variante (cada tamaño). */
const unidadesDe = (producto) => (producto.variants?.length ? producto.variants.map((v) => v.product) : [producto]);

/**
 * Crea el lector de una tienda Magento 2 por GraphQL. Cada corrida lee la lista liviana (precio y stock); los
 * atributos pesados (código de barras y marca) se piden una sola vez por producto y quedan en el historial.
 * Configuración: `base`, `categoriaId`, `porPagina`, `maxPaginas`, `maxProductosAtributos`, `loteAtributos`.
 */
export function crearLectorMagento(cfg) {
  const consultaLista = (pagina) => `{ products(filter:{category_id:{eq:"${cfg.categoriaId}"}}, pageSize:${cfg.porPagina}, currentPage:${pagina}){ total_count page_info{ total_pages } items{ __typename sku name url_key url_suffix stock_status only_x_left_in_stock ${PRECIO} ... on ConfigurableProduct{ variants{ product{ sku name stock_status only_x_left_in_stock ${PRECIO} } } } } } }`;
  const consultaAtributos = (skus) => `{ products(filter:{sku:{in:${JSON.stringify(skus)}}}, pageSize:${skus.length}){ items{ sku ${ATRIBUTOS} ... on ConfigurableProduct{ variants{ product{ sku ${ATRIBUTOS} } } } } } }`;

  /**
   * Convierte un producto de la lista en ofertas, una por unidad vendible. `saber(sku)` devuelve `{ ean, marca }`
   * si ya se conocen los atributos de esa unidad. Los hijos de un configurable no tienen página propia: todos
   * apuntan al link del producto padre.
   */
  function normalizarProducto(producto, { saber = () => undefined, base = cfg.base } = {}) {
    const url = `${base}/${producto.url_key}${producto.url_suffix ?? ''}`;
    const ofertas = [];
    for (const u of unidadesDe(producto)) {
      const precio = u.price_range?.minimum_price;
      const precioActual = precio?.final_price?.value;
      if (!(precioActual > 0)) continue;
      const regular = precio.regular_price?.value;
      const conocido = saber(u.sku);
      ofertas.push({
        id: u.sku,
        productoId: producto.sku,
        ean: conocido?.ean ?? null,
        marca: conocido?.marca ?? '', // vacío hasta que se piden los atributos: el mensaje no antepone nada
        nombre: u.name,
        ml: extraerMl(u.name),
        categoria: null,
        precioActual,
        precioLista: regular > precioActual ? regular : precioActual,
        moneda: 'ARS',
        url,
        stock: stockDe(u),
        attrs: conocido?.completo === true, // los atributos de esta unidad ya se pidieron (aunque no tenga gtin)
      });
    }
    return ofertas;
  }

  /** Lee el catálogo. `historial` aporta los atributos ya conocidos. Devuelve `{ ofertas, informe }`. */
  async function leerCatalogo(cliente, { base = cfg.base, historial = null, log = () => {} } = {}) {
    const informe = {
      pedidos: 0, productosLeidos: 0, catalogoTotal: null, sinCubrir: null, truncados: [], incompletos: [], parciales: [],
      enriquecidos: 0, sinAtributos: 0,
    };
    const url = `${base}/graphql`;
    const erroresParciales = [];

    /** POST GraphQL. Un `errors` en la respuesta es una respuesta inválida, no un dato. */
    async function graphql(consulta) {
      informe.pedidos++;
      const { datos } = await cliente.obtenerJson(url, { cuerpo: { query: consulta } });
      if (datos?.errors?.length || !datos?.data?.products) {
        throw new ErrorFuente('respuesta_invalida', `GraphQL: ${datos?.errors?.[0]?.message ?? 'respuesta sin productos'}`, { url });
      }
      return datos.data.products;
    }
    const registrarParcial = (error, categoria, desde) => {
      if (!esRecuperable(error)) throw error;
      informe.parciales.push({ categoria, desde, motivo: error.message });
      erroresParciales.push(error);
    };

    // Lo que ya se sabe de cada unidad (guardado por corridas anteriores).
    const conocidos = (sku) => {
      const p = historial?.productos?.[sku];
      if (!p) return undefined;
      return { ean: p.ean ?? null, marca: p.marca || null, completo: Boolean(p.attrs || p.ean || p.marca) };
    };
    const nuevos = new Map(); // atributos pedidos en esta corrida

    // 1. Lista liviana, página por página.
    const padres = new Map();
    for (let pagina = 1; pagina <= cfg.maxPaginas; pagina++) {
      let productos;
      try {
        productos = await graphql(consultaLista(pagina));
      } catch (error) {
        registrarParcial(error, 'catálogo', (pagina - 1) * cfg.porPagina);
        break;
      }
      informe.catalogoTotal = productos.total_count;
      for (const p of productos.items) padres.set(p.sku, p);
      if (productos.items.length === 0 || pagina >= (productos.page_info?.total_pages ?? pagina)) break;
    }
    log(`  catálogo: ${padres.size} productos leídos`);

    // 2. Atributos: solo de los productos con alguna unidad desconocida, hasta el tope de la corrida.
    const pendientes = [...padres.values()].filter((p) => unidadesDe(p).some((u) => !conocidos(u.sku)?.completo));
    const aPedir = pendientes.slice(0, cfg.maxProductosAtributos);
    for (let i = 0; i < aPedir.length; i += cfg.loteAtributos) {
      const lote = aPedir.slice(i, i + cfg.loteAtributos);
      let productos;
      try {
        productos = await graphql(consultaAtributos(lote.map((p) => p.sku)));
      } catch (error) {
        registrarParcial(error, 'atributos', i);
        break;
      }
      // Los productos que el sitio no devuelve (deshabilitados o sin visibilidad) se marcan como ya consultados: sin
      // esto se volverían a pedir en cada corrida y gastarían el tope para siempre. Los que sí vuelven los pisan.
      for (const p of lote) for (const u of unidadesDe(p)) nuevos.set(u.sku, { ean: null, marca: null, completo: true, sinRespuesta: true });
      for (const item of productos.items) {
        for (const u of unidadesDe(item)) {
          const gtin = valorAtributo(u, 'gtin');
          nuevos.set(u.sku, { ean: /^\d{8,14}$/.test(gtin ?? '') ? gtin : null, marca: valorAtributo(u, 'mgs_brand'), completo: true });
        }
      }
    }
    informe.sinRespuesta = [...nuevos.values()].filter((v) => v.sinRespuesta).length;
    informe.enriquecidos = nuevos.size - informe.sinRespuesta;
    log(`  atributos: ${informe.enriquecidos} unidades enriquecidas (${informe.sinRespuesta} que el sitio no devolvió) de ${pendientes.length} productos pendientes (tope ${cfg.maxProductosAtributos})`);

    const saber = (sku) => nuevos.get(sku) ?? conocidos(sku);
    // Una variante de un configurable puede figurar también como producto simple suelto, con su propia página
    // (pasa en Parfumerie). Se registra una sola vez por SKU y gana el simple, que tiene su link directo: primero
    // se cargan las variantes y después los simples, que las pisan.
    const porSku = new Map();
    const lista = [...padres.values()];
    for (const p of lista.filter((x) => x.variants?.length)) for (const o of normalizarProducto(p, { saber, base })) porSku.set(o.id, o);
    for (const p of lista.filter((x) => !x.variants?.length)) for (const o of normalizarProducto(p, { saber, base })) porSku.set(o.id, o);
    const ofertas = [...porSku.values()];
    informe.sinAtributos = ofertas.filter((o) => !o.attrs).length;

    if (ofertas.length === 0 && erroresParciales.length > 0) throw erroresParciales[0];
    if (ofertas.length === 0) throw new ErrorFuente('respuesta_invalida', 'El catálogo no devolvió ofertas válidas');
    informe.productosLeidos = padres.size;
    informe.sinCubrir = Math.max(0, (informe.catalogoTotal ?? 0) - padres.size);
    return { ofertas, informe };
  }

  return { normalizarProducto, leerCatalogo };
}
