import { parseArgs } from 'node:util';
import { config } from './config.mjs';
import { correrConAvisoDeFalla } from './correr.mjs';
import { leerCatalogo } from './fuentes/juleriaque.mjs';
import { hoyArgentina } from './nucleo/fechas.mjs';
import { ErrorFuente, crearCliente } from './nucleo/http.mjs';

const FUENTES = {
  juleriaque: { leer: leerCatalogo, titulo: 'Ofertas Juleriaque' },
};

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

const fuente = FUENTES[args.fuente];
if (!fuente) {
  console.error(`Fuente desconocida: ${args.fuente}. Disponibles: ${Object.keys(FUENTES).join(', ')}`);
  process.exit(2);
}

const dryRun = args['dry-run'];
const fecha = hoyArgentina();
const inicio = Date.now();
console.log(`Fuente: ${args.fuente} · ${fecha}${dryRun ? ' · DRY-RUN (no se escribe ni se envía nada)' : ''}`);

try {
  const r = await correrConAvisoDeFalla({
    nombre: args.fuente,
    titulo: fuente.titulo,
    leer: fuente.leer,
    cliente: crearCliente({ pausaMs: args.pausa ? Number(args.pausa) : config.pausaMs }),
    fecha,
    dryRun,
    directorioDatos: args.datos,
  });
  const { informe } = r;
  const minutos = ((Date.now() - inicio) / 60_000).toFixed(1);

  console.log(`\nProductos leídos: ${informe.productosLeidos} · SKU válidos: ${r.ofertas} · pedidos: ${informe.pedidos} · ${minutos} min`);
  console.log(`Historial: ${r.cambios.nuevo} nuevos, ${r.cambios.cambio} con cambio de precio, ${r.cambios.igual} sin cambios${dryRun ? ' (no guardado)' : ' (guardado)'}`);
  console.log(`Gangas hoy: ${r.gangas} · por avisar: ${r.pendientes} · mensajes: ${r.mensajes} · ofertas avisadas: ${r.avisadas}`);
  if (informe.catalogoTotal !== null) console.log(`Cobertura: ${informe.productosLeidos} de ${informe.catalogoTotal} productos del sitio`);
  if (informe.sinCubrir > informe.catalogoTotal * config.fuentes.juleriaque.toleranciaCobertura) console.warn('AVISO: hay productos en el sitio que no están en las categorías configuradas; revisar si aparecieron categorías nuevas.');
  if (informe.truncados.length) console.warn('AVISO categorías truncadas:', JSON.stringify(informe.truncados));
  if (informe.incompletos.length) console.warn('AVISO cobertura incompleta:', JSON.stringify(informe.incompletos));
} catch (error) {
  if (error instanceof ErrorFuente) console.error(`Falla de la fuente (${error.tipo}${error.status ? ` ${error.status}` : ''}): ${error.message}`);
  else console.error(error);
  process.exitCode = 1;
}
