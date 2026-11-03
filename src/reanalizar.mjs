import { parseArgs } from 'node:util';
import { config } from './config.mjs';
import { correrFuente } from './correr.mjs';
import { cupoDeCorrida, enviadosHoy, sumarEnviados } from './nucleo/envios.mjs';
import { nombreCanal } from './notificar/canal.mjs';
import { telegramActivo } from './notificar/telegram.mjs';
import { hoyArgentina } from './nucleo/fechas.mjs';
import { crearCliente } from './nucleo/http.mjs';
import { cargar as cargarHistorial } from './nucleo/historial.mjs';
import { crearEbay } from './nucleo/ebay.mjs';
import { crearReferencias, obtenerDolar } from './nucleo/internacional.mjs';
import { crearUpcitemdb } from './nucleo/upcitemdb.mjs';
import { correrFuentes } from './principal.mjs';

// Reanálisis forzado de TODAS las ofertas de la última lectura (spec 006): rearma cada oferta con lo que el bot guardó
// hoy en el historial (sin pedirles nada a las tiendas), la evalúa con las reglas actuales (ganga, reventa y referencia
// internacional) y avisa todo lo que vale la pena, ignorando las marcas de "ya avisado".
//
//   node src/reanalizar.mjs --datos <carpeta con la rama datos> [--fecha AAAA-MM-DD] [--dry-run] [--sin-internacional]
//                           [--max-pedidos N] [--pausa ms]
//
// Escribe alertas.json en esa carpeta con lo que se mandó (para no repetirlo); el resto del estado no cambia.

const TITULOS = {
  juleriaque: 'Juleriaque', grid: 'Grid', rouge: 'Rouge', parfumerie: 'Parfumerie', moov: 'Moov', newera: 'New Era',
};

const { values: args } = parseArgs({
  options: {
    datos: { type: 'string', default: 'datos' },
    fecha: { type: 'string', default: hoyArgentina() },
    'dry-run': { type: 'boolean', default: false },
    'sin-internacional': { type: 'boolean', default: false },
    'max-pedidos': { type: 'string' },
    pausa: { type: 'string' },
  },
});
try { process.loadEnvFile('.env'); } catch { /* sin .env */ }

const { fecha } = args;
const dryRun = args['dry-run'];

/** La oferta tal como la había leído el adaptador, a partir de lo guardado en el historial ese día. */
function ofertaDesdeHistorial(id, p) {
  const [, precioActual, precioLista] = p.obs.at(-1);
  const cantidad = p.stk?.at(-1)?.[1] ?? 0;
  return {
    id, ean: p.ean, marca: p.marca, nombre: p.nombre, ml: p.ml, categoria: p.cat, url: p.url,
    precioActual, precioLista, moneda: 'ARS', stock: p.stock ? Math.max(1, cantidad) : 0,
    ...(p.km ? { modelo: p.km, genero: p.gen ?? null } : {}),
    ...(p.attrs ? { attrs: 1 } : {}),
  };
}

const fuentes = {};
for (const nombre of Object.keys(TITULOS)) {
  fuentes[nombre] = {
    titulo: `Reanálisis ${TITULOS[nombre]}`,
    leer: async () => {
      const historial = await cargarHistorial(`${args.datos}/${nombre}/historial.json`);
      const ofertas = Object.entries(historial.productos)
        .filter(([, p]) => p.visto === fecha) // lo que se leyó ese día (el último precio guardado es el vigente)
        .map(([id, p]) => ofertaDesdeHistorial(id, p));
      return { ofertas, informe: { pedidos: 0, productosLeidos: ofertas.length, catalogoTotal: null, truncados: [], incompletos: [] } };
    },
  };
}

