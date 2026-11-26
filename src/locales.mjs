// Locales propios (spec 009): lee cada tienda, guarda su historial y avisa por Telegram lo que cumple el criterio.
//   node src/locales.mjs --datos datos [--dry-run] [--fuente lamartina,tommy]
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { config } from './config.mjs';
import { crearLector } from './fuentes/vtex.mjs';
import { leerTiendanube, tallesTiendanube } from './fuentes/tiendanube.mjs';
import { leerMagentoHtml, tallesMagento } from './fuentes/magento-html.mjs';
import { leerKevingston, leerPrestashop, leerRotten, tallesKevingston } from './fuentes/propias.mjs';
import { leerWoo, tallesWoo } from './fuentes/woo.mjs';
import { composicionDe } from './nucleo/calidad.mjs';
import { hoyArgentina } from './nucleo/fechas.mjs';
import { cargar as cargarHistorial, guardar as guardarHistorial, registrar } from './nucleo/historial.mjs';
import { crearCliente } from './nucleo/http.mjs';
import { descuentoPorTransferencia, elegirParaAvisar, evaluarLocal, mensajesLocales, pisoDeTienda, promosDeWeb } from './nucleo/locales.mjs';
import { enviar, limitarWhatsapp } from './notificar/canal.mjs';
import { telegramActivo } from './notificar/telegram.mjs';

/** Producto de Shopify -> oferta con talles disponibles. La variante más barata con stock marca el precio. */
export function deShopify(p, base) {
  const posTalle = (p.options ?? []).findIndex((o) => /talle|talla|size/i.test(o.name));
  const disponibles = (p.variants ?? []).filter((v) => v.available === true && Number(v.price) > 0);
  if (disponibles.length === 0) return null;
  const elegida = disponibles.reduce((a, b) => (Number(b.price) < Number(a.price) ? b : a));
  const lista = Number(elegida.compare_at_price) > Number(elegida.price) ? Number(elegida.compare_at_price) : Number(elegida.price);
  const talles = posTalle < 0 ? ['único'] : disponibles.map((v) => v[`option${posTalle + 1}`] ?? String(v.title).split(' / ')[posTalle]);
  const etiquetas = Array.isArray(p.tags) ? p.tags : String(p.tags ?? '').split(',');
  return {
    id: String(p.id),
    nombre: p.title,
    marca: p.vendor,
    ean: null,
    ml: null,
    categoria: p.product_type || null,
    // Género: del tipo de producto y de las etiquetas que lo declaran (Decathlon: "GENDER_VALUE: Mujer").
    categorias: [p.product_type, ...etiquetas.filter((t) => /gender|genero|mujer|women|hombre|kids|ni[nñ]/i.test(t))].filter(Boolean),
    composicion: composicionDe(p.body_html),
    precioActual: Number(elegida.price),
    precioLista: lista,
    stock: disponibles.length,
    talles: [...new Set(talles.filter(Boolean))],
    url: `${base}/products/${p.handle}`,
  };
}

async function leerShopify(cliente, { base, maxPaginas = 40 }) {
  const ofertas = new Map();
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const { datos } = await cliente.obtenerJson(`${base}/products.json?limit=250&page=${pagina}`);
    for (const p of datos.products ?? []) {
      const o = deShopify(p, base);
      if (o) ofertas.set(o.id, o);
    }
    if ((datos.products ?? []).length < 250) break;
  }
  return [...ofertas.values()];
}

async function leerVtex(cliente, tienda) {
  const lector = crearLector({ base: tienda.base, maxPorPedido: 50, maxOffset: 2500, agrupar: 'producto', categoriasExcluidas: [], categorias: [{ name: 'Todo', ruta: null }] });
  // Las categorías del producto dicen el género; el lector común no las deja pasar, así que se anotan acá.
  const categoriasDe = new Map();
  const composicionPorId = new Map();
  const espia = {
    obtenerJson: async (url) => {
      const r = await cliente.obtenerJson(url);
      for (const p of Array.isArray(r.datos) ? r.datos : []) {
        categoriasDe.set(String(p.productId), p.categories ?? []);
        composicionPorId.set(String(p.productId), composicionDe(JSON.stringify({ ...p, items: undefined })));
      }
      return r;
    },
  };
  const { ofertas } = await lector.leerCatalogo(espia);
  return ofertas.map((o) => ({
    ...o,
    categorias: categoriasDe.get(String(o.productoId)) ?? [],
    composicion: composicionPorId.get(String(o.productoId)) ?? null,
    talles: (o.talles ?? []).map((t) => t.t),
  }));
}

const LECTORES = { shopify: leerShopify, tiendanube: leerTiendanube, woo: leerWoo, vtex: leerVtex, magento: leerMagentoHtml, kevingston: leerKevingston, prestashop: leerPrestashop, rotten: leerRotten };

/** Talles con stock cuando la lista no los dice; null si ya venían en la lista. */
function talleEnFicha(cliente, oferta, tienda) {
  if (tienda.tipo === 'woo') return tallesWoo(cliente, oferta, tienda);
  if (tienda.tipo === 'kevingston') return tallesKevingston(cliente, oferta, tienda);
  if (tienda.tipo === 'magento') return tallesMagento(cliente, oferta);
  if (oferta.faltanTalles) return tallesTiendanube(cliente, oferta);
  return null;
}

