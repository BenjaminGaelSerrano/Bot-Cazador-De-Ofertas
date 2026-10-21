import { config } from './config.mjs';
import { cargarAlertas, debeAvisar, guardarAlertas, limpiar, marcarAvisada } from './nucleo/alertas.mjs';
import { avisarFalla, marcarRecuperada } from './nucleo/fallas.mjs';
import { evaluar } from './nucleo/ganga.mjs';
import { cargar as cargarHistorial, guardar as guardarHistorial, registrar } from './nucleo/historial.mjs';
import { agrupar, enviar } from './notificar/callmebot.mjs';
import { formatearOferta } from './notificar/formato.mjs';

const dormirReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Una corrida completa de una fuente: leer → registrar precios → evaluar gangas → avisar.
 *
 * Orden pensado para no perder datos: el historial se guarda ANTES de avisar, y cada aviso se anota
 * como enviado solo después de que el mensaje salió. Lo que no entra por los topes de mensajes
 * (o falla al enviarse) queda sin marcar y se intenta de nuevo en la corrida siguiente.
 * Con `dryRun` no se escribe ni se envía nada.
 */
export async function correrFuente({
  nombre,
  titulo,
  leer,
  cliente,
  fecha,
  dryRun = false,
  directorioDatos = 'datos',
  enviarFn = enviar,
  pausaMensajesMs = config.pausaMensajesMs,
  maxMensajes = config.maxMensajesPorCorrida,
  maxPrimeraCorrida = config.primeraCorridaMaxOfertas,
  dormir = dormirReal,
  log = console.log,
}) {
  const rutaHistorial = `${directorioDatos}/${nombre}/historial.json`;
  const rutaAlertas = `${directorioDatos}/alertas.json`;
  const clave = (oferta) => `${nombre}:${oferta.id}`;

  const { ofertas, informe } = await leer(cliente, { log });

  // 1. Historial: se registra todo. Si estaba vacío, es la primera corrida de esta fuente.
  const historial = await cargarHistorial(rutaHistorial);
  const primeraCorrida = Object.keys(historial.productos).length === 0;
  const cambios = { nuevo: 0, cambio: 0, igual: 0 };
  for (const oferta of ofertas) cambios[registrar(historial, oferta, fecha)]++;

  // 2. Gangas de hoy.
  const gangas = [];
  for (const oferta of ofertas) {
    const evaluacion = evaluar(oferta, historial.productos[oferta.id], fecha);
    if (evaluacion) gangas.push({ oferta, evaluacion });
  }

  // 3. Quitar las ya avisadas y limpiar las que dejaron de ser ganga.
  const estado = await cargarAlertas(rutaAlertas);
  limpiar(estado, {
    vistos: new Set(ofertas.map(clave)),
    sinStock: new Set(ofertas.filter((o) => !(o.stock > 0)).map(clave)),
    gangasAhora: new Set(gangas.map((g) => clave(g.oferta))),
  });
  let pendientes = gangas
    .filter((g) => debeAvisar(estado, clave(g.oferta), g.oferta.precioActual))
    .sort((a, b) => b.evaluacion.descuento - a.evaluacion.descuento);

  // Primera corrida de una fuente: casi todo el catálogo parece "nuevo". Se avisan solo las mejores y el
  // resto queda como línea base (marcado como visto, sin avisar), para no inundar el WhatsApp de ofertas viejas.
  let silenciadas = 0;
  if (primeraCorrida && pendientes.length > maxPrimeraCorrida) {
    for (const { oferta } of pendientes.slice(maxPrimeraCorrida)) marcarAvisada(estado, clave(oferta), oferta.precioActual, fecha);
    silenciadas = pendientes.length - maxPrimeraCorrida;
    pendientes = pendientes.slice(0, maxPrimeraCorrida);
  }

  // Orden de escritura pensado para no dejar el estado a medias: primero la línea base de alertas y recién
  // después el historial. Si se cae entre ambos, la próxima corrida vuelve a ser "primera" y repite la línea
  // base sin daño; al revés, repetiría de golpe todas las ofertas viejas. Todo esto, antes de tocar WhatsApp.
  if (!dryRun) {
    if (silenciadas > 0) await guardarAlertas(rutaAlertas, estado);
    await guardarHistorial(rutaHistorial, historial);
  }

  // 4. Avisar, anotando cada mensaje recién cuando salió.
  const tituloEnvio = silenciadas > 0 ? `${titulo} · primera lectura, mejores de ${pendientes.length + silenciadas}` : titulo;
  const { mensajes, porMensaje } = agrupar(
    pendientes.map((g) => ({ texto: formatearOferta(g.oferta, g.evaluacion) })),
    { titulo: tituloEnvio, maxMensajes },
  );
  let avisadas = 0;
  let errorEnvio = null;
  let desde = 0;
  for (const [i, texto] of mensajes.entries()) {
    if (i > 0 && pausaMensajesMs > 0 && !dryRun) await dormir(pausaMensajesMs);
    let resultado;
    try {
      resultado = await enviarFn(texto, { dryRun, log });
    } catch (error) {
      errorEnvio = error;
      break;
    }
    if (resultado.enviado) {
      for (const { oferta } of pendientes.slice(desde, desde + porMensaje[i])) {
        marcarAvisada(estado, clave(oferta), oferta.precioActual, fecha);
        avisadas++;
      }
    }
    desde += porMensaje[i];
  }

  if (!dryRun) await guardarAlertas(rutaAlertas, estado);
  if (errorEnvio) throw errorEnvio;

  return { informe, cambios, ofertas: ofertas.length, gangas: gangas.length, pendientes: pendientes.length, mensajes: mensajes.length, avisadas, primeraCorrida, silenciadas };
}

/**
 * Igual que `correrFuente`, pero si falla avisa una sola vez por WhatsApp (sin tocar el historial, que
 * `correrFuente` solo escribe después de leer bien) y vuelve a lanzar el error para que la corrida
 * quede en rojo. Si anda bien, borra cualquier falla previa.
 */
export async function correrConAvisoDeFalla(opciones) {
  const { nombre, fecha, dryRun, directorioDatos, enviarFn, log } = opciones;
  try {
    const resultado = await correrFuente(opciones);
    await marcarRecuperada({ nombre, directorioDatos, dryRun });
    return resultado;
  } catch (error) {
    await avisarFalla({ nombre, error, fecha, directorioDatos, dryRun, enviarFn, log });
    throw error;
  }
}
