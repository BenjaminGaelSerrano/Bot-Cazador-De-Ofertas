// Umbrales y topes del bot. Los valores salen de la constitución (§4, §5) y de la spec 001.
export const config = {
  userAgent: 'cazador-ofertas/0.1 (bot personal de lectura)',
  pausaMs: 1000,

  // Regla de ganga
  descuentoMinimo: 0.30,     // 30 % bajo el mínimo previo (o bajo el precio de lista si no hay historial)
  descuentoAdicional: 0.10,  // para volver a avisar: otro 10 % bajo el precio ya avisado
  diasHistorial: 30,

  // Mensajes de WhatsApp (CallMeBot no publica un tope, así que se pone uno propio)
  maxOfertasPorMensaje: 8,
  maxMensajesPorCorrida: 3,
  maxCaracteres: 1500,

  fuentes: {
    juleriaque: {
      base: 'https://www.juleriaque.com.ar',
      maxPorPedido: 50,   // la API rechaza _to > 50
      maxOffset: 2500,    // la API rechaza _from > 2500
      categoriasExcluidas: ['Testers', 'Exhibidores', 'Packaging', 'In Store Merchandising', 'Servicios', 'Gift Cards'],
    },
  },
};