const leerJson = async (ruta, vacio) => {
  try { return JSON.parse(await readFile(ruta, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return vacio; throw error; }
};

const escribirJson = async (ruta, datos) => {
  await mkdir(dirname(ruta), { recursive: true });
  await writeFile(`${ruta}.tmp`, JSON.stringify(datos));
  await rename(`${ruta}.tmp`, ruta);
};

export async function correrLocales({
  datos = 'datos', dryRun = false, nombres, cfg = config.locales, fecha = hoyArgentina(),
  leer = (cliente, t) => (LECTORES[t.tipo] ?? leerVtex)(cliente, { ...t, marca: t.nombre }),
  tallesDe = (cliente, oferta, t) => talleEnFicha(cliente, oferta, t),
  crear = () => crearCliente({ pausaMs: config.pausaMs }), enviarFn = enviar, log = console.log,
  portada = async (cliente, t) => (t.base ? (await cliente.obtenerTexto(`${t.base}/`)).datos : ''),
} = {}) {
  const rutaAvisadas = `${datos}/locales/avisadas.json`;
  const avisadas = await leerJson(rutaAvisadas, {});
  const elegidas = [];
  const fallaron = [];
  const promos = {};
  for (const nombre of nombres ?? Object.keys(cfg.tiendas)) {
    const tienda = cfg.tiendas[nombre];
    try {
      let ofertas = await leer(crear(), tienda);
      // Promos de la portada. Si falla, la tienda se lee igual.
      try { promos[tienda.nombre] = promosDeWeb(await portada(crear(), tienda)); } catch (error) { log(`${nombre}: sin promos de portada (${error.message})`); }
      const transferencia = descuentoPorTransferencia(promos[tienda.nombre] ?? []);
      if (transferencia) ofertas = ofertas.map((o) => (o.precioConPago ? o : { ...o, precioConPago: Math.round(o.precioActual * (1 - transferencia)) }));
      const ruta = `${datos}/locales/${nombre}.json`;
      const historial = await cargarHistorial(ruta);
      const piso = pisoDeTienda(ofertas, cfg.percentilTienda);
      const candidatas = [];
      for (const oferta of ofertas) {
        if (!(oferta.precioActual > 0)) continue;
        const evaluacion = evaluarLocal(oferta, { registro: historial.productos[oferta.id], fecha, piso, cfg });
        if (evaluacion) candidatas.push({ tienda: tienda.nombre, oferta, evaluacion });
        registrar(historial, oferta, fecha);
      }
      // Las tiendas cuya lista no dice qué talle queda (WooCommerce) se miran recién acá, solo lo que se iba a avisar.
      const nuevas = [];
      for (const c of elegirParaAvisar(candidatas, avisadas, cfg.maximoPorTienda, { repetir: cfg.repetirVigentes })) {
        if (nuevas.length >= cfg.maximoPorTienda) break;
        let conStock;
        try { conStock = await tallesDe(crear(), c.oferta, tienda); } catch (error) { log(`${nombre}: sin talles de ${c.oferta.url} (${error.message})`); continue; }
        if (conStock === null) { nuevas.push(c); continue; }
        const evaluacion = evaluarLocal({ ...c.oferta, talles: conStock }, { registro: historial.productos[c.oferta.id], fecha, piso, cfg });
        if (evaluacion) nuevas.push({ ...c, evaluacion });
      }
      elegidas.push(...nuevas);
      if (!dryRun) await guardarHistorial(ruta, historial);
      log(`${nombre}: ${ofertas.length} productos · piso de descuento ${Math.round(Math.max(cfg.descuentoMinimo, piso) * 100)}% · cumplen ${candidatas.length} · a avisar ${nuevas.length} (${nuevas.filter((e) => e.nueva).length} nuevas)`);
    } catch (error) {
      fallaron.push(nombre);
      log(`${nombre}: no se pudo leer (${error.message})`);
    }
  }
  const mensajes = mensajesLocales(elegidas, 8, promos);
  for (const [i, mensaje] of mensajes.entries()) {
    await enviarFn(mensaje, { dryRun });
    // Se marca como avisado recién cuando el mensaje salió.
    for (const e of elegidas.slice(i * 8, (i + 1) * 8)) avisadas[e.oferta.url] = e.oferta.precioActual;
    if (!dryRun) await escribirJson(rutaAvisadas, avisadas);
  }
  return { elegidas, mensajes, fallaron };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: args } = parseArgs({ options: { datos: { type: 'string', default: 'datos' }, 'dry-run': { type: 'boolean', default: false }, fuente: { type: 'string' } } });
  try { process.loadEnvFile('.env'); } catch { /* sin .env */ }
  const dryRun = args['dry-run'];
  if (!dryRun && !telegramActivo()) {
    console.log('Locales propios: sin Telegram configurado, no se envía nada.');
  } else {
    limitarWhatsapp(0); // solo Telegram: no gasta el cupo diario de WhatsApp
    const { elegidas, mensajes } = await correrLocales({ datos: args.datos, dryRun, nombres: args.fuente?.split(',') });
    console.log(`Locales propios: ${elegidas.length} ofertas en ${mensajes.length} mensajes.`);
  }
}
