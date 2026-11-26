// Umbrales y topes del bot. Los valores salen de la constitución (§4, §5) y de la spec 001.
export const config = {
  userAgent: 'cazador-ofertas/0.1 (bot personal de lectura)',
  pausaMs: 1000,
  esperasReintentoMs: [3000, 10000], // ante un 5xx o un corte de red: 2 reintentos, esperando 3 s y luego 10 s
  timeoutPedidoMs: 30000,

  // Regla de ganga
  descuentoMinimo: 0.10,     // 10 % (el usuario lo bajó desde 30 % el 2026-11-09) bajo el mínimo previo (o bajo el precio de lista si no hay historial)
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
    ventasMinimas: 5, // 10 hasta el 2026-11-15; el usuario lo bajó a 5 para que lleguen más zapatillas
    soloTerminos: [],
    // Nada de mujer (2026-11-06: "todo lo que es de mujer no me va a interesar nunca"): por categoría o nombre.
    excluirMujer: false, // true hasta el 2026-11-18; el usuario pidió sacar el filtro de solo hombre
    // Cada corrida manda TODO lo que sigue vigente (pasa el filtro, hay stock), aunque ya se haya avisado y no haya nada
    // nuevo (pedido del usuario, 2026-11-12). Lo que no se había avisado antes lleva 🆕. false = solo lo nuevo.
    repetirVigentes: true,
    // Precio oficial en Argentina (ARS) de productos que la propia marca vende al mismo precio que el revendedor: eso no es
    // una oferta, es el precio normal. Si la oferta cuesta lo mismo o más (con 3 % de margen), no se avisa. Clave = clave de
    // búsqueda ("cod:" + código de modelo). Se completa a mano con una fuente de respaldo (la tienda oficial). Caso: camiseta
    // de México JL8546, $154.999 en Sporting y también en adidas.com.ar (verificado el 2026-11-24).
    precioOficialLocal: {
      'cod:JL8546': 154999,
    },
    // Perfil del usuario (2026-11-18): "en perfumerías, nacionales y de diseñador; en calzado, las marcas que más se llevan;
    // y en ropa y calzado, prendas visualmente atractivas y no tanto de rendimiento deportivo". Se aplica ANTES de consultar
    // eBay (no gasta cupo). Las listas son palabras enteras de la marca o del nombre; sin lista = sin filtro.
    perfil: {
      perfumes: {
        disenador: [
          'carolina herrera', 'rabanne', 'dior', 'chanel', 'yves saint laurent', 'ysl', 'armani', 'versace', 'dolce gabbana',
          'calvin klein', 'hugo boss', 'boss', 'jean paul gaultier', 'gaultier', 'givenchy', 'lancome', 'burberry', 'bvlgari',
          'tommy hilfiger', 'ralph lauren', 'azzaro', 'montblanc', 'prada', 'valentino', 'mugler', 'viktor rolf',
          'issey miyake', 'narciso rodriguez', 'hermes', 'gucci', 'tom ford', 'jimmy choo', 'nina ricci', 'davidoff',
          'cacharel', 'lacoste', 'diesel', 'moschino', 'kenzo', 'antonio banderas', 'escada', 'elie saab', 'cartier',
          'chloe', 'marc jacobs', 'michael kors', 'paco rabanne', 'bentley', 'dunhill', 'joop', 'rochas', 'loewe', 'benetton',
          'banderas', 'adolfo dominguez', 'guerlain', 'dsquared', 'tory burch', 'ferragamo', 'zadig voltaire', 'nautica',
          'halloween', 'bensimon', 'ted lapidus', 'salvador dali',
          // A pedido del usuario (2026-11-18) entran también estas, aunque no sean de diseñador clásico:
          'mercedes benz', 'adidas', 'shakira', 'kylie jenner', 'david beckham',
        ],
        nacionales: [
          'cher', 'ciel', 'caro cuore', 'paula cahen', 'rapsodia', 'jazmin chebar', 'tucci', 'kevingston', 'complot',
          'mimo', 'wanama', 'sweet', 'vitamina', 'ona saez', 'cuesta blanca', 'prune', 'maria cher', 'lorena',
        ],
      },
      // Calzado: solo estas marcas (Nike, Jordan, Adidas, Puma, New Balance, Converse, Vans, Asics y Salomon).
      calzadoMarcas: ['nike', 'jordan', 'adidas', 'puma', 'new balance', 'converse', 'vans', 'asics', 'salomon'],
      // Calzado y ropa: afuera lo claramente de rendimiento deportivo.
      excluirRendimiento: true,
      // Marcas y modelos que se usan como estilo aunque sean técnicos: no se les aplica el descarte de rendimiento (Salomon:
      // Speedcross, XT-6, etc. figuran como trekking).
      sinFiltroRendimiento: [
        'salomon', 'new balance',
        // Líneas de running que se usan como estilo (2026-11-18, el usuario: "algunas son de rendimiento pero se usan también para estilo"):
        'vomero', 'pegasus', 'adizero evo', 'response cl', 'velocity nitro',
        'gel kayano', 'gel 1130', 'gel nyc', 'gt 2160', 'gel nimbus',
      ],
    },
  },
  tabla: { monoespaciado: true },     // false: filas separadas por barras y sin alinear (si WhatsApp no respeta el ancho fijo)
  // Las marcas de "ya avisado" anteriores a esta fecha se ignoran (una sola vez): las primeras corridas silenciaron como
  // línea base muchas ofertas buenas que nunca llegaron al WhatsApp. Poner null para no reiniciar.
  reiniciarAlertasAntesDe: '2026-10-23',

  // Fuentes que no se leen en las corridas programadas. Parfumerie bloquea al bot desde el 2026-10-23 (cada corrida
  // terminaba en rojo); se pausó a pedido del usuario el 2026-11-02. Para probar si volvió: --fuente parfumerie --dry-run.
  fuentesPausadas: ['newera'], // New Era: el usuario pidió sacarla (2026-11-18).
  // Fuentes que pueden fallar sin poner roja la corrida: Parfumerie bloquea al bot desde el 2026-10-23 (403). Se intenta en
  // cada corrida y vuelve sola cuando deje de bloquear (el usuario la pidió de nuevo el 2026-11-17).
  fuentesOpcionales: ['parfumerie'],

  // De las perfumerías se avisan solo perfumes: ni maquillaje, ni cremas, ni tratamientos (pedido del usuario, 2026-11-03).
  soloPerfumes: ['juleriaque', 'rouge', 'pigmento', 'beauty24', 'parfumerie'],

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
        { name: 'Perfumes de mujer', ruta: '/100/101/' }, // vuelve el 2026-11-18 (el usuario sacó el filtro de solo hombre)
        { name: 'Perfumes de hombre', ruta: '/100/102/' },
        { name: 'Perfumes unisex', ruta: '/100/103/' },
      ],
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
        { cgid: 'mujer-calzado', genero: 'm' },
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
        { cgid: 'mujer-calzado', genero: 'm' },
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

  // Locales propios (spec 009, 2026-11-26): marcas sin referencia en eBay. Ver specs/009-locales-propios/spec.md.
  locales: {
    // Precio máximo en pesos por tipo de prenda ("algo que consideres normal pagar", aprobado por el usuario): ajustarlos
    // acá si la inflación los deja viejos o si llega demasiado o muy poco.
    topes: {
      // Bajados ~10 % el 2026-11-26 ("si es un poquito más bajo mejor").
      remera: 27000, musculosa: 20000, chomba: 40000, camisa: 50000, buzo: 58000, sweater: 63000, jean: 63000,
      pantalon: 58000, jogging: 50000, short: 32000, campera: 108000, saco: 108000, chaleco: 63000, calzado: 90000, gorra: 18000,
    },
    talles: { ropa: ['l', 'xl'], calzado: [44.5, 46], cintura: [42, 44], pulgadas: [32, 34] }, // pantalón 42-44
    descuentoMinimo: 0.40,  // declarado por la tienda
    percentilTienda: 0.75,  // y entre el 25 % de descuentos más fuertes de esa tienda
    diasHistorial: 14,      // con este historial, además:
    bajaMinima: 0.20,       // bajar 20 % o más contra el precio habitual
    maximoPorTienda: 3,
    tiendas: {
      lamartina: { nombre: 'La Martina', tipo: 'vtex', base: 'https://www.lamartina.com.ar' },
      keybiscayne: { nombre: 'Key Biscayne', tipo: 'vtex', base: 'https://www.keybiscayne.com.ar' },
      tommy: { nombre: 'Tommy Hilfiger', tipo: 'vtex', base: 'https://ar.tommy.com' },
      decathlon: { nombre: 'Decathlon', tipo: 'shopify', base: 'https://www.decathlon.com.ar' },
      freres: { nombre: 'Frères', tipo: 'shopify', base: 'https://www.freres.ar' },
    },
  },

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
    // Solo ROPA sin código (2026-11-24, pedido del usuario): se busca por marca + modelo + tipo de prenda. Calzado no: el
    // color importa. La referencia se marca como aproximada en el aviso.
    buscarPorNombreRopa: false, // APAGADO el 2026-11-24: por nombre mezcla diseños, jugadores y colores (Mitchell & Ness +273 %); el usuario vio referencias mal
    vigenciaDias: 7,            // un precio de eBay se reutiliza 7 días (3 hasta el 2026-11-18: con más ofertas el cupo no alcanzaba)
    maxConsultasPorCorrida: 4950, // tope de seguridad; el reparto real lo hace `ajustarCupo` con el cupo que queda
    concurrencia: 4,             // consultas en paralelo
    limite: 50,                  // publicaciones por consulta
    minPublicaciones: 5,         // con menos, un par de publicaciones caras mueven todo (Air Rift: 4, de US$59 a 130)
    // Precio de mercado = cuartil inferior (25 %) de las publicaciones válidas, SIN envío (2026-11-03): son precios pedidos,
    // no vendidos, y la mediana quedaba por encima de lo que se paga; las 5 más baratas quedaban en el piso.
    percentil: 0.25,
    conEnvio: false,
    // Precio oficial de venta en EE. UU. (USD) de productos con reventa inflada (lanzamientos, Mundial). Si es menor que lo
    // que piden en eBay, la referencia es este. Clave = clave de búsqueda ("cod:" + código de modelo). A pedido del usuario
    // (2026-11-17: "el precio de referencia de la camiseta de México está mal"). Se agregan a mano.
    retailOficial: {
      'cod:JL8546': 150, // adidas México 2026, tercera camiseta Authentic (adidas.com EE. UU.: US$150)
    },
    // Zapatillas y ropa (búsqueda por código de modelo o por nombre): se exigen VENTAS, no publicaciones (pedido del
    // usuario, 2026-11-03). Se leen las fichas de las primeras `fichas` publicaciones (orden de eBay, que favorece las
    // que venden), se suman las unidades vendidas y el precio es la mediana de lo vendido, ponderada por unidades.
    // Tope (aprobado por el usuario, 2026-11-05): el precio es el MENOR entre la mediana de lo vendido y la mediana de lo
    // publicado (`topePublicado`): una publicación cara con ventas viejas inflaba el precio (Blazer '77: US$193 vs. 40-83).
    // Si la oferta ya cuesta ese tope o más, no se gastan fichas (no puede ser más barata).
    // `vigenciaFichasDias`: las unidades vendidas de cada publicación se reutilizan una semana (cuestan 1 consulta cada una).
    // 2026-11-24: el tope pasó de la mediana (0.5) al cuartil inferior (0.25) de lo publicado, como los perfumes: el usuario
    // vio muchas referencias de eBay infladas (Blazer Mid '77: US$110 con publicaciones desde US$65; el oficial es US$105).
    ventas: { activo: true, minVentas: 3, fichas: 8, topePublicado: 0.25, vigenciaFichasDias: 7, minPublicaciones: 3, publicacionesFirmes: 3 }, // el usuario prefiere referencia firme (2026-11-18): con menos de 3 publicaciones no se avisa
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
