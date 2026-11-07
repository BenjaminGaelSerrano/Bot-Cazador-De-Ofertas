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
  formatoMensaje: 'tarjetas',         // 'tarjetas' (2026-11-06, como en el chat) | 'tabla' | 'detalle' (varias líneas)
  // `pausados`: true corta los avisos de ofertas; el bot sigue leyendo y guardando precios, las fallas se siguen avisando
  // y lo no avisado no se marca (sale al reanudar). Se pausó el 2026-11-02 porque el precio de mercado entre tiendas
  // argentinas está inflado 2 a 3 veces respecto de EE. UU.; el usuario pidió reactivarlos mientras se conecta eBay.
  avisar: {
    veredictos: ['buena'], // se puede sumar 'regular' y 'sin-referencia'
    pausados: false,
    // Filtro del usuario (2026-11-05: compra para él; "solo márgenes grandes, solo modelos que se venden mucho, solo marcas
    // o modelos que elija"). Margen contra eBay (precio justo), ventas en eBay del mismo producto y lista de términos
    // (marca o modelo, en el nombre). Lista vacía = todas las marcas.
    margenMinimo: 0.05, // 30 % el 2026-11-06; el usuario lo bajó a 5 % el 2026-11-07
    ventasMinimas: 10,
    soloTerminos: [],
    // Nada de mujer (2026-11-06: "todo lo que es de mujer no me va a interesar nunca"): por categoría o nombre.
    excluirMujer: true,
  },
  tabla: { monoespaciado: true },     // false: filas separadas por barras y sin alinear (si WhatsApp no respeta el ancho fijo)
  // Las marcas de "ya avisado" anteriores a esta fecha se ignoran (una sola vez): las primeras corridas silenciaron como
  // línea base muchas ofertas buenas que nunca llegaron al WhatsApp. Poner null para no reiniciar.
  reiniciarAlertasAntesDe: '2026-10-23',

  // Fuentes que no se leen en las corridas programadas. Parfumerie bloquea al bot desde el 2026-10-23 (cada corrida
  // terminaba en rojo); se pausó a pedido del usuario el 2026-11-02. Para probar si volvió: --fuente parfumerie --dry-run.
  fuentesPausadas: ['parfumerie', 'simplicity'], // simplicity: el usuario prefirió Pigmento (2026-11-05)

  // De las perfumerías se avisan solo perfumes: ni maquillaje, ni cremas, ni tratamientos (pedido del usuario, 2026-11-03).
  soloPerfumes: ['juleriaque', 'rouge', 'pigmento', 'beauty24', 'simplicity', 'parfumerie'],

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

    // Dash (multimarca deportiva, Abasto y otros shoppings): VTEX igual que Grid (pedido del usuario, 2026-11-05). 3.314
    // productos: no caben en una consulta, se lee por raíz. Trae el código de estilo en la descripción, color y talles.
    dash: {
      base: 'https://www.dashdeportes.com.ar',
      maxPorPedido: 50,
      maxOffset: 2500,
      agrupar: 'producto',
      categoriasExcluidas: [],
      categorias: [
        { name: 'Calzado', ruta: '/1/' },
        { name: 'Indumentaria', ruta: '/6/' },
        { name: 'Accesorios', ruta: '/9/' },
      ],
      toleranciaCobertura: 1, // los combos (raíz 37) no se leen
    },

    // Sporting (multimarca deportiva): VTEX (2026-11-05). El código de estilo viene en la referencia del producto
    // ("HJ8485001-000" = Nike HJ8485-001). Calzado, indumentaria y accesorios; bicicletas y componentes no.
    sporting: {
      base: 'https://www.sporting.com.ar',
      maxPorPedido: 50,
      maxOffset: 2500,
      agrupar: 'producto',
      codigoDe: 'referencia',
      categoriasExcluidas: [],
      categorias: [
        { name: 'Calzado', ruta: '/106/107/' },
        { name: 'Indumentaria', ruta: '/106/108/' },
        { name: 'Accesorios', ruta: '/106/109/' },
      ],
      toleranciaCobertura: 1,
    },

    // Beauty 24 (perfumería de shoppings, Abasto): VTEX (2026-11-05). Solo perfumes de mujer, hombre y unisex: 1.614 en
    // la raíz de perfumes, marcas de diseñador. Algunos códigos de barras traen una letra al final (se limpia).
    beauty24: {
      base: 'https://www.beauty24.com.ar',
      maxPorPedido: 50,
      maxOffset: 2500,
      agrupar: 'sku',
      categoriasExcluidas: [],
      categorias: [
        { name: 'Perfumes de hombre', ruta: '/100/102/' },
        { name: 'Perfumes unisex', ruta: '/100/103/' },
      ],
      toleranciaCobertura: 1,
    },

    // Simplicity (perfumería de shoppings, grupo Farmacity): VTEX. Reemplaza a Parfumerie, que bloquea (pedido del
    // usuario, 2026-11-05). Solo la categoría Fragancias (id 14): 2.460 productos, todos con código de barras, la mitad
    // con descuento. Se lee solo esa raíz, así que el resto del sitio (maquillaje, piel) no cuenta como "sin cubrir".
    simplicity: {
      base: 'https://www.simplicity.com.ar',
      maxPorPedido: 50,
      maxOffset: 2500,
      agrupar: 'sku',
      categoriasExcluidas: [],
      categorias: [{ name: 'Fragancias', ruta: '/14/' }],
      toleranciaCobertura: 1,
    },

    // Pigmento (perfumería de shoppings): VTEX. Pedida por el usuario el 2026-11-05 en lugar de Simplicity. Solo la
    // categoría Perfume (id 1): 866 productos, casi todos con código de barras, marcas de diseñador. Se lee solo esa raíz.
    pigmento: {
      base: 'https://www.perfumeriaspigmento.com.ar',
      maxPorPedido: 50,
      maxOffset: 2500,
      agrupar: 'sku',
      categoriasExcluidas: [],
      categorias: [{ name: 'Perfume', ruta: '/1/' }],
      toleranciaCobertura: 1,
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
      ],
      porPagina: 48,
      maxPaginas: 40,
    },

    // Dexter (multimarca en shoppings): mismo SFCC que Moov. En octubre compartían catálogo; el 2026-11-05 solo 8 de los
    // primeros 96 productos de Dexter estaban en Moov (con el mismo precio), así que se lee aparte (pedido del usuario).
    // El id trae el código de modelo y color (NIFJ9509-402) y la página de producto, talles ("42-42.5") y color.
    dexter: {
      base: 'https://www.dexter.com.ar',
      sitio: 'Sites-Dexter-Site',
      categorias: [
        { cgid: 'hombre-calzado', genero: 'h' },
      ],
      porPagina: 48,
      maxPaginas: 60, // 40 x 48 = 1.920 se quedaba corto en hombre-calzado (2026-11-06)
    },

    // Stock Center (calzado, tipo outlet): mismo SFCC que Moov y Dexter (2026-11-05).
    stockcenter: {
      base: 'https://www.stockcenter.com.ar',
      sitio: 'Sites-StockCenter-Site',
      categorias: [
        { cgid: 'hombre-calzado', genero: 'h' },
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
  // Caché en referencias/ebay-v2.json: el cálculo cambió el 2026-11-03 (cuartil inferior, sin envío, sin packs).
  ebay: {
    activo: true,
    // Ropa y calzado sin código de estilo: no se buscan por nombre (mezclaba colores). El usuario eligió "solo color
    // exacto" el 2026-11-05: se compara solo con el mismo código (modelo + color).
    buscarPorNombre: false,
    vigenciaDias: 3,            // un precio de eBay se reutiliza 3 días (después se vuelve a consultar)
    maxConsultasPorCorrida: 4950, // tope de seguridad; el reparto real lo hace `ajustarCupo` con el cupo que queda
    concurrencia: 4,             // consultas en paralelo
    limite: 50,                  // publicaciones por consulta
    minPublicaciones: 5,         // con menos, un par de publicaciones caras mueven todo (Air Rift: 4, de US$59 a 130)
    // Precio de mercado = cuartil inferior (25 %) de las publicaciones válidas, SIN envío (2026-11-03): son precios pedidos,
    // no vendidos, y la mediana quedaba por encima de lo que se paga; las 5 más baratas quedaban en el piso.
    percentil: 0.25,
    conEnvio: false,
    // Zapatillas y ropa (búsqueda por código de modelo o por nombre): se exigen VENTAS, no publicaciones (pedido del
    // usuario, 2026-11-03). Se leen las fichas de las primeras `fichas` publicaciones (orden de eBay, que favorece las
    // que venden), se suman las unidades vendidas y el precio es la mediana de lo vendido, ponderada por unidades.
    // Tope (aprobado por el usuario, 2026-11-05): el precio es el MENOR entre la mediana de lo vendido y la mediana de lo
    // publicado (`topePublicado`): una publicación cara con ventas viejas inflaba el precio (Blazer '77: US$193 vs. 40-83).
    // Si la oferta ya cuesta ese tope o más, no se gastan fichas (no puede ser más barata).
    // `vigenciaFichasDias`: las unidades vendidas de cada publicación se reutilizan una semana (cuestan 1 consulta cada una).
    ventas: { activo: true, minVentas: 3, fichas: 8, topePublicado: 0.5, vigenciaFichasDias: 7 },
    // Cupo diario compartido (2026-11-03: unas corridas manuales gastaron las 5.000 del día y la de la noche quedó sin
    // nada). Al arrancar se lee lo que queda y se reparte en partes iguales entre esta corrida y las programadas que
    // faltan antes de que se renueve (08:00 UTC). TIENE QUE COINCIDIR con los cron de .github/workflows/cazador.yml.
    corridasUtc: ['22:43', '00:43', '02:43', '04:43', '06:43', '08:43', '10:43', '12:43', '14:43', '16:43', '18:43', '20:43'],
    cupoDiario: 5000,
    margenCupo: 50,
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
