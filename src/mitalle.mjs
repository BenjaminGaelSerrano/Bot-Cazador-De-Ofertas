// Ofertas de calzado en el talle del usuario (44,5 / 45 / 45,5 / 46; pedido del 2026-11-09: "buscá siempre por ahí").
// Moov, Dexter y Stock Center (SFCC): la grilla se filtra por talle en el propio sitio (prefn1=size). Grid, Dash y
// Sporting (VTEX): los talles con stock vienen en el catálogo. Uso: node src/mitalle.mjs --datos datos [--top 40] [--ebay]
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { config } from './config.mjs';
import { bajaHabitual } from './bajas.mjs';
import { colorDePagina, crearLectorSfcc, parsearGrilla, tallesDePagina } from './fuentes/sfcc.mjs';
import { crearLector } from './fuentes/vtex.mjs';
import { consultaPara, filtrarPorConsulta, percentilDe, publicacionesValidas } from './nucleo/ebay.mjs';
import { diasEntre, hoyArgentina } from './nucleo/fechas.mjs';
import { crearCliente } from './nucleo/http.mjs';
import { esDeMujer } from './nucleo/prioridad.mjs';

export const MIS_TALLES = [44.5, 45, 45.5, 46];

/** ¿Alguno de los números del talle es de los míos? ("45", "45.5", "44-44.5" de Dexter). */
export function esMiTalle(t, mios = MIS_TALLES) {
  return [...String(t).matchAll(/\d+(?:[.,]\d+)?/g)].some((m) => mios.includes(Number(m[0].replace(',', '.'))));
}

const UA = { 'User-Agent': 'Mozilla/5.0' };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const SFCC = ['moov', 'dexter', 'stockcenter'];
const VTEX = ['grid', 'dash', 'sporting'];

async function leerSfcc(tienda) {
  const cfg = config.fuentes[tienda];
  const { normalizarProducto } = crearLectorSfcc(cfg);
  const ofertas = new Map();
  const valores = encodeURIComponent(MIS_TALLES.join('|'));
  for (const pagina of Array.from({ length: 40 }, (_, i) => i)) {
    const url = `${cfg.base}/on/demandware.store/${cfg.sitio}/default/Search-UpdateGrid?cgid=hombre-calzado&prefn1=size&prefv1=${valores}&start=${pagina * cfg.porPagina}&sz=${cfg.porPagina}`;
    const html = await (await fetch(url, { headers: UA })).text();
    const { productos, encontrados } = parsearGrilla(html);
    for (const p of productos) if (!ofertas.has(p.pid)) ofertas.set(p.pid, normalizarProducto(p, { genero: 'h' }));
    if (encontrados < cfg.porPagina) break;
    await dormir(300);
  }
  return [...ofertas.values()];
}

async function leerVtex(tienda) {
  const { leerCatalogo } = crearLector(config.fuentes[tienda]);
  const { ofertas } = await leerCatalogo(crearCliente({ pausaMs: 300 }), { log: () => {} });
  return ofertas.filter((o) => /calzado|zapatill|ojota|bota/i.test(`${o.categoria} ${o.nombre}`) && (o.talles ?? []).some((x) => esMiTalle(x.t)));
}

async function cargarHistorial(datos, tienda) {
  try { return JSON.parse(await readFile(`${datos}/${tienda}/historial.json`, 'utf8')).productos; } catch { return {}; }
}

async function detalleSfcc(o) {
  try {
    const html = await (await fetch(o.url, { headers: UA })).text();
    return { talles: (tallesDePagina(html) ?? []).filter((x) => esMiTalle(x.t)), color: colorDePagina(html) };
  } catch { return null; }
}

async function tokenEbay() {
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope' });
  return (await r.json()).access_token;
}

