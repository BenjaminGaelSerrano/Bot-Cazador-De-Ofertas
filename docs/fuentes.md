# Relevamiento de fuentes

Fecha: 2026-10-20. Sondeo hecho con pedidos de lectura (un par por sitio), sin evadir ninguna protección.
Todo lo de esta tabla se re-verifica en la spec de cada fuente antes de implementar.

| Marca | Sitio | Plataforma | Cómo leer precios | Estado |
|-------|-------|------------|-------------------|--------|
| Juleriaque | juleriaque.com.ar | VTEX | `/api/catalog_system/pub/products/search?_from=0&_to=49` | **Implementada** (spec 001). Devuelve `Price`, `ListPrice` y stock |
| Grid (distribuye Nike, Jordan, NBA) | grid.com.ar | VTEX | Misma API VTEX | **Implementada** (spec 002). 2.139 productos, aviso por producto. `robots.txt` pide `Crawl-delay: 0.5` |
| Rouge | perfumeriasrouge.com | VTEX | Misma API VTEX | **Implementada** (spec 002). 4.808 de 4.836 productos, aviso por SKU (tamaño) |
| New Era | newera.com.ar | Shopify | `/products.json?limit=250&page=N` | **Implementada** (spec 002). 924 productos; hoy ninguno trae descuento declarado |
| Parfumerie | parfumerie.com.ar | Magento | Sin API pública detectada | Requiere parsear HTML o sitemap. Evaluar después |
| Moov | moov.com.ar | Propia (no VTEX ni Shopify) | Sin API pública detectada | Requiere parsear HTML. Evaluar después |
| Dexter | dexter.com.ar | Propia (no VTEX ni Shopify) | Sin API pública detectada | Requiere parsear HTML. Evaluar después |
| Nike (oficial) | nike.com.ar | Protegido | Responde 403 a cualquier pedido automatizado | **Descartado.** No se evade. Cubrir Nike vía Grid, Moov y Dexter |
| Adidas (oficial) | adidas.com.ar | Protegido | Responde 403 a cualquier pedido automatizado | **Descartado.** Cubrir Adidas vía Grid, Moov y Dexter |

## Qué dice cada `robots.txt`

- Juleriaque y Rouge: bloquean `/account`, `/checkout`, `/busca` y similares. La API de catálogo y el
  sitemap no están bloqueados.
- Grid: bloquea parámetros de búsqueda y paginación por `page=`; pide 0,5 s entre pedidos.
- New Era: bloquea carrito, checkout, cuenta y colecciones con `sort_by`.
- Parfumerie y Moov: bloquean carrito, checkout y cuenta.

## Datos útiles de las respuestas

- VTEX: el descuento sale directo de `commertialOffer.ListPrice` contra `Price`. El campo
  `AvailableQuantity` indica stock (muchos productos de Grid vienen en 0, hay que filtrarlos).
- Shopify: `variants[].price` y `variants[].compare_at_price` (puede venir `null` si no hay oferta).
- El orden por defecto no es por descuento: hay que recorrer el catálogo completo y calcular.

## Dónde se habla de ofertas (Reddit, Telegram, X)

Sondeo del 2026-10-20. Sirve para enterarse de patrones (horarios, errores de precio), no para alimentar
al bot.

- **Reddit:** devuelve 403 a lectura anónima, incluso en `search.json`. La web search tampoco indexa
  hilos útiles. Opción legítima: la API oficial con una app propia (OAuth, gratuita para uso personal).
  No se evade el bloqueo. Alternativa inmediata: que el usuario pase hilos concretos.
- **Telegram:** los canales públicos son legibles en `t.me/s/<canal>` sin cuenta. Los canales
  encontrados son de España (`@descuentos`, `@ofertaszone`, `@zapatillasysneakers`); no apareció ningún
  canal argentino de perfumes o ropa. Falta que el usuario aporte canales que ya siga.
- **X:** exige sesión o API paga. Se descarta como fuente automática.
- **Hallazgo útil:** la API de Grid ya publica los "clusters" de promoción vigentes (`3x2`, `2da al 50`,
  `Calzado days`, `15 off BF`...). Observar cuándo aparecen y desaparecen da los horarios de ofertas sin
  depender de foros.

## Siguiente

1. Spec de la primera fuente: [`specs/001-fuente-juleriaque/spec.md`](../specs/001-fuente-juleriaque/spec.md).
2. Elegir referencia internacional por categoría (opciones en [`referencias.md`](referencias.md)).
3. Registrar durante unos días los clusters de promoción y los cambios de precio para inferir franjas
   horarias.
