import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from '../config.mjs';
import { diasEntre } from './fechas.mjs';
import { eanValido } from './mercado.mjs';

// Precio de mercado en eBay EE. UU. (spec 007, pedido del usuario del 2026-11-02): reemplaza al cruce entre tiendas
// argentinas, cuyo precio de lista está inflado 2 a 3 veces respecto de EE. UU. Se consulta la Browse API oficial
// (`item_summary/search`) solo por los productos que hoy están en oferta, y se toma la mediana de las publicaciones
// nuevas más baratas de vendedores de EE. UU., con envío. Búsqueda, de la más a la menos segura:
//  - 'ean': por código de barras (`gtin`): perfumería.
//  - 'codigo': por código de modelo del fabricante (Moov lo trae en el id: NICW2288-111 = Nike CW2288-111).
//  - 'nombre': por marca + modelo + género (Grid, sin códigos): aproximado, se marca con "~".

const API = 'https://api.ebay.com';

const limpiar = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['’´`]/g, '').replace(/[^a-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim();

// Publicaciones que no son el producto nuevo y completo: muestras, decants, testers, réplicas, lotes, de chicos.
const DESCARTE = /\b(decant|decants|sample|samples|tester|vial|mini|travel|unbox(ed)?|no box|without box|refill|empty|bottle only|replica|inspired|dupe|lot of|lots|bundle|set of|gift set|kids?|toddler|infant|baby|youth|gs|ps|td|preschool|grade school|used|pre ?owned|damaged)\b/;

/** Código de modelo de Moov: el id sin las dos letras de la marca (NICW2288-111 -> CW2288-111). */
export function codigoModelo(oferta, fuente) {
  if (fuente !== 'moov') return null;
  const m = /^[A-Z]{2}([A-Z0-9][A-Z0-9-]{3,})$/.exec(String(oferta.id ?? ''));
  return m && /\d/.test(m[1]) ? m[1] : null;
}

// Palabras de las tiendas argentinas que no sirven para buscar en eBay.
const RELLENO = /\b(zapatillas?|urbanas?|ojotas?|botas?|botines?|hombre|mujer|unisex|ninos?|ninas?|kids|de|del|para|con|moda|originals|sportswear|performance|running|training|basket|lifestyle|cuero)\b/g;

/** Texto de búsqueda por nombre (ropa y calzado sin código): marca + modelo + género en inglés. */
export function textoNombre(oferta) {
  let nombre = limpiar(oferta.nombre);
  const marca = limpiar(oferta.marca).replace(/\b(originals|sportswear)\b/g, '').trim();
  nombre = nombre.replace(RELLENO, ' ').replace(/\s+/g, ' ').trim();
  if (marca && !nombre.includes(marca)) nombre = `${marca} ${nombre}`;
  const genero = oferta.genero ?? oferta.gen;
  const sufijo = genero === 'h' ? ' mens' : genero === 'm' ? ' womens' : '';
  return `${nombre}${sufijo}`.trim();
}

/** Cómo buscar una oferta: `{ via, clave, params }` o null si no hay forma segura. */
export function consultaPara(oferta, fuente) {
  if (eanValido(oferta.ean)) return { via: 'ean', clave: `ean:${oferta.ean}`, params: { gtin: oferta.ean } };
  const codigo = codigoModelo(oferta, fuente);
  if (codigo) return { via: 'codigo', clave: `cod:${codigo}`, params: { q: `${limpiar(oferta.marca)} ${codigo}` } };
  // Por nombre solo ropa y calzado (tienen clave de modelo). Un perfume sin código no se busca por nombre: en eBay hay
  // demasiados decants, tamaños y ediciones con el mismo nombre.
  if (oferta.modelo || oferta.km) {
    const q = textoNombre(oferta);
    if (q.split(' ').length >= 2) return { via: 'nombre', clave: `nom:${q}`, params: { q } };
  }
  return null;
}

const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Precio de mercado en USD a partir de las publicaciones de una búsqueda. Se descartan muestras, testers y similares;
 * después las publicaciones a menos de la mitad de la mediana (otro producto o un error); y del resto se toma la
 * mediana de las `tomar` más baratas. Hacen falta al menos `minimo` publicaciones. Devuelve `{ usd, n, url }` o null.
 */
export function precioDePublicaciones(items, { minimo = config.ebay.minPublicaciones, tomar = config.ebay.tomarMasBaratas } = {}) {
  const validos = [];
  for (const it of items ?? []) {
    if (DESCARTE.test(limpiar(it.title))) continue;
    if (it.price?.currency && it.price.currency !== 'USD') continue;
    const precio = Number(it.price?.value);
    if (!(precio > 0)) continue;
    const envio = it.shippingOptions?.find((o) => o.shippingCostType === 'FIXED')?.shippingCost?.value;
    validos.push({ total: precio + (Number(envio) || 0), url: it.itemWebUrl });
  }
  if (validos.length < minimo) return null;
  const centro = mediana(validos.map((v) => v.total));
  const razonables = validos.filter((v) => v.total >= centro * 0.5).sort((a, b) => a.total - b.total);
  if (razonables.length < minimo) return null;
  const baratas = razonables.slice(0, tomar);
  const usd = Math.round(mediana(baratas.map((v) => v.total)) * 100) / 100;
  return { usd, n: razonables.length, url: baratas[0].url };
}

class SinCupo extends Error {}

/**
 * Servicio de precios de eBay para una corrida. `precio(oferta, fuente)` devuelve:
 *  - `{ estado: 'ok', precio, usd, n, via, url }` (`precio` en pesos, con el dólar blue medio),
 *  - `{ estado: 'sin' }` (no hay forma de buscarlo o eBay no tiene suficientes publicaciones),
 *  - `{ estado: 'pendiente' }` (cupo agotado, límite de eBay o error: se reintenta en la próxima corrida).
 */
export function crearEbay({
  clientId,
  clientSecret,
  dolar,
  hoy,
  rutaCache,
  fetchFn = fetch,
  cfg = config.ebay,
  log = console.log,
}) {
  let token = null;
  let cache = {};
  let cargado = false;
  let modificado = false;
  let consultas = 0;
  let corte = null;

  async function cargar() {
    if (cargado) return;
    cargado = true;
    try {
      cache = JSON.parse(await readFile(rutaCache, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') log(`Caché de eBay ilegible (${error.message}): se arranca vacío.`);
    }
  }

  async function obtenerToken() {
    const basica = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetchFn(`${API}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basica}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
      signal: AbortSignal.timeout(config.timeoutPedidoMs),
    });
    // Nunca se loguea la respuesta entera ni las credenciales.
    if (res.status !== 200) throw new Error(`eBay rechazó las credenciales (${res.status})`);
    const datos = await res.json();
    token = datos.access_token;
  }

  async function buscar(params, reintento = false) {
    if (corte) throw corte;
    if (consultas >= cfg.maxConsultasPorCorrida) throw new SinCupo();
    if (!token) await obtenerToken();
    consultas++;
    const qs = new URLSearchParams({
      ...params,
      filter: `conditionIds:{1000},buyingOptions:{FIXED_PRICE},itemLocationCountry:US,deliveryCountry:US,priceCurrency:USD`,
      limit: String(cfg.limite),
    });
    const res = await fetchFn(`${API}/buy/browse/v1/item_summary/search?${qs}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US', Accept: 'application/json' },
      signal: AbortSignal.timeout(config.timeoutPedidoMs),
    });
    if (res.status === 401 && !reintento) { token = null; return buscar(params, true); } // token vencido
    if (res.status === 429 || res.status === 403) {
      corte = new Error(`eBay respondió ${res.status}: no se consulta más en esta corrida`);
      log(corte.message);
      throw corte;
    }
    if (res.status === 204) return [];
    if (!res.ok) throw new Error(`eBay respondió ${res.status}`);
    return (await res.json()).itemSummaries ?? [];
  }

  const resultado = (r, via) => (r.sin
    ? { estado: 'sin' }
    : { estado: 'ok', precio: Math.round(r.usd * dolar), usd: r.usd, n: r.n, via, url: r.url });

  async function precio(oferta, fuente) {
    if (!dolar) return { estado: 'sin' };
    const consulta = consultaPara(oferta, fuente);
    if (!consulta) return { estado: 'sin' };
    await cargar();
    const guardado = cache[consulta.clave];
    if (guardado && diasEntre(guardado.visto, hoy) < cfg.vigenciaDias) return resultado(guardado, consulta.via);
    try {
      const r = precioDePublicaciones(await buscar(consulta.params));
      cache[consulta.clave] = r ? { ...r, visto: hoy } : { sin: 1, visto: hoy };
      modificado = true;
      return resultado(cache[consulta.clave], consulta.via);
    } catch (error) {
      if (!(error instanceof SinCupo) && error !== corte) log(`eBay: "${oferta.nombre}" quedó pendiente (${error.message})`);
      if (error.message.startsWith('eBay rechazó las credenciales')) corte = error;
      return { estado: 'pendiente' };
    }
  }

  /** Resultado guardado y vigente, sin pedir nada (null si no hay). Sirve para ordenar sin gastar cupo. */
  async function enCache(oferta, fuente) {
    if (!dolar) return null;
    const consulta = consultaPara(oferta, fuente);
    if (!consulta) return null;
    await cargar();
    const guardado = cache[consulta.clave];
    return guardado && diasEntre(guardado.visto, hoy) < cfg.vigenciaDias ? resultado(guardado, consulta.via) : null;
  }

  async function guardar() {
    if (!modificado) return;
    await mkdir(dirname(rutaCache), { recursive: true });
    const temporal = `${rutaCache}.tmp`;
    await writeFile(temporal, `${JSON.stringify(cache, null, 1)}\n`, 'utf8');
    await rename(temporal, rutaCache);
  }

  return {
    nombre: 'ebay',
    precio,
    enCache,
    guardar,
    get consultas() { return consultas; },
    get corte() { return corte; },
  };
}
