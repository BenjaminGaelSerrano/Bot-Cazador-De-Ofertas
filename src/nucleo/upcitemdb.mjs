import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from '../config.mjs';
import { diasEntre } from './fechas.mjs';
import { eanValido } from './mercado.mjs';

// Precio de mercado provisorio mientras eBay aprueba la cuenta (spec 007, 2026-11-02): UPCitemdb, una base pública de
// códigos de barras que junta precios de tiendas de EE. UU. (Target, Kohl's, Walmart, perfumerías online). Sin cuenta:
// 100 consultas por día. Solo sirve para productos con código de barras (perfumería y cosmética); lo demás queda sin
// referencia. Mismo contrato que `crearEbay`, así se reemplazan sin tocar nada más.
//
// Trae muchas ofertas viejas (de 2015 en adelante) y algunas en otras monedas: se usan solo las de los últimos
// `diasOferta` días, en dólares, y el precio es la mediana de las `tomar` más baratas.

const API = 'https://api.upcitemdb.com/prod/trial/lookup';
const DIA = 86_400;

const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Precio en USD a partir de las ofertas de un ítem de UPCitemdb, o null. `ahora` en segundos. */
export function precioDeOfertas(offers, ahora, { diasOferta = config.upcitemdb.diasOferta, tomar = config.upcitemdb.tomarMasBaratas } = {}) {
  const recientes = (offers ?? []).filter((o) => (o.currency === '' || o.currency === 'USD' || o.currency === undefined)
    && (!o.condition || /new/i.test(o.condition))
    && Number(o.price) > 0
    && ahora - Number(o.updated_t) <= diasOferta * DIA);
  if (recientes.length === 0) return null;
  const precios = recientes.map((o) => Number(o.price));
  const centro = mediana(precios);
  const razonables = recientes.filter((o) => Number(o.price) >= centro * 0.4).sort((a, b) => a.price - b.price);
  const baratas = razonables.slice(0, tomar);
  return {
    usd: Math.round(mediana(baratas.map((o) => Number(o.price))) * 100) / 100,
    n: razonables.length,
    url: baratas[0].link ?? null,
    tiendas: baratas.map((o) => o.merchant),
  };
}

class SinCupo extends Error {}

const dormirReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function crearUpcitemdb({
  dolar,
  hoy,
  rutaCache,
  fetchFn = fetch,
  cfg = config.upcitemdb,
  ahora = () => Math.floor(Date.now() / 1000),
  dormir = dormirReal,
  log = console.log,
}) {
  let cache = {};
  let cargado = false;
  let modificado = false;
  let consultas = 0;
  let corte = null;
  let ultimo = 0;

  async function cargar() {
    if (cargado) return;
    cargado = true;
    try {
      cache = JSON.parse(await readFile(rutaCache, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') log(`Caché de UPCitemdb ilegible (${error.message}): se arranca vacío.`);
    }
  }

  async function consultar(ean) {
    if (corte) throw corte;
    if (consultas >= cfg.maxConsultasPorCorrida) throw new SinCupo();
    const falta = ultimo + cfg.pausaMs - Date.now();
    if (falta > 0 && consultas > 0) await dormir(falta);
    ultimo = Date.now();
    consultas++;
    const res = await fetchFn(`${API}?upc=${ean}`, {
      headers: { Accept: 'application/json', 'User-Agent': config.userAgent },
      signal: AbortSignal.timeout(config.timeoutPedidoMs),
    });
    if (res.status === 429 || res.status === 403) {
      corte = new Error(`UPCitemdb respondió ${res.status} (límite diario): no se consulta más en esta corrida`);
      log(corte.message);
      throw corte;
    }
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`UPCitemdb respondió ${res.status}`);
    const datos = await res.json();
    return datos.items ?? [];
  }

  const resultado = (r) => (r.sin
    ? { estado: 'sin' }
    : { estado: 'ok', precio: Math.round(r.usd * dolar), usd: r.usd, n: r.n, via: 'ean', url: r.url });

  async function precio(oferta) {
    if (!dolar || !eanValido(oferta.ean)) return { estado: 'sin' };
    await cargar();
    const clave = `ean:${oferta.ean}`;
    const guardado = cache[clave];
    if (guardado && diasEntre(guardado.visto, hoy) < cfg.vigenciaDias) return resultado(guardado);
    try {
      const items = await consultar(oferta.ean);
      const r = items.length ? precioDeOfertas(items[0].offers, ahora()) : null;
      cache[clave] = r ? { ...r, visto: hoy } : { sin: 1, visto: hoy };
      modificado = true;
      return resultado(cache[clave]);
    } catch (error) {
      if (!(error instanceof SinCupo) && error !== corte) log(`UPCitemdb: "${oferta.nombre}" quedó pendiente (${error.message})`);
      return { estado: 'pendiente' };
    }
  }

  async function guardar() {
    if (!modificado) return;
    await mkdir(dirname(rutaCache), { recursive: true });
    const temporal = `${rutaCache}.tmp`;
    await writeFile(temporal, `${JSON.stringify(cache, null, 1)}\n`, 'utf8');
    await rename(temporal, rutaCache);
  }

  return {
    nombre: 'upcitemdb',
    leyenda: 'Costo · Merc. (tiendas EE.UU., en pesos) · Gana (margen)',
    concurrencia: 1, // el límite gratuito no admite pedidos en paralelo
    precio,
    guardar,
    get consultas() { return consultas; },
    get corte() { return corte; },
  };
}
