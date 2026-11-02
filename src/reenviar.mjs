import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { config } from './config.mjs';
import { hoyArgentina } from './nucleo/fechas.mjs';
import { crearCliente } from './nucleo/http.mjs';
import { crearReferencias, obtenerDolar } from './nucleo/internacional.mjs';
import { enviar } from './notificar/callmebot.mjs';
import { LEYENDA_INTERNACIONAL, agruparTabla, itemTabla, miles } from './notificar/tabla.mjs';

// Reenvío de lo ya avisado un día, con el filtro de la referencia internacional (spec 006). Toma `avisos.jsonl`, arma
// cada oferta con los datos del historial (marca, ml, código de barras), la compara con Perfumania y vuelve a mandar
// lo que sigue siendo ganga. No toca `alertas.json`: esas ofertas ya estaban avisadas.
// El caché de referencias sí se guarda, también con --dry-run: así el envío real no repite los pedidos a Perfumania.
//
//   node src/reenviar.mjs --datos <carpeta con la rama datos> [--fecha AAAA-MM-DD] [--dry-run] [--max-pedidos N] [--forzar]
//
// Sin --forzar, si Perfumania bloquea y quedan perfumes sin consultar, no se manda nada (el reenvío quedaría a medias).
// Con --forzar se manda igual y lo no consultado va con "*", como hace el bot (config.internacional.avisarSinConsultar).

const TITULOS = {
  juleriaque: 'Juleriaque', grid: 'Grid', rouge: 'Rouge', parfumerie: 'Parfumerie', moov: 'Moov', newera: 'New Era',
};

const { values: args } = parseArgs({
  options: {
    datos: { type: 'string', default: 'datos' },
    fecha: { type: 'string', default: hoyArgentina() },
    'dry-run': { type: 'boolean', default: false },
    'max-pedidos': { type: 'string' },
    pausa: { type: 'string' }, // ms entre pedidos a Perfumania
    forzar: { type: 'boolean', default: false },
  },
});
try { process.loadEnvFile('.env'); } catch { /* sin .env */ }

const dryRun = args['dry-run'];
const avisos = (await readFile(`${args.datos}/avisos.jsonl`, 'utf8'))
  .split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((a) => a.fecha === args.fecha);
if (avisos.length === 0) {
  console.error(`No hay avisos del ${args.fecha} en ${args.datos}/avisos.jsonl`);
  process.exit(2);
}
console.log(`${avisos.length} avisos del ${args.fecha}${dryRun ? ' · DRY-RUN (no se manda nada)' : ''}`);

const historiales = {};
for (const fuente of new Set(avisos.map((a) => a.fuente))) {
  historiales[fuente] = JSON.parse(await readFile(`${args.datos}/${fuente}/historial.json`, 'utf8'));
}

const dolar = await obtenerDolar(crearCliente());
if (!dolar) process.exit(1); // sin dólar no hay filtro: reenviar sería mandar lo mismo
console.log(`Dólar blue medio: $${dolar.toFixed(2)}`);
const cfg = {
  ...config.internacional,
  perfumania: {
    ...config.internacional.perfumania,
    ...(args['max-pedidos'] ? { maxPedidosPorCorrida: Number(args['max-pedidos']) } : {}),
    ...(args.pausa ? { pausaMs: Number(args.pausa) } : {}),
  },
};
const referencias = crearReferencias({
  cliente: crearCliente({ pausaMs: cfg.perfumania.pausaMs, esperasReintento: [] }),
  dolar,
  hoy: args.fecha,
  rutaCache: `${args.datos}/referencias/perfumania.json`,
  cfg,
});

const porFuente = new Map();
const caras = [];
const pendientes = [];
for (const a of avisos) {
  const p = historiales[a.fuente]?.productos?.[a.id] ?? {};
  const oferta = {
    id: a.id, marca: p.marca ?? '', nombre: a.nombre, ml: p.ml ?? null, ean: p.ean ?? null, cat: p.cat ?? null,
    url: a.url, precioActual: a.precio,
  };
  const puntaje = { veredicto: a.veredicto, precioMercado: a.precioMercado, margen: a.margen === null ? undefined : a.margen / 100, via: a.via };
  const ref = await referencias.buscar(oferta);
  const linea = `${TITULOS[a.fuente] ?? a.fuente}: ${a.nombre} $${a.precio.toLocaleString('es-AR')}`;
  if (ref.estado === 'pendiente') {
    pendientes.push(linea);
    if (!args.forzar) continue;
  }
  if (ref.estado === 'ok' && oferta.precioActual > ref.pesos) {
    caras.push(`${linea} > EE. UU. US$${ref.usd} = ${miles(ref.pesos)}${ref.via === 'nombre' ? ' (~)' : ''} ${ref.url}`);
    continue;
  }
  if (!porFuente.has(a.fuente)) porFuente.set(a.fuente, []);
  porFuente.get(a.fuente).push(itemTabla(oferta, puntaje, ref));
  console.log(`${ref.estado === 'pendiente' ? 'sin consultar (*)' : ref.estado === 'ok' ? `debajo de EE. UU. (US$${ref.usd} = ${miles(ref.pesos)}${ref.via === 'nombre' ? ', ~' : ''})` : 'sin precio EE. UU. (*)'}: ${linea}`);
}
await referencias.guardar();

console.log(`\nMás caras que en EE. UU. (no se reenvían): ${caras.length}`);
for (const c of caras) console.log(`  ${c}`);
if (pendientes.length) {
  console.log(`\nSin consultar (Perfumania ${referencias.bloqueo ? 'bloqueó' : 'cupo agotado'}): ${pendientes.length}. Volver a correr más tarde; el caché evita repetir lo ya consultado.`);
  for (const p of pendientes) console.log(`  ${p}`);
  if (args.forzar) console.log('--forzar: se mandan igual, con "*".');
  else if (!dryRun) {
    console.error('No se reenvía nada con ofertas sin consultar: el reenvío quedaría incompleto.');
    process.exit(1);
  }
}

let enviados = 0;
for (const [fuente, items] of porFuente) {
  const titulo = `Reenvío ${TITULOS[fuente] ?? fuente} (filtro EE. UU.)`;
  const { mensajes } = agruparTabla(items, { titulo, leyenda: LEYENDA_INTERNACIONAL, maxMensajes: config.maxMensajesTotalPorCorrida });
  for (const texto of mensajes) {
    if (enviados > 0 && !dryRun) await new Promise((r) => setTimeout(r, config.pausaMensajesMs));
    const r = await enviar(texto, { dryRun });
    if (r.enviado || dryRun) enviados++;
    else console.log(`No enviado (${r.motivo})`);
  }
}
console.log(`\nMensajes ${dryRun ? 'que se mandarían' : 'enviados'}: ${enviados}`);
