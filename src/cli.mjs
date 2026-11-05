import { parseArgs } from 'node:util';
import { config } from './config.mjs';
import { leerCatalogo as leerGrid } from './fuentes/grid.mjs';
import { leerCatalogo as leerJuleriaque } from './fuentes/juleriaque.mjs';
import { leerCatalogo as leerMoov, leerTalles as tallesMoov } from './fuentes/moov.mjs';
import { leerCatalogo as leerDexter, leerTalles as tallesDexter } from './fuentes/dexter.mjs';
import { leerCatalogo as leerNewEra } from './fuentes/newera.mjs';
import { leerCatalogo as leerParfumerie } from './fuentes/parfumerie.mjs';
import { leerCatalogo as leerRouge } from './fuentes/rouge.mjs';
import { leerCatalogo as leerSimplicity } from './fuentes/simplicity.mjs';
import { leerCatalogo as leerPigmento } from './fuentes/pigmento.mjs';
import { cupoDeCorrida, enviadosHoy, sumarEnviados } from './nucleo/envios.mjs';
import { limitarWhatsapp, nombreCanal, whatsappEnviados } from './notificar/canal.mjs';
import { telegramActivo } from './notificar/telegram.mjs';
import { hoyArgentina } from './nucleo/fechas.mjs';
import { crearEbay } from './nucleo/ebay.mjs';
import { crearUpcitemdb } from './nucleo/upcitemdb.mjs';
import { avisarFalla, marcarRecuperada } from './nucleo/fallas.mjs';
import { crearReferencias, obtenerDolar } from './nucleo/internacional.mjs';
import { ErrorFuente, crearCliente } from './nucleo/http.mjs';
import { correrFuentes } from './principal.mjs';

// El orden importa: el cupo de consultas de precio de EE. UU. se va gastando tienda por tienda. Moov va segunda para
// que siempre le llegue (es la única de calzado con búsqueda exacta, por código de modelo).
const FUENTES = {
  juleriaque: { leer: leerJuleriaque, titulo: 'Ofertas Juleriaque' },
  moov: { leer: leerMoov, titulo: 'Ofertas Moov', talles: tallesMoov },
  dexter: { leer: leerDexter, titulo: 'Ofertas Dexter', talles: tallesDexter },
  rouge: { leer: leerRouge, titulo: 'Ofertas Rouge' },
  pigmento: { leer: leerPigmento, titulo: 'Ofertas Pigmento' },
  simplicity: { leer: leerSimplicity, titulo: 'Ofertas Simplicity' },
  grid: { leer: leerGrid, titulo: 'Ofertas Grid' },
  parfumerie: { leer: leerParfumerie, titulo: 'Ofertas Parfumerie' },
  newera: { leer: leerNewEra, titulo: 'Ofertas New Era' },
};

const { values: args } = parseArgs({
  options: {
    fuente: { type: 'string', default: 'todas' }, // un nombre, varios separados por coma, o "todas"
    'dry-run': { type: 'boolean', default: false },
    forzar: { type: 'boolean', default: false }, // avisa todo lo que vale la pena aunque ya se haya avisado
    datos: { type: 'string', default: 'datos' },
    pausa: { type: 'string' },
  },
});

// Para correr en local: las credenciales se leen de .env si existe (en Actions vienen de los secrets).
try { process.loadEnvFile('.env'); } catch { /* sin .env */ }

// "todas" deja afuera las fuentes pausadas (config.fuentesPausadas); se pueden correr igual nombrándolas.
const nombres = args.fuente === 'todas' ? Object.keys(FUENTES).filter((n) => !(config.fuentesPausadas ?? []).includes(n)) : args.fuente.split(',').map((s) => s.trim()).filter(Boolean);
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
if (config.avisar.pausados) console.log('AVISOS PAUSADOS (config.avisar.pausados): se leen y guardan precios, no se mandan ofertas. Las fallas sí se avisan.');

// El tiempo de cada fuente se mide acá, envolviendo la lectura.
const tiempos = {};
const fuentes = Object.fromEntries(Object.entries(FUENTES).map(([nombre, f]) => [nombre, {
  ...f,
  leer: async (...a) => {
    const t = Date.now();
    try { return await f.leer(...a); } finally { tiempos[nombre] = minutosDesde(t); }
  },
}]));

