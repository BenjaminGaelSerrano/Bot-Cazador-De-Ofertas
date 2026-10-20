# Relevamiento de fuentes

Fecha: 2026-10-20. Sondeo hecho con pedidos de lectura (un par por sitio), sin evadir ninguna protección.
Todo lo de esta tabla se re-verifica en la spec de cada fuente antes de implementar.

| Marca | Sitio | Plataforma | Cómo leer precios | Estado |
|-------|-------|------------|-------------------|--------|
| Juleriaque | juleriaque.com.ar | VTEX | `/api/catalog_system/pub/products/search?_from=0&_to=49` | Viable. Devuelve `Price`, `ListPrice` y stock |
| Grid (distribuye Nike, Jordan, NBA) | grid.com.ar | VTEX | Misma API VTEX | Viable. `robots.txt` pide `Crawl-delay: 0.5` |
| Rouge | perfumeriasrouge.com | VTEX | Misma API VTEX | Viable. Confirmar que es el sitio de compra oficial (`rouge.com.ar` no existe) |
| New Era | newera.com.ar | Shopify | `/products.json?limit=250&page=N` | Viable. `compare_at_price` marca el precio de lista |
| Parfumerie | parfumerie.com.ar | Magento | Sin API pública detectada | Requiere parsear HTML o sitemap. Evaluar después |
| Moov | moov.com.ar | Propia (no VTEX ni Shopify) | Sin API pública detectada | Requiere parsear HTML. Evaluar después |
| Nike (oficial) | nike.com.ar | Protegido | Responde 403 a cualquier pedido automatizado | **Descartado.** No se evade. Cubrir Nike vía Grid y Moov |

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

## Siguiente

1. Spec de la primera fuente. Propuesta: **Juleriaque**, porque es perfumería, VTEX y con stock real.
2. Elegir las páginas de referencia internacional por categoría (perfumes, calzado, gorras/ropa).
3. Investigar franjas horarias de ofertas relámpago de estas marcas.
