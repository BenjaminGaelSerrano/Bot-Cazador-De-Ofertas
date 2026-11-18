import { config } from '../config.mjs';
import { tallesDePagina } from '../fuentes/sfcc.mjs';
import { crearLector } from '../fuentes/vtex.mjs';

// Verificación previa al aviso (pedido del usuario, 2026-11-18: "lo de la fuente de respaldo hacelo con todo lo que va a
// devolver en Telegram antes de devolverlo"). Antes de mandar una oferta se vuelve a mirar, en la propia tienda y en ese
// momento, que siga publicada, que tenga stock y a qué precio está. Una oferta agotada no sale; si el precio cambió, el
// margen se recalcula (ver correr.mjs). Si la tienda no responde, la oferta sale igual (no se pierde por una falla).

const UA = { 'User-Agent': 'Mozilla/5.0' };

/**
 * Devuelve `{ estado: 'ok' | 'agotada' | 'sin-datos', precioActual? }`.
 *  - Tiendas VTEX: la API del producto (por productId o por SKU, según la tienda).
 *  - Tiendas SFCC (Moov, Dexter, Stock Center): la página del producto (precio y talles seleccionables).
 */
export async function verificarEnTienda(oferta, tienda, { fetchFn = fetch, timeoutMs = config.timeoutPedidoMs } = {}) {
  const cfg = config.fuentes[tienda];
  if (!cfg) return { estado: 'sin-datos' };
  try {
    if (cfg.sitio) {
      const res = await fetchFn(oferta.url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404) return { estado: 'agotada' };
      if (!res.ok) return { estado: 'sin-datos' };
      const html = await res.text();
      const talles = tallesDePagina(html);
      if (Array.isArray(talles) && talles.length === 0) return { estado: 'agotada' };
      const precio = /"price":"(\d+)(?:\.\d+)?"/.exec(html)?.[1];
      return { estado: 'ok', ...(precio ? { precioActual: Number(precio) } : {}) };
    }
    const fq = cfg.agrupar === 'producto' ? `productId:${oferta.id}` : `skuId:${oferta.id}`;
    const res = await fetchFn(`${cfg.base}/api/catalog_system/pub/products/search?fq=${fq}`, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { estado: 'sin-datos' };
    const lista = await res.json();
    if (!Array.isArray(lista)) return { estado: 'sin-datos' };
    if (lista.length === 0) return { estado: 'agotada' }; // ya no figura en la tienda
    const { normalizarProducto } = crearLector(cfg);
    const nuevo = lista.flatMap((p) => normalizarProducto(p)).find((o) => String(o.id) === String(oferta.id));
    if (!nuevo || !(nuevo.stock > 0)) return { estado: 'agotada' };
    return { estado: 'ok', precioActual: nuevo.precioActual };
  } catch {
    return { estado: 'sin-datos' };
  }
}