// Precio de mercado: eBay EE. UU. si hay credenciales (spec 007); si no, el cruce entre tiendas argentinas con el filtro
// de Perfumania (spec 006). Un servicio para toda la corrida, con el caché en la rama de datos.
const dolar = (config.ebay.activo || config.upcitemdb.activo || config.internacional.activa) ? await obtenerDolar(crearCliente()) : null;
if (dolar) console.log(`Dólar blue medio: $${dolar.toFixed(2)}`);
let ebay = null;
if (config.ebay.activo && process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET) {
  ebay = crearEbay({
    clientId: process.env.EBAY_CLIENT_ID,
    clientSecret: process.env.EBAY_CLIENT_SECRET,
    dolar,
    hoy: fecha,
    rutaCache: `${args.datos}/referencias/ebay-v2.json`,
  });
  console.log('Precio de mercado: eBay EE. UU.');
  // Si las credenciales fallan, la primera búsqueda lo detecta y lo avisa como falla de fuente.
  await ebay.ajustarCupo().catch(() => {});
} else if (config.upcitemdb.activo) {
  // Provisorio hasta que eBay apruebe la cuenta: mismo contrato, solo productos con código de barras.
  ebay = crearUpcitemdb({ dolar, hoy: fecha, rutaCache: `${args.datos}/referencias/upcitemdb.json` });
  console.log('Precio de mercado: UPCitemdb (tiendas de EE. UU., provisorio hasta tener eBay). Sin código de barras = sin referencia.');
} else {
  console.log('Sin precio de mercado externo: cruce entre tiendas argentinas.');
}
let referencias = null;
if (!ebay && config.internacional.activa) {
  referencias = crearReferencias({
    cliente: crearCliente({ pausaMs: config.internacional.perfumania.pausaMs, esperasReintento: [] }),
    dolar,
    hoy: fecha,
    rutaCache: `${args.datos}/referencias/perfumania.json`,
  });
}

// Tope diario de WhatsApp (CallMeBot deja de entregar en silencio pasado un límite que no publica).
const rutaEnvios = `${args.datos}/envios.json`;
const yaEnviadosHoy = await enviadosHoy(rutaEnvios, fecha);
// El tope diario es por CallMeBot; Telegram no tiene ese límite oculto.
// Con Telegram, WhatsApp manda solo copias, hasta lo que queda del tope diario.
if (telegramActivo()) limitarWhatsapp(cupoDeCorrida(Infinity, config.maxMensajesPorDia, yaEnviadosHoy));
const maxMensajesTotal = telegramActivo()
  ? config.maxMensajesTotalPorCorrida
  : cupoDeCorrida(config.maxMensajesTotalPorCorrida, config.maxMensajesPorDia, yaEnviadosHoy);
console.log(`Avisos por ${nombreCanal()}: ${yaEnviadosHoy} enviados hoy, ${maxMensajesTotal} disponibles para esta corrida.`);
const { resultados, fallaron, mensajesUsados, limiteEnvio } = await correrFuentes({
  maxMensajesTotal,
  nombres,
  fuentes,
  fecha,
  dryRun,
  directorioDatos: args.datos,
  crearCliente: () => crearCliente({ pausaMs: args.pausa ? Number(args.pausa) : config.pausaMs }),
  extra: { referencias, ebay, avisosPausados: config.avisar.pausados ?? false, ignorarAvisadas: args.forzar, fuentesSoloPerfumes: config.soloPerfumes ?? [] },
});

// El tope diario cuenta solo lo que salió por WhatsApp (con Telegram, las copias).
const porWhatsapp = telegramActivo() ? whatsappEnviados() : mensajesUsados;
if (!dryRun && porWhatsapp > 0) await sumarEnviados(rutaEnvios, fecha, porWhatsapp);

if (ebay) {
  if (!dryRun) await ebay.guardar();
  console.log(`${ebay.nombre}: ${ebay.consultas} consultas${ebay.corte ? ` (cortado: ${ebay.corte.message})` : ''}`);
  // Si eBay corta desde el principio (credenciales o acceso), ninguna oferta tiene precio de mercado y nada se avisaría:
  // eso se avisa una vez, como una fuente caída. Un corte a mitad de corrida (límite) no: lo pendiente sale en la próxima.
  if (ebay.corte && ebay.consultas <= 1) {
    await avisarFalla({ nombre: ebay.nombre, error: ebay.corte, fecha, directorioDatos: args.datos, dryRun });
  } else if (ebay.consultas > 0) {
    await marcarRecuperada({ nombre: ebay.nombre, directorioDatos: args.datos, dryRun });
  }
}

