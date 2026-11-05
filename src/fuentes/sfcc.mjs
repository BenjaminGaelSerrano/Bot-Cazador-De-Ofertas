import { ErrorFuente, esRecuperable } from '../nucleo/http.mjs';
import { claveModelo } from '../nucleo/modelo.mjs';

const STOCK_SIN_CANTIDAD = 99999; // la grilla solo lista lo disponible y no informa cantidades: un marcador, no stock real

const ENTIDADES = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ',
};

/** Decodifica las entidades HTML que aparecen en nombres de producto (&amp;, &#39;, &eacute;...). */
export function decodificar(texto) {
  return texto
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => ENTIDADES[n] ?? m);
}

/**
 * Extrae los productos de un fragmento de grilla de Salesforce Commerce Cloud (Search-UpdateGrid). Cada producto es un
 * `<div class="product" data-pid="...">` con su nombre y link, el precio actual (`.sales`) y, si hay descuento, el
 * precio de lista tachado (`.strike-through.list`). Devuelve también cuántos productos había en la página, para
 * poder detectar un cambio de formato (hay productos pero no se pudo leer su precio).
 */
export function parsearGrilla(html) {
  const productos = [];
  let encontrados = 0;
  for (const m of html.matchAll(/<div class="product" data-pid="([^"]+)">([\s\S]*?)(?=<div class="product" data-pid=|$)/g)) {
    encontrados++;
    const [, pid, cuerpo] = m;
    const enlace = /<a class="link" href="([^"]+)" title="([^"]*)"/.exec(cuerpo);
    const precio = /class="sales"[\s\S]*?content="([\d.]+)"/.exec(cuerpo)?.[1];
    const lista = /class="strike-through list"[\s\S]*?content="([\d.]+)"/.exec(cuerpo)?.[1];
    if (!enlace || !precio) continue;
    productos.push({ pid, href: enlace[1], nombre: decodificar(enlace[2]).trim(), precio: Number(precio), lista: lista ? Number(lista) : null });
  }
  return { productos, encontrados };
}

/**
 * Crea el lector de una tienda Salesforce Commerce Cloud. Configuración: `base`, `sitio` (ej. "Sites-Moov-Site"),
 * `categorias` ([{ cgid, genero }]), `porPagina` y `maxPaginas`. Cada producto sale con su clave de modelo (marca y
 * palabras del nombre) y su género, porque estas tiendas no exponen código de barras.
 */