// Precio de mercado: el mismo orden que el bot (eBay si hay credenciales; si no, UPCitemdb; si no, tiendas + Perfumania).
const dolar = await obtenerDolar(crearCliente());
if (dolar) console.log(`Dólar blue medio: ${dolar.toFixed(2)}`);
let mercado = null;
if (config.ebay.activo && process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET) {
  mercado = crearEbay({ clientId: process.env.EBAY_CLIENT_ID, clientSecret: process.env.EBAY_CLIENT_SECRET, dolar, hoy: fecha, rutaCache: `${args.datos}/referencias/ebay.json` });
} else if (config.upcitemdb.activo) {
  const cfgU = { ...config.upcitemdb, ...(args['max-pedidos'] ? { maxConsultasPorCorrida: Number(args['max-pedidos']) } : {}) };
  mercado = crearUpcitemdb({ dolar, hoy: fecha, rutaCache: `${args.datos}/referencias/upcitemdb.json`, cfg: cfgU });
}
if (mercado) console.log(`Precio de mercado: ${mercado.nombre}`);
let referencias = null;
if (!mercado && !args['sin-internacional']) {
  const cfg = {
    ...config.internacional,
    perfumania: {
      ...config.internacional.perfumania,
      ...(args['max-pedidos'] ? { maxPedidosPorCorrida: Number(args['max-pedidos']) } : {}),
      ...(args.pausa ? { pausaMs: Number(args.pausa) } : {}),
    },
  };
  const servicio = crearReferencias({
    cliente: crearCliente({ pausaMs: cfg.perfumania.pausaMs, esperasReintento: [] }),
    dolar, hoy: fecha, rutaCache: `${args.datos}/referencias/perfumania.json`, cfg,
  });
  // El caché se guarda después de cada consulta: si el proceso se corta, lo consultado no se pierde.
  referencias = { ...servicio, buscar: async (o) => { const r = await servicio.buscar(o); await servicio.guardar(); return r; } };
  Object.defineProperty(referencias, 'pedidos', { get: () => servicio.pedidos });
  Object.defineProperty(referencias, 'bloqueo', { get: () => servicio.bloqueo });
}

console.log(`Reanálisis del ${fecha}${dryRun ? ' · DRY-RUN (no se manda nada)' : ''}${referencias ? '' : ' · sin referencia internacional'}`);
// Tope diario de WhatsApp (CallMeBot deja de entregar en silencio pasado un límite que no publica).
const rutaEnvios = `${args.datos}/envios.json`;
const yaEnviadosHoy = await enviadosHoy(rutaEnvios, fecha);
// El tope diario es por CallMeBot; Telegram no tiene ese límite oculto.
const maxMensajesTotal = telegramActivo()
  ? config.maxMensajesTotalPorCorrida
  : cupoDeCorrida(config.maxMensajesTotalPorCorrida, config.maxMensajesPorDia, yaEnviadosHoy);
console.log(`Avisos por ${nombreCanal()}: ${yaEnviadosHoy} enviados hoy, ${maxMensajesTotal} disponibles para esta corrida.`);
const { resultados, mensajesUsados } = await correrFuentes({
  maxMensajesTotal,
  nombres: Object.keys(fuentes),
  fuentes,
  fecha,
  dryRun,
  directorioDatos: args.datos,
  crearCliente: () => null,
  corrida: correrFuente, // sin avisos de falla: no se lee ningún sitio
  maxMensajesPorFuente: 15, // forzado: que no quede nada afuera por el tope de 8 por tienda
  // Ignora las marcas de "ya avisado" sin borrarlas: así alertas.json queda con las de antes más las de este envío.
  extra: { referencias, ebay: mercado, ignorarAvisadas: true }, // ignora todas las marcas de "ya avisado"
});

if (!dryRun && mensajesUsados > 0) await sumarEnviados(rutaEnvios, fecha, mensajesUsados);

for (const r of resultados) {
  if (!r.ok) { console.error(`${r.nombre}: ${r.error.message}`); continue; }
  const x = r.resultado;
  const int = x.internacional;
  console.log(`${r.nombre}: ${x.ofertas} ofertas · ${x.gangas} gangas · buenas ${x.reventa.buenas} · avisadas ${x.avisadas} en ${x.mensajes} mensajes`
    + (x.ebay ? ` · mercado EE. UU.: ${x.ebay.conPrecio} con precio, ${x.ebay.sinPrecio} sin, ${x.ebay.pendientes} sin consultar` : '')
    + (int ? ` · EE. UU.: ${int.conPrecio} debajo, ${int.caras} más caras (fuera), ${int.sinPrecio} sin precio, ${int.pendientes} sin consultar` : ''));
}
if (mercado) {
  await mercado.guardar(); // también en simulación: así el envío real no repite las consultas
  console.log(`${mercado.nombre}: ${mercado.consultas} consultas${mercado.corte ? ` (${mercado.corte.message})` : ''}`);
}
if (referencias) console.log(`Perfumania: ${referencias.pedidos} pedidos${referencias.bloqueo ? ' (bloqueó)' : ''}`);
console.log(`Mensajes: ${mensajesUsados}`);
