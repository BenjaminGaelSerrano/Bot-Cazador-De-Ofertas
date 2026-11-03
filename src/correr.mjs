import { config } from './config.mjs';
import { cargarAlertas, debeAvisar, guardarAlertas, limpiar, marcarAvisada } from './nucleo/alertas.mjs';
import { avisarFalla, marcarRecuperada } from './nucleo/fallas.mjs';
import { evaluar } from './nucleo/ganga.mjs';
import { anexarAvisos } from './nucleo/avisos.mjs';
import { ErrorFuente } from './nucleo/http.mjs';
import { cargar as cargarHistorial, guardar as guardarHistorial, registrar } from './nucleo/historial.mjs';
import { cargarOtros, construirIndice, precioMercado } from './nucleo/mercado.mjs';
import { ordenarParaConsultar } from './nucleo/prioridad.mjs';
import { compararPorReventa, nivelDemanda, puntuar, velocidadVenta } from './nucleo/reventa.mjs';
import { agrupar } from './notificar/callmebot.mjs';
import { enviar } from './notificar/canal.mjs';
import { formatearOferta } from './notificar/formato.mjs';
import { LEYENDA_EBAY, LEYENDA_INTERNACIONAL, agruparTabla, itemTabla } from './notificar/tabla.mjs';

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
  formato = config.formatoMensaje, // 'tabla' | 'detalle'
  veredictosAvisables = config.avisar.veredictos,
  avisosPausados = false,
  cfgReventa = config.reventa, // las pruebas de la mecánica usan los parámetros de la spec 003 // el CLI pasa config.avisar.pausados; los reenvíos y pruebas no se pausan
  reiniciarAlertasAntesDe = config.reiniciarAlertasAntesDe,
  // Estado de envío compartido por todas las tiendas de una corrida: cuántos mensajes salieron y si CallMeBot ya
  // rechazó uno (el límite). Una vez bloqueado, nadie más intenta enviar en esa corrida.
  estadoEnvio = { enviados: 0, bloqueado: false },
  // Referencia internacional (spec 006): servicio de `crearReferencias`, compartido por las tiendas. null = desactivada.
  referencias = null,
  // Precio de mercado externo (spec 007): servicio de `crearEbay` o, mientras eBay no esté, de `crearUpcitemdb` (mismo
  // contrato). null = cruce entre tiendas argentinas (spec 003).
  ebay = null,
  concurrenciaEbay = config.ebay.concurrencia,
  avisarSinConsultar = config.internacional.avisarSinConsultar,
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
  // Con eBay, el precio de mercado es el de eBay EE. UU. (spec 007); las de mayor descuento se consultan primero, por si
  // se agota el cupo. Lo que no se pudo consultar queda "sin referencia": no se avisa y se reevalúa en la próxima.
  const indice = ebay ? null : construirIndice(await cargarOtros(directorioDatos, nombre), fecha);
  if (ebay) {
    // Orden: lo que ya está en caché, y después por baja real (contra su propio historial) e inflación de la marca.
    const { orden } = await ordenarParaConsultar(gangas, {
      historial, fecha, enCache: ebay.enCache ? (o) => ebay.enCache(o, nombre) : null,
    });
    const pendientesDeConsulta = orden.filter((g) => !g.ebay);
    const paralelo = ebay.concurrencia ?? concurrenciaEbay;
    for (let i = 0; i < pendientesDeConsulta.length; i += paralelo) {
      await Promise.all(pendientesDeConsulta.slice(i, i + paralelo).map(async (g) => { g.ebay = await ebay.precio(g.oferta, nombre); }));
    }
  }
  for (const g of gangas) {
    const mercado = ebay
      ? (g.ebay?.estado === 'ok' ? { precio: g.ebay.precio, fuente: ebay.nombre ?? 'ebay', url: g.ebay.url, via: g.ebay.via === 'nombre' ? 'modelo' : g.ebay.via } : null)
      : precioMercado(indice, g.oferta, nombre);
    const demanda = nivelDemanda(velocidadVenta(historial.productos[g.oferta.id], fecha));
    g.puntaje = puntuar({ costo: g.oferta.precioActual, mercado, demanda }, cfgReventa);
  }
  const evitadas = gangas.filter((g) => g.puntaje.veredicto === 'evitar').length;

  // 3. Quitar las ya avisadas y limpiar las que dejaron de ser ganga.
  const estado = await cargarAlertas(rutaAlertas);
  // Reinicio único: las marcas de "ya avisado" anteriores a esta fecha se ignoran. Las primeras corridas silenciaron como
  // línea base casi todo el catálogo, incluidas ofertas buenas que nunca llegaron al WhatsApp; con el aviso solo de lo
  // que vale la pena, esas tienen que poder salir. Las nuevas marcas llevan fecha posterior y se respetan.
  if (reiniciarAlertasAntesDe) {
    for (const [clave, marca] of Object.entries(estado)) if (marca.fecha < reiniciarAlertasAntesDe) delete estado[clave];
  }
  limpiar(estado, {
    vistos: new Set(ofertas.map(clave)),
    sinStock: new Set(ofertas.filter((o) => !(o.stock > 0)).map(clave)),
    gangasAhora: new Set(gangas.map((g) => clave(g.oferta))),
  });
  let pendientes = gangas
    // Solo se avisa lo que vale la pena (por defecto, las "buena"). Lo demás no se marca: se reevalúa en cada corrida.
    .filter((g) => !avisosPausados && veredictosAvisables.includes(g.puntaje.veredicto) && debeAvisar(estado, clave(g.oferta), g.oferta.precioActual))
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

  // 3b. Referencia internacional (constitución §4, condición 2): solo para lo que se va a avisar, así se pide lo menos
  // posible. Más caro que en EE. UU. = no es ganga; no se marca como avisada, se reevalúa en cada corrida. Sin precio de
  // EE. UU. se avisa con "*". Lo que no se pudo consultar (cupo o bloqueo) también sale con "*", salvo que
  // `avisarSinConsultar` sea false: entonces espera a la próxima corrida.
  const internacional = { caras: 0, pendientes: 0, conPrecio: 0, sinPrecio: 0 };
  if (referencias) {
    const quedan = [];
    for (const g of pendientes) {
      g.ref = await referencias.buscar(g.oferta);
      if (g.ref.estado === 'pendiente') {
        internacional.pendientes++;
        if (!avisarSinConsultar) continue;
      }
      if (g.ref.estado === 'ok' && g.oferta.precioActual > g.ref.pesos) { internacional.caras++; continue; }
      if (g.ref.estado !== 'pendiente') internacional[g.ref.estado === 'ok' ? 'conPrecio' : 'sinPrecio']++;
      quedan.push(g);
    }
    pendientes = quedan;
  }

  // 4. Avisar, anotando cada mensaje recién cuando salió.
  // En la primera corrida el título es corto a propósito: cada caracter del encabezado le resta lugar a una oferta.
  const tituloEnvio = silenciadas > 0 ? `${titulo} · 1ª lectura, de ${pendientes.length + silenciadas}` : titulo;
  const { mensajes, porMensaje } = formato === 'tabla'
    ? agruparTabla(
      pendientes.map((g) => itemTabla(g.oferta, g.puntaje, g.ref)),
      { titulo: tituloEnvio, tituloContinuacion: `*${titulo}* (cont.)`, maxMensajes, ...(ebay ? { leyenda: ebay.leyenda ?? LEYENDA_EBAY } : referencias ? { leyenda: LEYENDA_INTERNACIONAL } : {}), ...limitesMensaje },
    )
    : agrupar(
      pendientes.map((g) => ({ texto: formatearOferta(g.oferta, g.evaluacion, { puntaje: g.puntaje }) })),
      { titulo: tituloEnvio, tituloContinuacion: `${titulo} (cont.)`, maxMensajes, ...limitesMensaje },
    );
  let avisadas = 0;
  let enviadosAqui = 0;
  let limiteEnvio = null;
  let errorEnvio = null;
  let desde = 0;
  const registroAvisos = [];
  for (const [i, texto] of mensajes.entries()) {
    // Si CallMeBot ya rechazó un mensaje en esta corrida, lo que falta queda en cola para la siguiente.
    if (estadoEnvio.bloqueado) break;
    if ((i > 0 || estadoEnvio.enviados > 0) && pausaMensajesMs > 0 && !dryRun) await dormir(pausaMensajesMs);
    let resultado;
    try {
      resultado = await enviarFn(texto, { dryRun, log });
    } catch (error) {
      if (estadoEnvio.enviados > 0 && !dryRun) {
        // Ya salieron mensajes y este fue rechazado: es el límite de envío, no una caída. No es una falla de la corrida:
        // se corta acá, lo no enviado no se marca como avisado y se reintenta en la próxima.
        estadoEnvio.bloqueado = true;
        limiteEnvio = error.message;
        log(`Límite de envío alcanzado tras ${estadoEnvio.enviados} mensajes (${error.message}). Lo que falta sale en la próxima corrida.`);
      } else {
        errorEnvio = error; // ni siquiera el primero salió: CallMeBot no responde, eso sí es una falla
      }
      break;
    }
    if (resultado.enviado) {
      estadoEnvio.enviados++;
      enviadosAqui++;
      for (const g of pendientes.slice(desde, desde + porMensaje[i])) {
        const { oferta, evaluacion, puntaje, ref } = g;
        marcarAvisada(estado, clave(oferta), oferta.precioActual, fecha);
        avisadas++;
        // Se guarda el puntaje que se dio para poder contrastarlo después con lo que realmente se vendió.
        registroAvisos.push({
          fecha, fuente: nombre, id: oferta.id, nombre: oferta.nombre, url: oferta.url, precio: oferta.precioActual,
          descuento: Math.round(evaluacion.descuento * 100), tipo: evaluacion.tipo, veredicto: puntaje.veredicto,
          precioMercado: puntaje.precioMercado ?? null, fuenteMercado: puntaje.fuente ?? null, via: puntaje.via ?? null,
          margen: puntaje.margen === undefined ? null : Math.round(puntaje.margen * 100), demanda: puntaje.demanda ?? null,
          ...(ref ? { usd: ref.usd ?? null, pesosUsd: ref.pesos ?? null, viaUsd: ref.via ?? null } : {}),
          ...(g.ebay?.estado === 'ok' ? { usd: g.ebay.usd, publicacionesEbay: g.ebay.n } : {}),
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
    // Mensajes realmente usados del tope de la corrida (en simulación, los que se habrían mandado) y si se llegó al límite.
    mensajesUsados: dryRun ? mensajes.length : enviadosAqui, limiteEnvio,
    reventa: { buenas: cuenta('buena'), regulares: cuenta('regular'), sinReferencia: cuenta('sin-referencia'), evitadas },
    internacional: referencias ? internacional : null,
    ebay: ebay ? {
      conPrecio: gangas.filter((g) => g.ebay?.estado === 'ok').length,
      sinPrecio: gangas.filter((g) => g.ebay?.estado === 'sin').length,
      pendientes: gangas.filter((g) => g.ebay?.estado === 'pendiente').length,
    } : null,
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
