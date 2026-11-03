import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from '../config.mjs';
import { diasEntre } from './fechas.mjs';
import { mlDe } from './internacional.mjs';
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

// Publicaciones que no son el producto nuevo y completo: muestras, decants, testers, réplicas, de chicos, y también packs,
// lotes y combos (el 2026-11-03 un esmalte se comparaba con un "THREE PACK" y un labial con un lote de 5 productos).
const DESCARTE = /\b(decant|decants|sample|samples|tester|vial|mini|travel|unbox(ed)?|no box|without box|refill|empty|bottle only|replica|inspired|dupe|lot|lots|bundle|set|sets|gift set|kit|combo|duo|trio|pack|packs|pk|\d+ ?(pk|pack|pcs|pieces|count|ct)|x ?\d|\d ?x|two|three|four|twin|assorted|variety|kids?|toddler|infant|baby|youth|gs|ps|td|preschool|grade school|used|pre ?owned|damaged)\b/;

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
  if (eanValido(oferta.ean)) return { via: 'ean', clave: `ean:${oferta.ean}`, params: { gtin: oferta.ean }, ml: oferta.ml ?? null };
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

const compacto = (t) => limpiar(t).replace(/[^a-z0-9]/g, '');

// Palabras de la búsqueda por nombre que no tienen por qué aparecer en el título de eBay.
const OPCIONALES = new Set(['mens', 'womens', 'men', 'women', 'nike', 'adidas', 'puma', 'reebok', 'fila', 'vans', 'converse', 'jordan', 'newbalance', 'new', 'balance', 'asics', 'under', 'armour']);

/**
 * Publicaciones que corresponden a la búsqueda. eBay devuelve también parecidos: buscando "puma 401332-04" (RX 737) el
 * 2026-11-03 trajo 19 publicaciones de OTROS modelos de Puma, y ninguna con ese código. Por código de modelo, el título
 * tiene que contener el código; por nombre, todas las palabras del modelo. Por código de barras eBay ya filtra.
 */
export function filtrarPorConsulta(items, consulta) {
  if (!items?.length) return items ?? [];
  if (consulta.via === 'ean') {
    // Hay vendedores que publican otro tamaño con el mismo código (un 1.7 oz bajo el código del 3.4 oz, 2026-11-03):
    // si el título dice un tamaño distinto (±5 %), no cuenta. Sin tamaño en el título, se acepta.
    if (!consulta.ml) return items;
    return items.filter((it) => {
      const ml = mlDe(it.title);
      return !ml || Math.abs(ml - consulta.ml) / consulta.ml <= 0.05;
    });
  }
  if (consulta.via === 'codigo') {
    const codigo = compacto(consulta.params.q.split(' ').at(-1));
    return items.filter((it) => compacto(it.title).includes(codigo));
  }
  const palabras = limpiar(consulta.params.q).split(' ').filter((p) => p && !OPCIONALES.has(p));
  return items.filter((it) => {
    const titulo = ` ${limpiar(it.title).replace(/[^a-z0-9 ]/g, ' ')} `;
    return palabras.every((p) => titulo.includes(` ${p} `) || compacto(it.title).includes(p));
  });
}

const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Precio de mercado en USD a partir de las publicaciones de una búsqueda. Se descartan muestras, testers, packs y
 * similares; después las publicaciones a menos de la mitad de la mediana (otro producto o un error); y del resto se toma
 * el `percentil` (por defecto el cuartil inferior), sin envío salvo `conEnvio`. Son precios PEDIDOS, no vendidos: lo que
 * está caro no se vende y sigue publicado, así que la mediana queda por encima de lo que se paga. Hacen falta al menos
 * `minimo` publicaciones. Devuelve `{ usd, n, url }` o null.
 */
export function precioDePublicaciones(items, {
  minimo = config.ebay.minPublicaciones,
  percentil = config.ebay.percentil ?? 0.25,
  conEnvio = config.ebay.conEnvio ?? false,
} = {}) {
  const validos = [];
  for (const it of items ?? []) {
    if (DESCARTE.test(limpiar(it.title))) continue;
    if (it.price?.currency && it.price.currency !== 'USD') continue;
    const precio = Number(it.price?.value);
    if (!(precio > 0)) continue;
    const envio = conEnvio ? Number(it.shippingOptions?.find((o) => o.shippingCostType === 'FIXED')?.shippingCost?.value) || 0 : 0;
    validos.push({ total: precio + envio, url: it.itemWebUrl });
  }
  if (validos.length < minimo) return null;
  const centro = mediana(validos.map((v) => v.total));
  const razonables = validos.filter((v) => v.total >= centro * 0.5).sort((a, b) => a.total - b.total);
  if (razonables.length < minimo) return null;
  // Percentil con interpolación lineal sobre los precios ordenados.
  const pos = (razonables.length - 1) * percentil;
  const abajo = Math.floor(pos);
  const arriba = Math.min(abajo + 1, razonables.length - 1);
  const valor = razonables[abajo].total + (razonables[arriba].total - razonables[abajo].total) * (pos - abajo);
  return { usd: Math.round(valor * 100) / 100, n: razonables.length, url: razonables[abajo].url };
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
      const r = precioDePublicaciones(filtrarPorConsulta(await buscar(consulta.params), consulta));
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
