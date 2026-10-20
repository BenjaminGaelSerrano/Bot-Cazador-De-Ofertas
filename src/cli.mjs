import { parseArgs } from 'node:util';
import { config } from './config.mjs';
import { leerCatalogo } from './fuentes/juleriaque.mjs';
import { hoyArgentina } from './nucleo/fechas.mjs';
import { cargar, guardar, registrar } from './nucleo/historial.mjs';
import { ErrorFuente, crearCliente } from './nucleo/http.mjs';

const FUENTES = { juleriaque: leerCatalogo };

const { values: args } = parseArgs({
  options: {
    fuente: { type: 'string', default: 'juleriaque' },
    'dry-run': { type: 'boolean', default: false },
    datos: { type: 'string', default: 'datos' },
    pausa: { type: 'string' },
  },
});

// Para correr en local: las credenciales se leen de .env si existe (en Actions vienen de los secrets).
try { process.loadEnvFile('.env'); } catch { /* sin .env */ }

const leer = FUENTES[args.fuente];
if (!leer) {
  console.error(`Fuente desconocida: ${args.fuente}. Disponibles: ${Object.keys(FUENTES).join(', ')}`);
  process.exit(2);
}

const dryRun = args['dry-run'];
const fecha = hoyArgentina();
const inicio = Date.now();
const cliente = crearCliente({ pausaMs: args.pausa ? Number(args.pausa) : config.pausaMs });
const rutaHistorial = `${args.datos}/${args.fuente}/historial.json`;

console.log(`Fuente: ${args.fuente} · ${fecha}${dryRun ? ' · DRY-RUN (no se escribe ni se envía nada)' : ''}`);

try {
  const { ofertas, informe } = await leer(cliente, { log: (t) => console.log(t) });

  // En dry-run se registra sobre el historial en memoria para ver qué cambiaría, sin guardar.
  const historial = await cargar(rutaHistorial);
  const cambios = { nuevo: 0, cambio: 0, igual: 0 };
  for (const oferta of ofertas) cambios[registrar(historial, oferta, fecha)]++;
  if (!dryRun) await guardar(rutaHistorial, historial);

  const conDescuento = ofertas.filter((o) => o.stock > 0 && o.precioActual <= o.precioLista * (1 - config.descuentoMinimo));
  const minutos = ((Date.now() - inicio) / 60_000).toFixed(1);

  console.log(`\nProductos leídos: ${informe.productosLeidos} · SKU válidos: ${ofertas.length} · pedidos: ${informe.pedidos} · ${minutos} min`);
  console.log(`Historial: ${cambios.nuevo} nuevos, ${cambios.cambio} con cambio de precio, ${cambios.igual} sin cambios${dryRun ? ' (no guardado)' : ' (guardado)'}`);
  console.log(`Sin stock: ${ofertas.filter((o) => o.stock === 0).length} · con descuento declarado ≥ ${config.descuentoMinimo * 100} % y stock: ${conDescuento.length}`);
  if (informe.catalogoTotal !== null) console.log(`Cobertura: ${informe.productosLeidos} de ${informe.catalogoTotal} productos del sitio${informe.sinCubrir ? ` (${informe.sinCubrir} fuera de las categorías configuradas)` : ''}`);
  if (informe.sinCubrir > informe.catalogoTotal * config.fuentes.juleriaque.toleranciaCobertura) console.warn('AVISO: hay productos en el sitio que no están en las categorías configuradas; revisar si aparecieron categorías nuevas.');
  if (informe.truncados.length) console.warn('AVISO categorías truncadas:', JSON.stringify(informe.truncados));
  if (informe.incompletos.length) console.warn('AVISO cobertura incompleta:', JSON.stringify(informe.incompletos));

  for (const o of conDescuento.sort((a, b) => a.precioActual / a.precioLista - b.precioActual / b.precioLista).slice(0, 5)) {
    const pct = Math.round((1 - o.precioActual / o.precioLista) * 100);
    console.log(`  -${pct}% ${o.marca} · ${o.nombre} · $${o.precioActual} (lista $${o.precioLista}) ${o.url}`);
  }
} catch (error) {
  if (error instanceof ErrorFuente) console.error(`Falla de la fuente (${error.tipo}${error.status ? ` ${error.status}` : ''}): ${error.message}`);
  else console.error(error);
  process.exitCode = 1;
}