if (referencias) {
  if (!dryRun) await referencias.guardar();
  // Un bloqueo de Perfumania no se avisa como falla: es lo esperable (limita a unos pocos pedidos) y no silencia nada,
  // porque lo que no se pudo consultar se avisa igual con "*" (config.internacional.avisarSinConsultar).
  console.log(`Referencia internacional: ${referencias.pedidos} pedidos a Perfumania${referencias.bloqueo ? ' (bloqueó: lo que faltó se consulta en la próxima corrida)' : ''}`);
}

for (const r of resultados) {
  console.log(`\n=== ${r.nombre} (${tiempos[r.nombre] ?? '?'} min de lectura)`);
  if (!r.ok) {
    const e = r.error;
    if (e instanceof ErrorFuente) console.error(`Falla de la fuente (${e.tipo}${e.status ? ` ${e.status}` : ''}): ${e.message}`);
    else console.error(e);
    continue;
  }
  const { informe, cambios } = r.resultado;
  if (informe.enriquecidos !== undefined) console.log(`Atributos: ${informe.enriquecidos} unidades enriquecidas en esta corrida, ${informe.sinAtributos} todavía sin código de barras ni marca`);
  console.log(`Productos leídos: ${informe.productosLeidos} · ofertas válidas: ${r.resultado.ofertas} · pedidos: ${informe.pedidos}`);
  console.log(`Historial: ${cambios.nuevo} nuevos, ${cambios.cambio} con cambio de precio, ${cambios.igual} sin cambios${dryRun ? ' (no guardado)' : ' (guardado)'}`);
  const eb = r.resultado.ebay;
  if (eb) console.log(`Precio de mercado externo: ${eb.conPrecio} gangas con precio de mercado, ${eb.sinPrecio} sin publicaciones o sin código, ${eb.pendientes} sin consultar todavía`);
  const int = r.resultado.internacional;
  if (int) console.log(`EE. UU.: ${int.conPrecio} debajo del precio de Perfumania, ${int.sinPrecio} sin precio (*), ${int.caras} más caras que en EE. UU. (no se avisan), ${int.pendientes} sin consultar todavía (van con *)`);
  console.log(`Gangas hoy: ${r.resultado.gangas} · por avisar: ${r.resultado.pendientes} · mensajes: ${r.resultado.mensajes} · ofertas avisadas: ${r.resultado.avisadas}`);
  if (r.resultado.primeraCorrida) console.log(`Primera corrida de esta fuente: se avisan las mejores y ${r.resultado.silenciadas} ofertas quedan como línea base (sin avisar)${dryRun ? ' (simulado)' : ''}`);
  if (informe.catalogoTotal !== null) console.log(`Cobertura: ${informe.productosLeidos} de ${informe.catalogoTotal} productos del sitio`);
  const tolerancia = config.fuentes[r.nombre]?.toleranciaCobertura ?? 0.01;
  if (informe.sinCubrir > informe.catalogoTotal * tolerancia) console.warn('AVISO: hay productos en el sitio fuera de las categorías configuradas; revisar si aparecieron categorías nuevas.');
  if (informe.parciales?.length) console.warn('AVISO lectura parcial (el sitio falló tras los reintentos):', JSON.stringify(informe.parciales));
  if (informe.truncados.length) console.warn('AVISO categorías truncadas:', JSON.stringify(informe.truncados));
  if (informe.incompletos.length) console.warn('AVISO cobertura incompleta:', JSON.stringify(informe.incompletos));
}

if (limiteEnvio) console.warn(`AVISO: CallMeBot rechazó un mensaje tras ${mensajesUsados} enviados: ese es su límite por corrida. Lo que falta sale en la próxima. Si en el WhatsApp llegaron menos de ${mensajesUsados}, bajar maxMensajesTotalPorCorrida en src/config.mjs.`);
console.log(`\nTotal: ${minutosDesde(inicio)} min · mensajes: ${mensajesUsados}/${config.maxMensajesTotalPorCorrida} · fallas: ${fallaron.length ? fallaron.join(', ') : 'ninguna'}`);
if (fallaron.length) process.exitCode = 1;
