import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from '../config.mjs';
import { diasEntre } from './fechas.mjs';
import { ErrorFuente } from './http.mjs';
import { eanValido } from './mercado.mjs';

// Referencia internacional (constitución §4, condición 2; spec 006): a cuánto se vende el mismo perfume en EE. UU.
// Fuente: Perfumania (Shopify, USD). Se empareja por código de barras y, si no hay, por marca + nombre +
// concentración + tamaño (aproximado). Se pide lo menos posible: solo para lo que se va a avisar, con lo encontrado
// guardado `vigenciaDias`, un tope de pedidos por corrida y sin insistir ante un bloqueo.

const ML_POR_OZ = 29.5735;

const sinAcentos = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const limpiar = (s) => sinAcentos(String(s ?? '')).replace(/['’´`]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const palabras = (s) => limpiar(s).split(' ').filter(Boolean);

// El orden importa: "eau de parfum" también contiene "parfum".
const CONCENTRACIONES = [
  ['edp', /\b(edp|eau de parfum|eau parfum)\b/],
  ['edt', /\b(edt|eau de toilette)\b/],
  ['edc', /\b(edc|eau de cologne)\b/],
  ['parfum', /\b(parfum|extrait)\b/],
];

/** 'edp' | 'edt' | 'edc' | 'parfum' | null. */
export function concentracion(texto) {
  const t = limpiar(texto);
  for (const [nombre, re] of CONCENTRACIONES) if (re.test(t)) return nombre;
  return null;
}

/** Perfume = tiene tamaño en ml y es de una categoría de fragancias o dice su concentración. */
export function esPerfume(oferta) {
  if (!oferta?.ml) return false;
  if (/fragan|perfum/i.test(oferta.categoria ?? oferta.cat ?? '')) return true;
  return concentracion(oferta.nombre) !== null;
}

// Lo que no es un perfume aunque esté en la categoría de fragancias: cremas, geles, desodorantes, after shave, etc.
const NO_PERFUME = /\b(body|lotion|locion corporal|crema|cream|creme|gel|shower|ducha|deo|desodorante|deodorant|antitranspirante|after ?shave|balm|balsamo|jabon|soap|hair|cabello|capilar|talco|powder|polvo|maquillaje|labial|esmalte|mascara|serum|tratamiento)\b/;

/** Solo perfumes (pedido del usuario, 2026-11-03): ni maquillaje, ni cremas, ni tratamientos, ni complementos. */
export function esSoloPerfume(oferta) {
  return esPerfume(oferta) && !NO_PERFUME.test(limpiar(oferta.nombre));
}

// Variantes y productos que no son el frasco que se vende en la tienda argentina.
const NO_COMPARABLE = /\b(tester|unboxed|gift|set|coffret|mini|travel|refill|sample|vial|bundle|body|lotion|deodorant|deo|shower|gel|balm|after ?shave|hair|roll ?on|rollerball|candle)\b/;
export const comparable = (...textos) => !textos.some((t) => NO_COMPARABLE.test(limpiar(t)));

/** "3.4 oz." -> 100.5; "100 ml" -> 100; si no dice el tamaño, null. */
export function mlDe(texto) {
  const t = String(texto ?? '').toLowerCase().replace(',', '.');
  const oz = t.match(/(\d+(?:\.\d+)?)\s*(?:fl\.?\s*)?oz/);
  if (oz) return Number(oz[1]) * ML_POR_OZ;
  const ml = t.match(/(\d+(?:\.\d+)?)\s*ml\b/);
  return ml ? Number(ml[1]) : null;
}

// Palabras que no distinguen un perfume de otro (o que ya se comparan aparte, como la concentración).
const RUIDO = new Set(['eau', 'de', 'du', 'la', 'le', 'edp', 'edt', 'edc', 'parfum', 'extrait', 'toilette', 'cologne', 'perfume',
  'spray', 'vaporisateur', 'natural', 'for', 'men', 'women', 'man', 'woman', 'ml', 'oz', 'fl', 'y', 'and', 'by']);

/** Marcas compatibles: las palabras de una están todas en la otra ("RABANNE" y "Paco Rabanne"). */
export function mismaMarca(a, b) {
  const pa = palabras(a);
  const pb = palabras(b);
  if (pa.length === 0 || pb.length === 0) return false;
  return pa.every((p) => pb.includes(p)) || pb.every((p) => pa.includes(p));
}

/** Clave del nombre sin marca, tamaño, concentración ni relleno: las palabras que quedan, ordenadas. */
export function claveNombre(nombre, marcas) {
  const deMarca = new Set(marcas.flatMap(palabras));
  const quedan = palabras(String(nombre).replace(/\d+(?:[.,]\d+)?\s*(?:ml|oz)\b\.?/gi, ' '))
    .filter((p) => !RUIDO.has(p) && !deMarca.has(p));
  return [...new Set(quedan)].sort().join(' ');
}

/**
 * Busca, en una ficha de Perfumania (`/products/<handle>.json`), la variante que corresponde a la oferta.
 * Devuelve `{ usd, via: 'ean' | 'nombre', variante }` o null. Por código de barras basta con que coincida; por
 * nombre tienen que coincidir marca, nombre, concentración y tamaño (±`toleranciaMl`), y la concentración de los dos
 * tiene que conocerse.
 */
export function emparejar(oferta, producto, { toleranciaMl = config.internacional.perfumania.toleranciaMl } = {}) {
  if (!producto?.variants?.length || !comparable(producto.title, producto.handle, producto.product_type)) return null;
  const variantes = producto.variants.filter((v) => comparable(v.title) && Number(v.price) > 0);

  if (eanValido(oferta.ean)) {
    const v = variantes.find((x) => String(x.barcode ?? '').replace(/^0+/, '') === oferta.ean.replace(/^0+/, ''));
    if (v) return { usd: Number(v.price), via: 'ean', variante: v.title };
  }

  if (!mismaMarca(oferta.marca, producto.vendor)) return null;
  const concOferta = concentracion(oferta.nombre);
  const concProducto = concentracion(`${producto.product_type ?? ''} ${String(producto.handle ?? '').replace(/-/g, ' ')}`);
  if (!concOferta || concOferta !== concProducto) return null;
  const marcas = [oferta.marca, producto.vendor];
  const clave = claveNombre(oferta.nombre, marcas);
  if (!clave || clave !== claveNombre(producto.title, marcas)) return null;
  const v = variantes.find((x) => {
    const ml = mlDe(x.title);
    return ml && Math.abs(ml - oferta.ml) / oferta.ml <= toleranciaMl;
  });
  return v ? { usd: Number(v.price), via: 'nombre', variante: v.title } : null;
}

/** Clave del caché: el código de barras si lo hay; si no, marca + ml + nombre. */
export function claveCache(oferta) {
  if (eanValido(oferta.ean)) return `ean:${oferta.ean}`;
  return `nom:${limpiar(oferta.marca)}|${oferta.ml}|${claveNombre(oferta.nombre, [oferta.marca])}`;
}

/** Texto de búsqueda: marca + nombre, sin el tamaño (Perfumania lo escribe en onzas). */
export function textoBusqueda(oferta) {
  const nombre = String(oferta.nombre).replace(/\d+(?:[.,]\d+)?\s*ml\b/gi, ' ');
  const base = limpiar(nombre).includes(limpiar(oferta.marca)) ? nombre : `${oferta.marca} ${nombre}`;
  return limpiar(base.replace(/\+.*$/, '')); // "EDP 100 ml + Shower Gel": lo que sigue al "+" es el regalo
}

class SinCupo extends Error {}

/**
 * Servicio de referencias de una corrida (compartido por todas las tiendas). `dolar` es el blue medio; sin dólar, no
 * se puede convertir y toda oferta queda "sin referencia". Estados de `buscar`:
 *  - `{ estado: 'ok', usd, pesos, via, url }`: hay precio en EE. UU.
 *  - `{ estado: 'sin' }`: se buscó y no está (o no es un perfume, o no hay dólar).
 *  - `{ estado: 'pendiente' }`: no se pudo buscar en esta corrida (cupo agotado o bloqueo); se reintenta en la próxima.
 */
export function crearReferencias({
  cliente,
  dolar,
  hoy,
  rutaCache,
  cfg = config.internacional,
  log = console.log,
}) {
  const p = cfg.perfumania;
  let cache = {};
  let cargado = false;
  let pedidos = 0;
  let bloqueo = null;
  let modificado = false;

  async function cargar() {
    if (cargado) return;
    cargado = true;
    try {
      cache = JSON.parse(await readFile(rutaCache, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') log(`Caché de referencias ilegible (${error.message}): se arranca vacío.`);
    }
  }

  async function pedir(url) {
    if (bloqueo) throw bloqueo;
    if (pedidos >= p.maxPedidosPorCorrida) throw new SinCupo();
    pedidos++;
    try {
      return (await cliente.obtenerJson(url)).datos;
    } catch (error) {
      if (error instanceof ErrorFuente && error.tipo === 'bloqueo') {
        bloqueo = error;
        log(`Perfumania bloqueó el pedido (${error.status}). No se consulta más en esta corrida.`);
      }
      throw error;
    }
  }

  async function consultar(oferta) {
    const q = encodeURIComponent(textoBusqueda(oferta));
    const sugerencias = await pedir(`${p.base}/search/suggest.json?q=${q}&resources%5Btype%5D=product&resources%5Blimit%5D=10`);
    const candidatos = (sugerencias?.resources?.results?.products ?? [])
      // Se ahorran pedidos: solo fichas de una marca compatible y que no sean combos. Por código de barras la marca
      // podría diferir en la escritura, así que, si hay EAN, solo se descartan los combos.
      .filter((c) => comparable(c.title, c.handle) && (eanValido(oferta.ean) || !c.vendor || mismaMarca(oferta.marca, c.vendor)))
      .slice(0, p.resultadosBusqueda);
    let porNombre = null;
    for (const c of candidatos) {
      let producto;
      try {
        producto = (await pedir(`${p.base}/products/${encodeURIComponent(c.handle)}.json`))?.product;
      } catch (error) {
        if (error instanceof ErrorFuente && error.tipo === 'cliente') continue; // ficha que ya no existe
        throw error;
      }
      const par = emparejar(oferta, producto);
      const url = `${p.base}/products/${c.handle}`;
      if (par?.via === 'ean') return { ...par, url };
      if (par && !porNombre) porNombre = { ...par, url };
    }
    return porNombre;
  }

  async function buscar(oferta) {
    if (!dolar || !esPerfume(oferta)) return { estado: 'sin' };
    await cargar();
    const clave = claveCache(oferta);
    const guardado = cache[clave];
    if (guardado && diasEntre(guardado.visto, hoy) < cfg.vigenciaDias) return resultado(guardado);

    try {
      const par = await consultar(oferta);
      cache[clave] = par ? { usd: par.usd, via: par.via, url: par.url, variante: par.variante, visto: hoy } : { sin: 1, visto: hoy };
      modificado = true;
      return resultado(cache[clave]);
    } catch (error) {
      if (error instanceof SinCupo || error === bloqueo) return { estado: 'pendiente' };
      // Otro error (5xx tras los reintentos, respuesta rara): esta oferta queda pendiente y se sigue con las demás.
      log(`Referencia de "${oferta.nombre}" no disponible: ${error.message}`);
      return { estado: 'pendiente' };
    }
  }

  const resultado = (r) => (r.sin
    ? { estado: 'sin' }
    : { estado: 'ok', usd: r.usd, pesos: Math.round(r.usd * dolar), via: r.via, url: r.url });

  async function guardar() {
    if (!modificado) return;
    await mkdir(dirname(rutaCache), { recursive: true });
    const temporal = `${rutaCache}.tmp`;
    await writeFile(temporal, `${JSON.stringify(cache, null, 1)}\n`, 'utf8');
    await rename(temporal, rutaCache);
  }

  return {
    buscar,
    guardar,
    get pedidos() { return pedidos; },
    get bloqueo() { return bloqueo; },
  };
}

/** Dólar blue medio de dolarapi.com, o null si no responde (entonces la condición 2 no se aplica). */
export async function obtenerDolar(cliente, { url = config.internacional.dolarUrl, log = console.log } = {}) {
  try {
    const { datos } = await cliente.obtenerJson(url);
    const medio = (Number(datos.compra) + Number(datos.venta)) / 2;
    return medio > 100 ? medio : null;
  } catch (error) {
    log(`Sin dólar blue (${error.message}): esta corrida no compara contra el precio internacional.`);
    return null;
  }
}
