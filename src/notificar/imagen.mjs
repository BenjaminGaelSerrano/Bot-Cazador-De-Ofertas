import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from '../config.mjs';

// Foto de cada oferta (pedido del usuario, 2026-11-26: "que abajo de cada link salga una imagen"). Se toma la imagen
// principal que declara la página del producto (og:image y similares), así sirve para cualquier tienda. Lo ya buscado se
// guarda en datos/imagenes.json para no volver a pedir la página en cada corrida.

let cache = {};
let rutaCache = null;
let modificada = false;

export async function usarCacheDeImagenes(ruta) {
  rutaCache = ruta;
  try { cache = JSON.parse(await readFile(ruta, 'utf8')); } catch { cache = {}; }
}

export async function guardarCacheDeImagenes() {
  if (!rutaCache || !modificada) return;
  await mkdir(dirname(rutaCache), { recursive: true });
  await writeFile(`${rutaCache}.tmp`, JSON.stringify(cache));
  await rename(`${rutaCache}.tmp`, rutaCache);
}

const sinEntidades = (s) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/\\\//g, '/');

/** La dirección de la imagen principal declarada en el HTML de un producto, o null. */
export function imagenDeHtml(html, urlPagina) {
  const t = String(html);
  const meta = (nombre) => new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${nombre}["'][^>]*\\scontent=["']([^"']+)["']`, 'i').exec(t)?.[1]
    ?? new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${nombre}["']`, 'i').exec(t)?.[1];
  const cruda = meta('og:image:secure_url') ?? meta('og:image') ?? meta('twitter:image') ?? meta('image')
    ?? /"@type"\s*:\s*"Product"[\s\S]{0,1500}?"image"\s*:\s*\[?\s*"([^"]+)"/.exec(t)?.[1]
    // Tiendanube sin og:image: la primera foto de producto de su CDN.
    ?? /((?:https?:)?\/\/[a-z0-9.-]*mitiendanube\.com\/stores\/[^"'\s,]+\/products\/[^"'\s,]+\.(?:webp|jpe?g|png))/i.exec(t)?.[1];
  if (!cruda) return null;
  try { return new URL(sinEntidades(cruda.trim()), urlPagina).href.replace(/^http:\/\//, 'https://'); } catch { return null; }
}

/** Tiendas VTEX cuya página no declara la imagen (Grid, Dash, Tommy): se le pide al catálogo (".../nombre/p"). */
async function imagenVtex(url, { fetchFn, timeoutMs }) {
  const m = /^(https:\/\/[^/]+)\/([^/?#]+)\/p(?:[?#]|$)/.exec(url);
  if (!m) return null;
  const res = await fetchFn(`${m[1]}/api/catalog_system/pub/products/search/${m[2]}/p`, { headers: { 'User-Agent': config.userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return null;
  return (await res.json())?.[0]?.items?.[0]?.images?.[0]?.imageUrl?.replace(/^http:\/\//, 'https://') ?? null;
}

export async function imagenDe(url, { fetchFn = fetch, timeoutMs = config.timeoutPedidoMs } = {}) {
  if (cache[url]) return cache[url];
  try {
    const res = await fetchFn(url, { headers: { 'User-Agent': config.userAgent, Accept: 'text/html' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const imagen = imagenDeHtml(await res.text(), url) ?? await imagenVtex(url, { fetchFn, timeoutMs });
    if (imagen) { cache[url] = imagen; modificada = true; }
    return imagen;
  } catch {
    return null; // sin foto: la oferta sale igual, en texto
  }
}
