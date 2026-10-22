import { config } from './config.mjs';
import { cargarAlertas, debeAvisar, guardarAlertas, limpiar, marcarAvisada } from './nucleo/alertas.mjs';
import { avisarFalla, marcarRecuperada } from './nucleo/fallas.mjs';
import { evaluar } from './nucleo/ganga.mjs';
import { anexarAvisos } from './nucleo/avisos.mjs';
import { ErrorFuente } from './nucleo/http.mjs';
import { cargar as cargarHistorial, guardar as guardarHistorial, registrar } from './nucleo/historial.mjs';
import { cargarOtros, construirIndice, precioMercado } from './nucleo/mercado.mjs';
import { compararPorReventa, nivelDemanda, puntuar, velocidadVenta } from './nucleo/reventa.mjs';
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
  limitesMensaje = {}, // para pruebas: pisa los topes de largo de cada mensaje
  dormir = dormirReal,
  log = console.log,
}) {
  const rutaHistorial = `${directorioDatos}/${nombre}/historial.json`;
  const rutaAlertas = `${directorioDatos}/alertas.json`;
  const clave = (oferta) => `${nombre}:${oferta.id}`;

  // El historial se carga antes de leer: algunos lectores lo usan para no volver a pedir lo que ya saben (atributos).
  const historial = await cargarHistorial(rutaHistorial);
  const primeraCorrida = Object.keys(historial.productos).length === 0;

  const { ofertas, informe } = await leer(cliente, { log, historial });

  // 1. Historial: se registra todo. Si estaba vacío, es la primera corrida de esta fuente.
  const cambios = { nuevo: 0, cambio: 0, igual: 0 };
  for (const oferta of ofertas) cambios[registrar(historial, oferta, fecha)]++;

  // 2. Gangas de hoy.
  const gangas = [];
  for (const oferta of ofertas) {
    const evaluacion = evaluar(oferta, historial.productos[oferta.id], fecha);
    if (evaluacion) gangas.push({ oferta, evaluacion });
  }

  // 2b. Reventa: a cuánto vende otra tienda el mismo producto (con los precios que el bot ya guardó, sin pedidos
  // nuevos) y qué tan rápido se mueve el stock. Una oferta que otra tienda ya vende más barato, o cuyo margen no
  // alcanza, no se avisa ("evitar"); tampoco se marca como avisada, así que se reevalúa en cada corrida.
  const indice = construirIndice(await cargarOtros(directorioDatos, nombre), fecha);
  for (const g of gangas) {
    const mercado = precioMercado(indice, g.oferta, nombre);
    const demanda = nivelDemanda(velocidadVenta(historial.productos[g.oferta.id], fecha));
    g.puntaje = puntuar({ costo: g.oferta.precioActual, mercado, demanda });
  }
  const evitadas = gangas.filter((g) => g.puntaje.veredicto === 'evitar').length;

  // 3. Quitar las ya avisadas y limpiar las que dejaron de ser ganga.
  const estado = await cargarAlertas(rutaAlertas);
  limpiar(estado, {
    vistos: new Set(ofertas.map(clave)),
    sinStock: new Set(ofertas.filter((o) => !(o.stock > 0)).map(clave)),
    gangasAhora: new Set(gangas.map((g) => clave(g.oferta))),
  });
  let pendientes = gangas
    .filter((g) => g.puntaje.veredicto !== 'evitar' && debeAvisar(estado, clave(g.oferta), g.oferta.precioActual))
    .sort(compararPorReventa);

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
  // En la primera corrida el título es corto a propósito: cada caracter del encabezado le resta lugar a una oferta.
  const tituloEnvio = silenciadas > 0 ? `${titulo} · 1ª lectura, de ${pendientes.length + silenciadas}` : titulo;
  const { mensajes, porMensaje } = agrupar(
    pendientes.map((g) => ({ texto: formatearOferta(g.oferta, g.evaluacion, { puntaje: g.puntaje }) })),
    { titulo: tituloEnvio, tituloContinuacion: `${titulo} (cont.)`, maxMensajes, ...limitesMensaje },
  );
  let avisadas = 0;
  let errorEnvio = null;
  let desde = 0;
  const registroAvisos = [];
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
      for (const { oferta, evaluacion, puntaje } of pendientes.slice(desde, desde + porMensaje[i])) {
        marcarAvisada(estado, clave(oferta), oferta.precioActual, fecha);
        avisadas++;
        // Se guarda el puntaje que se dio para poder contrastarlo después con lo que realmente se vendió.
        registroAvisos.push({
          fecha, fuente: nombre, id: oferta.id, nombre: oferta.nombre, url: oferta.url, precio: oferta.precioActual,
          descuento: Math.round(evaluacion.descuento * 100), tipo: evaluacion.tipo, veredicto: puntaje.veredicto,
          precioMercado: puntaje.precioMercado ?? null, fuenteMercado: puntaje.fuente ?? null, via: puntaje.via ?? null,
          margen: puntaje.margen === undefined ? null : Math.round(puntaje.margen * 100), demanda: puntaje.demanda ?? null,
        });
      }
    }
    desde += porMensaje[i];
  }

  if (!dryRun) {
    await guardarAlertas(rutaAlertas, estado);
    await anexarAvisos(`${directorioDatos}/avisos.jsonl`, registroAvisos);
  }
  if (errorEnvio) throw errorEnvio;

  const cuenta = (v) => gangas.filter((g) => g.puntaje.veredicto === v).length;
  return {
    informe, cambios, ofertas: ofertas.length, gangas: gangas.length, pendientes: pendientes.length, mensajes: mensajes.length, avisadas, primeraCorrida, silenciadas,
    reventa: { buenas: cuenta('buena'), regulares: cuenta('regular'), sinReferencia: cuenta('sin-referencia'), evitadas },
  };
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
    const parciales = resultado.informe.parciales ?? [];
    if (parciales.length > 0) {
      // La corrida sirvió (precios y avisos hechos), pero faltaron páginas del sitio: se avisa una vez.
      const detalle = parciales.map((p) => `${p.categoria} desde el producto ${p.desde}`).join('; ');
      await avisarFalla({ nombre, error: new ErrorFuente('parcial', `No se pudo leer: ${detalle}`), fecha, directorioDatos, dryRun, enviarFn, log });
    } else {
      await marcarRecuperada({ nombre, directorioDatos, dryRun });
    }
    return resultado;
  } catch (error) {
    await avisarFalla({ nombre, error, fecha, directorioDatos, dryRun, enviarFn, log });
    throw error;
  }
}