export function crearLectorSfcc(cfg) {
  const urlGrilla = (base, cgid, inicio) => `${base}/on/demandware.store/${cfg.sitio}/default/Search-UpdateGrid?cgid=${encodeURIComponent(cgid)}&start=${inicio}&sz=${cfg.porPagina}`;

  function normalizarProducto(p, { genero = null, base = cfg.base } = {}) {
    const m = claveModelo('', p.nombre, genero);
    return {
      id: p.pid,
      productoId: p.pid,
      ean: null,
      marca: m.nombreMarca ?? '',
      nombre: p.nombre,
      ml: null,
      categoria: 'Calzado',
      precioActual: p.precio,
      precioLista: p.lista > p.precio ? p.lista : p.precio,
      moneda: 'ARS',
      url: `${base}${p.href}`,
      stock: STOCK_SIN_CANTIDAD,
      modelo: m.clave,
      genero: m.genero,
    };
  }

  /** Lee las categorías configuradas. Devuelve `{ ofertas, informe }` con la misma forma que los otros lectores. */
  async function leerCatalogo(cliente, { base = cfg.base, categorias = cfg.categorias, log = () => {} } = {}) {
    const informe = { pedidos: 0, productosLeidos: 0, catalogoTotal: null, sinCubrir: null, truncados: [], incompletos: [], parciales: [], conModelo: 0 };
    const ofertas = new Map(); // un mismo producto puede figurar en más de una categoría
    const erroresParciales = [];

    for (const { cgid, genero } of categorias) {
      let leidos = 0;
      let terminada = false;
      for (let pagina = 0; pagina < cfg.maxPaginas && !terminada; pagina++) {
        const inicio = pagina * cfg.porPagina;
        informe.pedidos++;
        let html;
        try {
          ({ datos: html } = await cliente.obtenerTexto(urlGrilla(base, cgid, inicio)));
        } catch (error) {
          // Un error pasajero del sitio deja la lectura parcial; un bloqueo corta todo (insistir sería maltratar al sitio).
          if (!esRecuperable(error)) throw error;
          informe.parciales.push({ categoria: cgid, desde: inicio, motivo: error.message });
          erroresParciales.push(error);
          break;
        }

        const { productos, encontrados } = parsearGrilla(html);
        // Hay productos pero casi no se les pudo leer el precio: el HTML cambió. Se falla a la vista, no se sigue a ciegas.
        if (encontrados > 0 && productos.length < encontrados * 0.8) {
          throw new ErrorFuente('respuesta_invalida', `La grilla de ${cgid} cambió de formato: ${productos.length} de ${encontrados} productos legibles`, { url: urlGrilla(base, cgid, inicio) });
        }
        for (const p of productos) {
          const previa = ofertas.get(p.pid);
          if (!previa) {
            ofertas.set(p.pid, normalizarProducto(p, { genero, base }));
          } else if (!claveModelo('', p.nombre).genero && previa.genero !== genero && previa.genero !== 'u') {
            // Figura en hombre y en mujer y el nombre no dice el género: es unisex.
            previa.genero = 'u';
          }
        }
        leidos += encontrados;
        terminada = encontrados < cfg.porPagina; // una página incompleta (o vacía) es la última
      }
      if (!terminada && !erroresParciales.length) informe.truncados.push({ categoria: cgid, total: null, leido: leidos });
      log(`  ${cgid}: ${leidos} productos leídos`);
    }

    if (ofertas.size === 0 && erroresParciales.length > 0) throw erroresParciales[0];
    if (ofertas.size === 0) throw new ErrorFuente('respuesta_invalida', 'El catálogo no devolvió ofertas válidas');
    const lista = [...ofertas.values()];
    informe.productosLeidos = lista.length; // únicos: un mismo producto puede figurar en hombre y en mujer
    informe.conModelo = lista.filter((o) => o.modelo).length;
    informe.catalogoTotal = lista.length; // la grilla no informa un total aparte: lo leído es lo que hay
    informe.sinCubrir = 0;
    return { ofertas: lista, informe };
  }

  /**
   * Talles disponibles y color de un producto, desde su página (la grilla no los trae). Un pedido por producto: se usa
   * solo con las ofertas que se van a avisar (pedido del usuario, 2026-11-05). Devuelve `{ talles, color }` o null.
   */
  async function leerTalles(oferta, cliente) {
    if (!oferta.url) return null;
    try {
      const { datos: html } = await cliente.obtenerTexto(oferta.url);
      return { talles: tallesDePagina(html), color: colorDePagina(html) };
    } catch {
      return null; // sin talles el aviso sale igual, sin la lista
    }
  }

  return { normalizarProducto, leerCatalogo, leerTalles };
}

/**
 * Talles seleccionables de la página de producto de SFCC: el JSON del producto (con `&quot;`) trae el atributo `size`
 * con cada valor y si se puede elegir (`selectable`). Medido con las Yeezy 350 V2 de Moov el 2026-11-05: 34.5 y 35.5
 * seleccionables, del 36 al 46 no.
 */
export function tallesDePagina(html) {
  const texto = String(html ?? '').replace(/&quot;/g, '"');
  const bloque = /"id":"size"[\s\S]{0,20000}?"values":\[([\s\S]*?)\]\s*[,}]/.exec(texto)
    ?? /"id":"size"([\s\S]{0,20000})/.exec(texto);
  if (!bloque) return null;
  const talles = [];
  const vistos = new Set();
  for (const m of bloque[1].matchAll(/"displayValue":"([^"]+)"[^{}]*?"selectable":(true|false)/g)) {
    if (m[2] !== 'true' || vistos.has(m[1])) continue;
    vistos.add(m[1]);
    talles.push({ t: m[1] });
  }
  return talles;
}

/** Color de la ficha de producto de SFCC: `{"label":"Color","value":["Blanco+Verde"]}` -> "Blanco/Verde". */
export function colorDePagina(html) {
  const texto = String(html ?? '').replace(/&quot;/g, '"');
  const m = /"label":"Color","value":\["([^"]+)"/.exec(texto);
  return m ? decodificar(m[1]).replace(/\+/g, '/').trim() || null : null;
}
