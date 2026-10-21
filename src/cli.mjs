import { parseArgs } from 'node:util';
import { config } from './config.mjs';
import { leerCatalogo as leerGrid } from './fuentes/grid.mjs';
import { leerCatalogo as leerJuleriaque } from './fuentes/juleriaque.mjs';
import { leerCatalogo as leerNewEra } from './fuentes/newera.mjs';
import { leerCatalogo as leerRouge } from './fuentes/rouge.mjs';
import { hoyArgentina } from './nucleo/fechas.mjs';
import { ErrorFuente, crearCliente } from './nucleo/http.mjs';
import { correrFuentes } from './principal.mjs';

const FUENTES = {
  juleriaque: { leer: leerJuleriaque, titulo: 'Ofertas Juleriaque' },
  grid: { leer: leerGrid, titulo: 'Ofertas Grid' },
  rouge: { leer: leerRouge, titulo: 'Ofertas Rouge' },
  newera: { leer: leerNewEra, titulo: 'Ofertas New Era' },
};

const { values: args } = parseArgs({
  options: {
    fuente: { type: 'string', default: 'todas' }, // un nombre, varios separados por coma, o "todas"
    'dry-run': { type: 'boolean', default: false },
    datos: { type: 'string', default: 'datos' },
    pausa: { type: 'string' },
  },
});

// Para correr en local: las credenciales se leen de .env si existe (en Actions vienen de los secrets).
try { process.loadEnvFile('.env'); } catch { /* sin .env */ }

const nombres = args.fuente === 'todas' ? Object.keys(FUENTES) : args.fuente.split(',').map((s) => s.trim()).filter(Boolean);
const desconocidas = nombres.filter((n) => !FUENTES[n]);
if (nombres.length === 0 || desconocidas.length > 0) {
  console.error(`Fuente desconocida: ${desconocidas.join(', ') || '(vacía)'}. Disponibles: ${Object.keys(FUENTES).join(', ')}, todas`);
  process.exit(2);
}

const dryRun = args['dry-run'];
const fecha = hoyArgentina();
const inicio = Date.now();
const minutosDesde = (t) => ((Date.now() - t) / 60_000).toFixed(1);
console.log(`Fuentes: ${nombres.join(', ')} · ${fecha}${dryRun ? ' · DRY-RUN (no se escribe ni se envía nada)' : ''}`);

// El tiempo de cada fuente se mide acá, envolviendo la lectura.
const tiempos = {};
const fuentes = Object.fromEntries(Object.entries(FUENTES).map(([nombre, f]) => [nombre, {
  ...f,
  leer: async (...a) => {
    const t = Date.now();
    try { return await f.leer(...a); } finally { tiempos[nombre] = minutosDesde(t); }
  },
}]));

const { resultados, fallaron, mensajesUsados } = await correrFuentes({
  nombres,
  fuentes,
  fecha,
  dryRun,
  directorioDatos: args.datos,
  crearCliente: () => crearCliente({ pausaMs: args.pausa ? Number(args.pausa) : config.pausaMs }),
});

for (const r of resultados) {
  console.log(`\n=== ${r.nombre} (${tiempos[r.nombre] ?? '?'} min de lectura)`);
  if (!r.ok) {
    const e = r.error;
    if (e instanceof ErrorFuente) console.error(`Falla de la fuente (${e.tipo}${e.status ? ` ${e.status}` : ''}): ${e.message}`);
    else console.error(e);
    continue;
  }
  const { informe, cambios } = r.resultado;
  console.log(`Productos leídos: ${informe.productosLeidos} · ofertas válidas: ${r.resultado.ofertas} · pedidos: ${informe.pedidos}`);
  console.log(`Historial: ${cambios.nuevo} nuevos, ${cambios.cambio} con cambio de precio, ${cambios.igual} sin cambios${dryRun ? ' (no guardado)' : ' (guardado)'}`);
  console.log(`Gangas hoy: ${r.resultado.gangas} · por avisar: ${r.resultado.pendientes} · mensajes: ${r.resultado.mensajes} · ofertas avisadas: ${r.resultado.avisadas}`);
  if (informe.catalogoTotal !== null) console.log(`Cobertura: ${informe.productosLeidos} de ${informe.catalogoTotal} productos del sitio`);
  const tolerancia = config.fuentes[r.nombre]?.toleranciaCobertura ?? 0.01;
  if (informe.sinCubrir > informe.catalogoTotal * tolerancia) console.warn('AVISO: hay productos en el sitio fuera de las categorías configuradas; revisar si aparecieron categorías nuevas.');
  if (informe.truncados.length) console.warn('AVISO categorías truncadas:', JSON.stringify(informe.truncados));
  if (informe.incompletos.length) console.warn('AVISO cobertura incompleta:', JSON.stringify(informe.incompletos));
}

console.log(`\nTotal: ${minutosDesde(inicio)} min · mensajes: ${mensajesUsados}/${config.maxMensajesTotalPorCorrida} · fallas: ${fallaron.length ? fallaron.join(', ') : 'ninguna'}`);
if (fallaron.length) process.exitCode = 1;
