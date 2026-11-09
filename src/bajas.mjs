// Mayores bajas REALES de precio, sin compararlas con eBay (pedido del usuario, 2026-11-09: "te faltan buenas ofertas").
// La referencia es el precio en el que el producto estuvo la mayor parte de los últimos 30 días (mediana ponderada por
// días), no el precio de lista que declara la tienda (puede estar inflado). Sirve para lo que no tiene comparación en
// eBay (sin código, licencias, marcas locales). Uso: node src/bajas.mjs --datos datos [--min 0.15] [--dias 14] [--top 40]
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { config } from './config.mjs';
import { tallesDePagina, colorDePagina } from './fuentes/sfcc.mjs';
import { tallesDe } from './fuentes/vtex.mjs';
import { diasEntre, hoyArgentina } from './nucleo/fechas.mjs';
import { esSoloPerfume } from './nucleo/internacional.mjs';
import { esDeMujer } from './nucleo/prioridad.mjs';
import { evaluarTalles } from './nucleo/talles.mjs';

const TIENDAS = ['juleriaque', 'rouge', 'pigmento', 'beauty24', 'grid', 'dash', 'sporting', 'moov', 'dexter', 'stockcenter', 'newera'];
const PERFUMERIAS = new Set(config.soloPerfumes);
const VTEX_CON_TALLES = new Set(['grid', 'dash', 'sporting']);
const SFCC = new Set(['moov', 'dexter', 'stockcenter']);

/** Tramos de precio constante: `[{ desde, precio }]` (las filas del historial que solo cambian el precio de lista se funden). */
export function tramos(obs) {
  const t = [];
  for (const [fecha, precio] of obs) if (!t.length || t.at(-1).precio !== precio) t.push({ desde: fecha, precio });
  return t;
}

const medianaPonderada = (pares) => {
  const total = pares.reduce((s, [, w]) => s + w, 0);
  let acum = 0;
  for (const [v, w] of [...pares].sort((a, b) => a[0] - b[0])) { acum += w; if (acum >= total / 2) return v; }
  return null;
};

/**
 * Baja real del precio actual contra el precio habitual de los últimos `ventana` días antes del cambio.
 * Devuelve `{ habitual, baja, desde, diasPrevios }` o null si no hay al menos `minDiasPrevios` días de historia previa
 * o si el precio no bajó.
 */
export function bajaHabitual(obs, hoy, { ventana = 30, minDiasPrevios = 4 } = {}) {
  const t = tramos(obs);
  if (t.length < 2) return null;
  const actual = t.at(-1);
  const inicio = hoy > actual.desde ? hoy : actual.desde;
  const corte = (f) => (diasEntre(f, inicio) > ventana ? new Date(Date.parse(`${inicio}T00:00:00Z`) - ventana * 86_400_000).toISOString().slice(0, 10) : f);
  const pares = [];
  for (let i = 0; i < t.length - 1; i++) {
    const dias = diasEntre(corte(t[i].desde), t[i + 1].desde);
    if (dias > 0) pares.push([t[i].precio, dias]);
  }
  const diasPrevios = pares.reduce((s, [, w]) => s + w, 0);
  if (diasPrevios < minDiasPrevios) return null;
  const habitual = medianaPonderada(pares);
  if (!(habitual > actual.precio)) return null;
  return { habitual, baja: 1 - actual.precio / habitual, desde: actual.desde, diasPrevios };
}

async function detalle(tienda, id, p) {
  const UA = { headers: { 'User-Agent': 'Mozilla/5.0' } };
  try {
    if (VTEX_CON_TALLES.has(tienda)) {
      const r = await fetch(`${config.fuentes[tienda].base}/api/catalog_system/pub/products/search?fq=productId:${id}`, UA);
      const prod = (await r.json())[0];
      if (!prod) return { agotado: true, texto: 'ya no figura en la tienda' };
      const talles = tallesDe(prod.items);
      return { talles, color: prod.Color?.[0] ?? null };
    }
    if (SFCC.has(tienda)) {
      const html = await (await fetch(p.url, UA)).text();
      return { talles: tallesDePagina(html), color: colorDePagina(html) };
    }
  } catch { /* sin detalle: se muestra igual */ }
  return null;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const { values: a } = parseArgs({ options: { datos: { type: 'string', default: 'datos' }, min: { type: 'string', default: '0.15' }, dias: { type: 'string', default: '14' }, top: { type: 'string', default: '40' }, 'sin-talles': { type: 'boolean', default: false } } });
  const hoy = hoyArgentina();
  const filas = [];
  for (const tienda of TIENDAS) {
    let historial;
    try { historial = JSON.parse(await readFile(`${a.datos}/${tienda}/historial.json`, 'utf8')).productos; } catch { continue; }
    for (const [id, p] of Object.entries(historial)) {
      if (p.visto !== hoy || !p.stock) continue;
      const oferta = { nombre: p.nombre, marca: p.marca, ml: p.ml, categoria: p.cat, genero: p.gen ?? null };
      if (PERFUMERIAS.has(tienda) && !esSoloPerfume(oferta)) continue;
      if (esDeMujer(oferta) || p.gen === 'n' || /\b(ni[nñ]os?|ni[nñ]as?|kids?)\b/i.test(p.nombre)) continue;
      const b = bajaHabitual(p.obs, hoy);
      if (!b || b.baja < Number(a.min) || diasEntre(b.desde, hoy) > Number(a.dias)) continue;
      filas.push({ tienda, id, p, ...b, precio: p.obs.at(-1)[1] });
    }
  }
  filas.sort((x, y) => y.baja - x.baja);
  const salida = [];
  for (const f of filas) {
    if (salida.length >= Number(a.top)) break;
    const d = a['sin-talles'] ? null : await detalle(f.tienda, f.id, f.p);
    if (Array.isArray(d?.talles) && d.talles.length === 0) continue; // agotada
    if (d?.agotado) continue;
    const t = d?.talles ? evaluarTalles(d.talles, f.p.gen) : null;
    salida.push({ ...f, color: d?.color ?? null, talles: t });
  }
  console.log(`${filas.length} productos con baja real >= ${Math.round(Number(a.min) * 100)} % en los últimos ${a.dias} días; se muestran ${salida.length}\n`);
  console.log('| # | Producto | Tienda | Ahora | Antes (habitual) | Baja | Desde | Historial | Color · talles |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  salida.forEach((f, i) => {
    const k = (n) => `$${Math.round(n / 1000)}k`;
    const det = [f.color, f.talles?.texto].filter(Boolean).join(' · ');
    console.log(`| ${i + 1} | [${f.p.nombre.replace(/\|/g, '/').slice(0, 55)}](${f.p.url}) | ${f.tienda} | ${k(f.precio)} | ${k(f.habitual)} | -${Math.round(f.baja * 100)}% | ${f.desde.slice(5)} | ${f.diasPrevios} d | ${f.talles?.alerta ? '⚠ ' : ''}${det} |`);
  });
}
