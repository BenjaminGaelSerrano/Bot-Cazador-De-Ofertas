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

// Casa del usuario: Parque Chas, CABA (aprox.). Radio máximo de retiro: 7 km (pedido del 2026-11-09).
export const CASA = { lat: -34.5875, lng: -58.4805 };
export const RADIO_RETIRO_KM = 7;

/** Distancia en km entre dos puntos (haversine). */
export function distanciaKm(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/**
 * Talles seleccionables de la ficha de un producto SFCC con su código por talle ("sku"), solo los del usuario.
 * `{ id: '44.5', sku: 'NIDA6364-001_11.5_1' }`
 */
export function skusDeMisTalles(html) {
  const texto = String(html ?? '').replace(/&quot;/g, '"');
  const salida = [];
  for (const m of texto.matchAll(/"id":"([^"]+)","description":[^,]*,"displayValue":"[^"]*","value":"[^"]*","selected":(?:true|false),"selectable":(true|false),"sku":"([^"]+)"/g)) {
    if (m[2] === 'true' && esMiTalle(m[1])) salida.push({ id: m[1], sku: m[3] });
  }
  return salida;
}

/** Sucursales con stock de ese código (talle) a `radio` km o menos de la casa del usuario: `[{ nombre, direccion, km }]`. */
async function sucursalesCerca(cfg, sku, radio = RADIO_RETIRO_KM) {
  const url = `${cfg.base}/on/demandware.store/${cfg.sitio}/default/Stores-InventorySearch?products=${encodeURIComponent(sku)}:1&radius=15&lat=${CASA.lat}&long=${CASA.lng}`;
  try {
    const j = await (await fetch(url, { headers: { ...UA, 'X-Requested-With': 'XMLHttpRequest' } })).json();
    return (j.stores ?? [])
      .map((s) => ({ nombre: s.name, direccion: [s.address1, s.city].filter(Boolean).join(', '), km: distanciaKm(CASA, { lat: Number(s.latitude), lng: Number(s.longitude) }) }))
      .filter((s) => Number.isFinite(s.km) && s.km <= radio)
      .sort((x, y) => x.km - y.km);
  } catch { return []; }
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
    // Moov y Dexter marcan en la ficha si el producto solo se puede retirar en sucursal (sin envío a domicilio).
    const soloRetiro = /"isOnlyAvailableForInStorePickup":true/.test(html.replace(/&quot;/g, '"'));
    return { talles: (tallesDePagina(html) ?? []).filter((x) => esMiTalle(x.t)), color: colorDePagina(html), soloRetiro, skus: skusDeMisTalles(html) };
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
  const { values: a } = parseArgs({ options: { datos: { type: 'string', default: 'datos' }, top: { type: 'string', default: '40' }, ebay: { type: 'boolean', default: false }, dolar: { type: 'string', default: '1545' },
    marcas: { type: 'string', default: '' }, // "nike,jordan": solo esas marcas (en la marca o el nombre)
    todas: { type: 'boolean', default: false }, // sin exigir descuento: se compara todo contra eBay
    'max-ebay': { type: 'string', default: '200' },
    'incluir-retiro': { type: 'boolean', default: false } } }); // por defecto se descarta lo que es solo retiro en sucursal
  let omitidasPorRetiro = 0;
  const marcas = a.marcas ? new RegExp(`\\b(${a.marcas.split(',').map((m) => m.trim()).filter(Boolean).join('|')})\\b`, 'i') : null;
  const hoy = hoyArgentina();
  const candidatas = [];
  for (const tienda of [...SFCC, ...VTEX]) {
    const ofertas = SFCC.includes(tienda) ? await leerSfcc(tienda) : await leerVtex(tienda);
    const historial = await cargarHistorial(a.datos, tienda);
    let n = 0;
    for (const o of ofertas) {
      if ((config.avisar.excluirMujer && esDeMujer(o)) || o.genero === 'n' || /\b(ni[nñ]os?|ni[nñ]as?|kids?)\b/i.test(o.nombre)) continue;
      if (marcas && !marcas.test(`${o.marca} ${o.nombre}`)) continue;
      const desc = o.precioLista > o.precioActual ? 1 - o.precioActual / o.precioLista : 0;
      const b = historial[o.id] ? bajaHabitual(historial[o.id].obs, hoy) : null;
      if (!a.todas && desc < config.descuentoMinimo && !(b && b.baja >= 0.15)) continue;
      candidatas.push({ tienda, o, desc, baja: b?.baja ?? null, desde: b?.desde ?? null, puntaje: b ? Math.max(b.baja, desc * 0.5) : desc * 0.5 });
      n++;
    }
    console.error(`${tienda}: ${ofertas.length} con mi talle, ${n} con descuento`);
  }
  candidatas.sort((x, y) => y.puntaje - x.puntaje);

  const token = a.ebay ? await tokenEbay() : null;
  // Modo "todas": primero se compara contra eBay (1 consulta por código) y se ordena por cuánto se ahorra de verdad.
  if (a.todas && token) {
    const vistos = new Map();
    let consultas = 0;
    for (const c of candidatas) {
      const q = consultaPara(c.o, c.tienda);
      if (!q) continue;
      if (!vistos.has(q.clave)) {
        if (consultas >= Number(a['max-ebay'])) continue;
        consultas++;
        vistos.set(q.clave, await medianaEbay(token, c.o, c.tienda));
      }
      c.ref = vistos.get(q.clave);
      c.ahorro = c.ref ? (c.ref.usd * Number(a.dolar)) / c.o.precioActual - 1 : null;
    }
    console.error(`eBay: ${consultas} consultas, ${candidatas.filter((c) => c.ref).length} con referencia`);
    candidatas.sort((x, y) => (y.ahorro ?? -9) - (x.ahorro ?? -9));
  }
  const salida = [];
  for (const c of candidatas) {
    if (salida.length >= Number(a.top)) break;
    let talles = c.o.talles;
    let color = c.o.color ?? null;
    if (SFCC.includes(c.tienda)) {
      const d = await detalleSfcc(c.o);
      if (!d || d.talles.length === 0) continue; // agotado en mi talle
      // El usuario vive en Parque Chas: lo que solo se retira en una sucursal lejana no le sirve (2026-11-09).
      // Sirve si llega a domicilio o si hay una sucursal con mi talle a <= 7 km (por talle: stock de cada sucursal).
      const retiro = [];
      for (const s of d.skus) {
        for (const suc of await sucursalesCerca(config.fuentes[c.tienda], s.sku)) retiro.push({ ...suc, talle: s.id });
        await dormir(200);
      }
      retiro.sort((x, y) => x.km - y.km);
      if (d.soloRetiro && retiro.length === 0 && !a['incluir-retiro']) { omitidasPorRetiro++; continue; }
      c.envio = [d.soloRetiro ? null : 'Envío a domicilio', retiro.length ? `Retiro: ${retiro[0].nombre} (${retiro[0].km.toFixed(1)} km, talle ${retiro[0].talle})${retiro.length > 1 ? ` +${retiro.length - 1}` : ''}` : null].filter(Boolean).join(' · ');
      talles = d.talles; color = d.color;
      await dormir(250);
    } else {
      talles = (talles ?? []).filter((x) => esMiTalle(x.t));
    }
    const ref = c.ref !== undefined ? c.ref : token ? await medianaEbay(token, { ...c.o, codigo: c.o.codigo }, c.tienda) : null;
    salida.push({ ...c, talles, color, ref });
  }
  const k = (n) => `$${Math.round(n / 1000)}k`;
  console.log(`${candidatas.length} ofertas en mi talle; se muestran ${salida.length}${omitidasPorRetiro ? ` (se descartaron ${omitidasPorRetiro} por ser solo retiro en sucursal)` : ''}\n`);
  console.log('| # | Producto | Tienda | Ahora | Lista | Desc. | Baja real | Mis talles | Color | Cómo conseguirla | eBay publicado |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  salida.forEach((s, i) => {
    const t = s.talles.map((x) => x.t + (Number.isFinite(x.u) && x.u <= 2 ? ` (${x.u} u.)` : '')).join(', ');
    const e = s.ref ? `US$${Math.round(s.ref.usd)} ≈ ${k(s.ref.usd * Number(a.dolar))} (${Math.round(((s.ref.usd * Number(a.dolar)) / s.o.precioActual - 1) * 100)}%, ${s.ref.n} publ.)` : '';
    console.log(`| ${i + 1} | [${s.o.nombre.replace(/\|/g, '/').slice(0, 52)}](${s.o.url}) | ${s.tienda} | ${k(s.o.precioActual)} | ${k(s.o.precioLista)} | -${Math.round(s.desc * 100)}% | ${s.baja ? `-${Math.round(s.baja * 100)}% (${s.desde.slice(5)})` : ''} | ${t} | ${s.color ?? ''} | ${s.envio ?? 'sin verificar'} | ${e} |`);
  });
}
