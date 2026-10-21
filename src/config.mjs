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
  pausaMensajesMs: 2000,     // espera entre dos WhatsApp seguidos

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
};
