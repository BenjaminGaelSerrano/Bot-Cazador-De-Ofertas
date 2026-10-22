// Umbrales y topes del bot. Los valores salen de la constitución (§4, §5) y de la spec 001.
export const config = {
  userAgent: 'cazador-ofertas/0.1 (bot personal de lectura)',
  pausaMs: 1000,
  esperasReintentoMs: [3000, 10000], // ante un 5xx o un corte de red: 2 reintentos, esperando 3 s y luego 10 s
  timeoutPedidoMs: 30000,

  // Regla de ganga
  descuentoMinimo: 0.30,     // 30 % bajo el mínimo previo (o bajo el precio de lista si no hay historial)
  descuentoAdicional: 0.10,  // para volver a avisar: otro 10 % bajo el precio ya avisado
  diasHistorial: 30,

  // Mensajes de WhatsApp (CallMeBot no publica un tope, así que se pone uno propio)
  // CallMeBot corta en silencio los mensajes largos: el 2026-10-22 dos mensajes se cortaron en ~750 caracteres
  // crudos / ~990 codificados en la URL, y las ofertas cortadas se perdieron. Se deja ~12 % de margen.
  maxOfertasPorMensaje: 8,
  maxMensajesPorCorrida: 3,
  // El tope es sobre el largo EFECTIVO: caracteres + saltos de línea + bytes extra de los acentos. Medido el
  // 2026-10-22: lo que corta CallMeBot ronda los 760 a 768 contando así. La codificación de la URL no es el límite
  // (un mensaje de 768 caracteres con URL de 1.658 llegó bien), por eso esos topes quedan holgados.
  maxCaracteres: 700,
  maxCaracteresDuro: 740,      // por encima de esto no se envía: mejor un error visible que un mensaje cortado
  maxCodificados: 1500,
  maxCodificadosDuro: 1700,
  pausaMensajesMs: 2000,       // espera entre dos WhatsApp seguidos
  simboloMoneda: '$',

  fuentes: {
    juleriaque: {
      base: 'https://www.juleriaque.com.ar',
      maxPorPedido: 50,   // la API rechaza _to > 50
      maxOffset: 2500,    // la API rechaza _from > 2500
      categoriasExcluidas: ['Testers', 'Exhibidores', 'Packaging', 'In Store Merchandising', 'Servicios', 'Gift Cards'],
      // Copia del árbol de categorías (relevada el 2026-10-20 desde los datos de los productos). No se pide
      // al sitio: /category/tree y /brand/list responden 429 a los bots. `ruta` es la que usa el filtro
      // fq=C:<ruta>. Solo se subdivide lo que supera los 2.550 productos que deja leer la API.
      // Si aparecen productos fuera de estas categorías, el informe lo avisa (campo sinCubrir).
      categorias: [
        {
          name: 'Fragancias', ruta: '/100000001/', children: [
            { name: 'Low Cost', ruta: '/100000001/100000175/' },
            {
              name: 'Premium', ruta: '/100000001/100000002/', children: [
                { name: 'Femeninas', ruta: '/100000001/100000002/100000003/' },
                { name: 'Masculinas', ruta: '/100000001/100000002/100000046/' },
                { name: 'Unisex', ruta: '/100000001/100000002/100000089/' },
              ],
            },
          ],
        },
        { name: 'Tratamiento', ruta: '/110000001/' },
        { name: 'Maquillaje', ruta: '/120000001/' },
        { name: 'Electro Beauty', ruta: '/130000001/' },
        { name: 'Capilar', ruta: '/140000001/' },
        { name: 'Relojería y Joyería', ruta: '/150000001/' },
        { name: 'Indumentaria', ruta: '/170000001/' },
        { name: 'Deco & Home', ruta: '/180000001/' },
        { name: 'Regalos', ruta: '/190000001/' },
      ],
      toleranciaCobertura: 0.01, // se avisa si una subdivisión deja fuera más del 1 % de sus productos
    },

    // Grid (Nike, Jordan, NBA). 2.140 productos el 2026-10-20: caben en una consulta, se lee sin filtro.
    // Los SKU son talles con el mismo precio, así que se avisa por producto.
    grid: {
      base: 'https://www.grid.com.ar',
      maxPorPedido: 50,
      maxOffset: 2500,
      agrupar: 'producto',
      categoriasExcluidas: [],
      categorias: [{ name: 'Catálogo completo', ruta: null }],
      toleranciaCobertura: 0.01,
    },

    // Rouge (perfumería). 4.836 productos el 2026-10-20. Cada SKU es un tamaño con su propio precio.
    // Árbol relevado desde los datos de los productos; 10 productos (0,2 %) quedan fuera de las raíces
    // conocidas. La categoría `giftcards` (9 productos) no se lee.
    rouge: {
      base: 'https://www.perfumeriasrouge.com',
      maxPorPedido: 50,
      maxOffset: 2500,
      agrupar: 'sku',
      categoriasExcluidas: ['giftcards'],
      categorias: [
        { name: 'Perfumes y fragancias', ruta: '/100/' },
        { name: 'Maquillaje', ruta: '/105/' },
        { name: 'Tratamientos', ruta: '/132/' },
        { name: 'Capilares', ruta: '/169/' },
      ],
      toleranciaCobertura: 0.01,
    },

    // Parfumerie (perfumería). Magento 2 por GraphQL (POST): 6.357 productos el 2026-10-22. La lista liviana se lee en
    // cada corrida; el código de barras y la marca (atributos pesados) se piden una vez por producto y se guardan.
    parfumerie: {
      base: 'https://www.parfumerie.com.ar',
      categoriaId: '2',            // categoría raíz: incluye todo el catálogo
      porPagina: 100,
      maxPaginas: 200,
      maxProductosAtributos: 1500, // atributos a pedir por corrida; el enriquecimiento completo toma unas 5 corridas
      loteAtributos: 25,
    },

    // New Era (gorras). Shopify: 924 productos el 2026-10-20 en 4 páginas de 250.
    newera: {
      base: 'https://www.newera.com.ar',
      porPagina: 250,
      maxPaginas: 40,
      categoriasExcluidas: ['Gift Card', 'Tarjeta de regalo'],
    },
  },

  // Tope de WhatsApp por corrida entre todas las fuentes juntas.
  maxMensajesTotalPorCorrida: 5,

  // Primera corrida de una fuente: se avisan solo las N mejores; el resto queda como línea base.
  primeraCorridaMaxOfertas: 8,

  // Reventa (spec 003). Parámetros dados por el usuario el 2026-10-22: revende por Instagram (sin comisión),
  // el envío no cuenta y busca un margen de 40 %. Regular y descuento competitivo son propuestas a ajustar.
  reventa: {
    comision: 0,
    envio: 0,
    margenBueno: 0.40,
    margenRegular: 0.20,
    descuentoCompetitivo: 0.05, // se revende un 5 % por debajo del menor precio de otra tienda
    vigenciaDias: 3,            // un precio de otra tienda vale si se lo vio en los últimos 3 días
    precioAjenoMinimo: 0.25,    // un precio ajeno menor a un cuarto del propio se descarta (otro formato del producto)
    ventanaVelocidadDias: 7,
    minDiasVelocidad: 2,
    stockRelleno: 1000,         // cantidades de este valor o más son marcadores (ej. 99999), no stock real
    demandaAltaPorDia: 1,
    demandaMediaPorDia: 0.3,
  },
};
