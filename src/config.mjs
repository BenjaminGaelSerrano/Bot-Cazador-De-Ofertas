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
  // Cuántos mensajes por corrida: lo más posible hasta que CallMeBot corte (pedido del usuario, 2026-10-22). El bot
  // manda en orden de importancia (buenas primero) y frena en el primer rechazo, sin perder nada: lo que no salió queda
  // en cola. CallMeBot no publica su límite, así que se descubre en la práctica; si llegan menos mensajes de los que
  // el bot dice haber enviado, bajar estos números.
  maxMensajesPorCorrida: 8,        // por tienda
  // El tope es sobre el largo EFECTIVO: caracteres + saltos de línea + bytes extra de los acentos. Medido el
  // 2026-10-22: lo que corta CallMeBot ronda los 760 a 768 contando así. La codificación de la URL no es el límite
  // (un mensaje de 768 caracteres con URL de 1.658 llegó bien), por eso esos topes quedan holgados.
  maxCaracteres: 700,
  maxCaracteresDuro: 740,      // por encima de esto no se envía: mejor un error visible que un mensaje cortado
  maxCodificados: 1500,
  maxCodificadosDuro: 1700,
  pausaMensajesMs: 3000,       // espera entre dos WhatsApp seguidos (más holgada ahora que se mandan muchos)
  simboloMoneda: '$',

  // Qué se avisa y cómo se ve (pedido del usuario, 2026-10-23): solo lo que realmente vale la pena, en formato de tabla,
  // porque el mensaje de varias líneas por oferta era ineficiente. Lo que no se avisa no se marca como avisado: se
  // reevalúa en cada corrida y sale si más adelante pasa a valer la pena (ej. cuando otra tienda lo respalda).
  formatoMensaje: 'tabla',            // 'tabla' | 'detalle' (el formato anterior, de varias líneas por oferta)
  // `pausados`: true corta los avisos de ofertas; el bot sigue leyendo y guardando precios, las fallas se siguen avisando
  // y lo no avisado no se marca (sale al reanudar). Se pausó el 2026-11-02 porque el precio de mercado entre tiendas
  // argentinas está inflado 2 a 3 veces respecto de EE. UU.; el usuario pidió reactivarlos mientras se conecta eBay.
  avisar: { veredictos: ['buena'], pausados: false },  // se puede sumar 'regular' y 'sin-referencia'
  tabla: { monoespaciado: true },     // false: filas separadas por barras y sin alinear (si WhatsApp no respeta el ancho fijo)
  // Las marcas de "ya avisado" anteriores a esta fecha se ignoran (una sola vez): las primeras corridas silenciaron como
  // línea base muchas ofertas buenas que nunca llegaron al WhatsApp. Poner null para no reiniciar.
  reiniciarAlertasAntesDe: '2026-10-23',

  // Fuentes que no se leen en las corridas programadas. Parfumerie bloquea al bot desde el 2026-10-23 (cada corrida
  // terminaba en rojo); se pausó a pedido del usuario el 2026-11-02. Para probar si volvió: --fuente parfumerie --dry-run.
  fuentesPausadas: ['parfumerie'],

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

    // Moov (calzado). Salesforce Commerce Cloud: la grilla Search-UpdateGrid devuelve 48 productos por página. Es la
    // competidora de Grid (Nike, Adidas, New Balance, Puma...). Dexter comparte su catálogo (365-dabra), así que no se
    // lee aparte. Solo calzado en esta versión: hombre ~530 a 960 productos, mujer similar (relevado el 2026-10-22).
    moov: {
      base: 'https://www.moov.com.ar',
      sitio: 'Sites-Moov-Site',
      categorias: [
        { cgid: 'hombre-calzado', genero: 'h' },
        { cgid: 'mujer-calzado', genero: 'm' },
      ],
      porPagina: 48,
      maxPaginas: 40,
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
  maxMensajesTotalPorCorrida: 40, // entre todas las tiendas; el bot frena antes si CallMeBot rechaza uno
  // Tope por DÍA (hora de Argentina). CallMeBot dejó de entregar en silencio tras ~30 mensajes el 2026-11-02 (seguía
  // respondiendo 200). Lo que no entra queda sin marcar y sale al día siguiente.
  maxMensajesPorDia: 25,

  // Telegram (canal preferido si hay TELEGRAM_BOT_TOKEN): el chat del usuario no es secreto (sin el token no sirve).
  telegram: { chatId: 7228408134 },
  // Con Telegram activo, cada aviso sale también por WhatsApp (pedido del usuario, 2026-11-02), hasta el tope diario.
  notificar: { copiaWhatsapp: true }, // cuenta del usuario (confirmado el 2026-11-02)

  // Primera corrida de una fuente: se avisan solo las N mejores; el resto queda como línea base.
  primeraCorridaMaxOfertas: 8,

  // Reventa (spec 003). Parámetros dados por el usuario el 2026-10-22: revende por Instagram (sin comisión),
  // el envío no cuenta y busca un margen de 40 %. Regular y descuento competitivo son propuestas a ajustar.
  // Criterio del usuario (2026-11-02): con el precio de mercado de EE. UU., vale la pena todo lo que esté MÁS BARATO que
  // ese precio, sin importar cuánto ni la demanda (antes: 40 % de margen revendiendo 5 % bajo el mercado, y la demanda
  // baja pasaba a "regular").
  reventa: {
    comision: 0,
    envio: 0,
    margenBueno: 0.0001,        // cualquier margen positivo: el costo es menor al precio de EE. UU.
    margenRegular: 0,
    descuentoCompetitivo: 0,    // el margen se mide contra el precio de mercado tal cual
    exigirDemanda: false,       // true: con demanda baja, una "buena" pasa a "regular"
    vigenciaDias: 3,            // un precio de otra tienda vale si se lo vio en los últimos 3 días
    precioAjenoMinimo: 0.25,    // un precio ajeno menor a un cuarto del propio se descarta (otro formato del producto)
    ventanaVelocidadDias: 7,
    minDiasVelocidad: 2,
    stockRelleno: 1000,         // cantidades de este valor o más son marcadores (ej. 99999), no stock real
    demandaAltaPorDia: 1,
    demandaMediaPorDia: 0.3,
  },

  // Precio de mercado en eBay EE. UU. (spec 007, pedido del usuario del 2026-11-02): reemplaza al cruce entre tiendas
  // argentinas y a Perfumania. Se activa solo si están EBAY_CLIENT_ID y EBAY_CLIENT_SECRET; si no, sigue el cruce local.
  ebay: {
    activo: true,
    vigenciaDias: 3,             // un precio de eBay se reutiliza 3 días (después se vuelve a consultar)
    maxConsultasPorCorrida: 1500, // eBay permite ~5.000 por día a la Browse API; el bot corre 2 veces por día
    concurrencia: 4,             // consultas en paralelo
    limite: 50,                  // publicaciones por consulta
    minPublicaciones: 3,         // con menos, no hay precio de mercado confiable
    // Precio de mercado = mediana de TODAS las publicaciones válidas (con envío). Con las 5 más baratas quedaba en el piso:
    // 2026-11-03, One Million EDT 100 ml US$51 (5 más baratas) contra US$79 (mediana); Air Force 1 '07 US$80 contra 100.
    tomarMasBaratas: 1000,
  },

  // Provisorio hasta que eBay apruebe la cuenta: UPCitemdb (sin cuenta, 100 consultas por día, solo con código de
  // barras). Se usa si no hay credenciales de eBay. Medido el 2026-11-02 con One Million EDT 100 ml: 49 ofertas, la
  // mayoría de 2015 a 2023; en dólares y de los últimos 90 días, 4 (Target 60,99, UnbeatableSale 87,31, Kohl's y
  // Bloomingdale's 126): la mediana de las 3 más baratas da 87,31.
  upcitemdb: {
    activo: true,
    vigenciaDias: 7,            // el precio de un código de barras se reutiliza una semana
    diasOferta: 120,            // solo ofertas actualizadas en los últimos 4 meses
    tomarMasBaratas: 3,
    maxConsultasPorCorrida: 45, // 2 corridas por día, dentro de las 100 gratuitas
    maxConsultasPorFuente: 5,   // el cupo real ronda las 14 por IP y día: partes chicas para que llegue a todas
    // Por nombre (Grid) UPCitemdb nunca devolvió precios recientes (6 de 6 sin datos el 2026-11-02): no se gasta cupo.
    // Con eBay sí se busca por nombre.
    buscarPorNombre: false,
    pausaMs: 11000,             // ~5 por minuto
  },

  // Referencia internacional (spec 006, decisión del usuario del 2026-11-02): filtro de ganga, dólares × blue medio,
  // sin ajuste por impuestos ni importación. Perfumania limita MUY fuerte: el 2026-11-02 respondió 429 después de 2 o 3
  // pedidos (aun con 8 s entre ellos) y el bloqueo duró ~25 minutos. Por eso: pocos pedidos por corrida, pausa larga,
  // caché de dos semanas, y lo que no se llegó a consultar se avisa igual con "*" (si no, los perfumes dejarían de
  // avisarse). Con el tiempo el caché cubre los perfumes que más aparecen en oferta.
  internacional: {
    activa: true,
    dolarUrl: 'https://dolarapi.com/v1/dolares/blue',
    vigenciaDias: 14,          // lo encontrado (o no encontrado) en Perfumania se reutiliza dos semanas
    avisarSinConsultar: true,  // true: lo que no se pudo consultar sale con "*"; false: espera a la próxima corrida
    perfumania: {
      base: 'https://perfumania.com',
      pausaMs: 30000,
      maxPedidosPorCorrida: 6,
      resultadosBusqueda: 3, // fichas que se miran por oferta, de las sugeridas por la búsqueda
      toleranciaMl: 0.04,    // 3.4 oz = 100,5 ml; 3 oz = 88,7 ml (frasco de 90 ml)
    },
  },
};
