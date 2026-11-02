import { parseArgs } from 'node:util';
import { config } from './config.mjs';
import { correrFuente } from './correr.mjs';
import { hoyArgentina } from './nucleo/fechas.mjs';
import { crearCliente } from './nucleo/http.mjs';
import { cargar as cargarHistorial } from './nucleo/historial.mjs';
import { crearReferencias, obtenerDolar } from './nucleo/internacional.mjs';
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

let referencias = null;
if (!args['sin-internacional']) {
  const dolar = await obtenerDolar(crearCliente());
  if (dolar) console.log(`Dólar blue medio: $${dolar.toFixed(2)}`);
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
const { resultados, mensajesUsados } = await correrFuentes({
  nombres: Object.keys(fuentes),
  fuentes,
  fecha,
  dryRun,
  directorioDatos: args.datos,
  crearCliente: () => null,
  corrida: correrFuente, // sin avisos de falla: no se lee ningún sitio
  maxMensajesPorFuente: 15, // forzado: que no quede nada afuera por el tope de 8 por tienda
  extra: { referencias, reiniciarAlertasAntesDe: '9999-12-31' }, // ignora todas las marcas de "ya avisado"
});

for (const r of resultados) {
  if (!r.ok) { console.error(`${r.nombre}: ${r.error.message}`); continue; }
  const x = r.resultado;
  const int = x.internacional;
  console.log(`${r.nombre}: ${x.ofertas} ofertas · ${x.gangas} gangas · buenas ${x.reventa.buenas} · avisadas ${x.avisadas} en ${x.mensajes} mensajes`
    + (int ? ` · EE. UU.: ${int.conPrecio} debajo, ${int.caras} más caras (fuera), ${int.sinPrecio} sin precio, ${int.pendientes} sin consultar` : ''));
}
if (referencias) console.log(`Perfumania: ${referencias.pedidos} pedidos${referencias.bloqueo ? ' (bloqueó)' : ''}`);
console.log(`Mensajes: ${mensajesUsados}`);