async function medianaEbay(token, o, tienda) {
  const q = consultaPara(o, tienda);
  if (!q) return null;
  const qs = new URLSearchParams({ ...q.params, filter: 'conditionIds:{1000},buyingOptions:{FIXED_PRICE},itemLocationCountry:US,deliveryCountry:US,priceCurrency:USD', limit: '50' });
  const r = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${qs}`, { headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } });
  const val = publicacionesValidas(filtrarPorConsulta((await r.json()).itemSummaries ?? [], q));
  return val.length >= 3 ? { usd: percentilDe(val.map((v) => v.precio), 0.5), n: val.length } : null;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const { values: a } = parseArgs({ options: { datos: { type: 'string', default: 'datos' }, top: { type: 'string', default: '40' }, ebay: { type: 'boolean', default: false }, dolar: { type: 'string', default: '1545' } } });
  const hoy = hoyArgentina();
  const candidatas = [];
  for (const tienda of [...SFCC, ...VTEX]) {
    const ofertas = SFCC.includes(tienda) ? await leerSfcc(tienda) : await leerVtex(tienda);
    const historial = await cargarHistorial(a.datos, tienda);
    let n = 0;
    for (const o of ofertas) {
      if (esDeMujer({ ...o, genero: o.genero === 'm' ? 'm' : o.genero }) || o.genero === 'n' || /\b(ni[nñ]os?|ni[nñ]as?|kids?)\b/i.test(o.nombre)) continue;
      const desc = o.precioLista > o.precioActual ? 1 - o.precioActual / o.precioLista : 0;
      const b = historial[o.id] ? bajaHabitual(historial[o.id].obs, hoy) : null;
      if (desc < config.descuentoMinimo && !(b && b.baja >= 0.15)) continue;
      candidatas.push({ tienda, o, desc, baja: b?.baja ?? null, desde: b?.desde ?? null, puntaje: b ? Math.max(b.baja, desc * 0.5) : desc * 0.5 });
      n++;
    }
    console.error(`${tienda}: ${ofertas.length} con mi talle, ${n} con descuento`);
  }
  candidatas.sort((x, y) => y.puntaje - x.puntaje);

  const token = a.ebay ? await tokenEbay() : null;
  const salida = [];
  for (const c of candidatas) {
    if (salida.length >= Number(a.top)) break;
    let talles = c.o.talles;
    let color = c.o.color ?? null;
    if (SFCC.includes(c.tienda)) {
      const d = await detalleSfcc(c.o);
      if (!d || d.talles.length === 0) continue; // agotado en mi talle
      talles = d.talles; color = d.color;
      await dormir(250);
    } else {
      talles = (talles ?? []).filter((x) => esMiTalle(x.t));
    }
    const ref = token ? await medianaEbay(token, { ...c.o, codigo: c.o.codigo }, c.tienda) : null;
    salida.push({ ...c, talles, color, ref });
  }
  const k = (n) => `$${Math.round(n / 1000)}k`;
  console.log(`${candidatas.length} ofertas con descuento en mi talle; se muestran ${salida.length}\n`);
  console.log('| # | Producto | Tienda | Ahora | Lista | Desc. | Baja real | Mis talles | Color | eBay publicado |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  salida.forEach((s, i) => {
    const t = s.talles.map((x) => x.t + (Number.isFinite(x.u) && x.u <= 2 ? ` (${x.u} u.)` : '')).join(', ');
    const e = s.ref ? `US$${Math.round(s.ref.usd)} ≈ ${k(s.ref.usd * Number(a.dolar))} (${Math.round(((s.ref.usd * Number(a.dolar)) / s.o.precioActual - 1) * 100)}%, ${s.ref.n} publ.)` : '';
    console.log(`| ${i + 1} | [${s.o.nombre.replace(/\|/g, '/').slice(0, 52)}](${s.o.url}) | ${s.tienda} | ${k(s.o.precioActual)} | ${k(s.o.precioLista)} | -${Math.round(s.desc * 100)}% | ${s.baja ? `-${Math.round(s.baja * 100)}% (${s.desde.slice(5)})` : ''} | ${t} | ${s.color ?? ''} | ${e} |`);
  });
}
