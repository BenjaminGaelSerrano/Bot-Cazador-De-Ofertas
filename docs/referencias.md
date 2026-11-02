# Opciones de referencia internacional por categoría

> **Actualización 2026-11-02 (spec 006):** se usa Perfumania para perfumes; PriceRunner quedó descartado por sus
> términos; la API de eBay (Browse, búsqueda por `gtin`) necesita aprobación de eBay para producción.

Fecha: 2026-10-20. La referencia es el precio retail internacional contra el que se compara una oferta
argentina (constitución §4, condición 2). Sondeo con pedidos de lectura, sin evadir protecciones.

## Comparadores de precios (el mejor camino para una referencia que no sea Argentina)

Un comparador junta el precio de muchas tiendas de un mercado y evita depender de una sola tienda.
Ranking de tráfico de Similarweb, septiembre 2026, categoría comparadores:
[idealo.de](https://www.similarweb.com/top-websites/e-commerce-and-shopping/price-comparison/) (1.º),
kakaku.com, akakce.com, ceneo.pl, mydealz.de, tweakers.net, trovaprezzi.it, heureka.cz, bizrate.com,
cimri.com, ... idealo.fr (14.º), idealo.es (18.º), prisjakt.nu (20.º; es PriceSpy en sueco).

| Comparador | Mercado | Acceso | Veredicto |
|------------|---------|--------|-----------|
| PriceRunner UK | Reino Unido, GBP | Páginas abiertas, pero sus términos prohíben el scraping y el uso no privado (leído el 2026-11-02) | **Descartado** |
| PriceSpy | UK, NZ, Suecia, etc. | `robots.txt` permisivo, pero el HTML no trae precios (los carga con JavaScript desde una API interna no documentada) | Descartado por ahora. No se usa una API interna sin documentar |
| idealo (.de, .es, .fr, .co.uk) | Alemania, España, Francia, UK | Devuelve una página anti-bot (403) | Descartado |
| Geizhals | Austria, Alemania | 403 | Descartado |
| Trovaprezzi | Italia | 403 en la home | Descartado |
| Ceneo | Polonia | `robots.txt` con `Disallow: /` y `Crawl-Delay: 120` | Descartado |
| kakaku, akakce, mydealz, tweakers, heureka, cimri | Japón, Turquía, Alemania, etc. | Sin sondear | Mercados poco útiles como precio de referencia para estas marcas |
| Google Shopping | Global | No automatizable | Descartado |

### PriceRunner UK: lo verificado el 2026-10-20

- `/cl/55/Fragrances`: unos 116 productos con `lowestPrice` (GBP), precio por litro y cantidad de tiendas.
- `/pl/55-<id>/...`: ficha con `schema.org/Product` y `AggregateOffer` (`lowPrice`, `highPrice`,
  `offerCount`). Ejemplo: Dior Sauvage EdP 100 ml, £100,00 a £138,88 en 11 tiendas.
- Su `robots.txt` bloquea `/*search=`, `/gotostore/`, `/track/`, `/checkout/` y filtros apilados. **Se usan
  solo categorías y fichas de producto, no la búsqueda.**
- Entrega el precio mínimo actual, no historial ni precio de lista. El historial lo arma el bot.
- Los términos de uso no se leyeron todavía: **leerlos antes de implementar**.
- El precio incluye IVA del Reino Unido (20 %), parecido al argentino (21 %), lo que facilita comparar.
- Siguiente paso: confirmar qué categorías equivalen a calzado deportivo y gorras en PriceRunner.

## Perfumes

| Opción | Acceso | Datos | Notas |
|--------|--------|-------|-------|
| **Perfumania (EE. UU.)** | Shopify: `/search/suggest.json` y `/products/<handle>.json` | `price` y **`barcode`** por variante, en USD | **Elegida (spec 006).** El listado `products.json` no trae el código, la ficha sí. Bloquea tras 2-3 pedidos (~25 min) |
| Sephora EE. UU. | Home responde, sin API verificada | — | Hace falta parsear HTML; evaluar |
| Jomashop | Home responde, sin API verificada | — | Evaluar |
| FragranceNet, FragranceX | 403 al pedido automatizado | — | Descartadas |
| Notino | 403 al pedido automatizado | — | Descartada |
| Historial de Amazon (camelCamelCamel, RiverPrice, PriceHistory.app) | Páginas por producto | Mín., promedio, precio actual en USD | Solo Amazon; útil para validar a mano, no para automatizar |

## Calzado y ropa deportiva

| Opción | Acceso | Notas |
|--------|--------|-------|
| Nike EE. UU. | Home responde, sin API verificada | Evaluar. El sitio argentino sí bloquea, el estadounidense no lo hizo en el sondeo |
| Zappos | Home responde, sin API verificada | Evaluar |
| Foot Locker | Home responde, `products.json` no existe | Evaluar |
| Finish Line, JD Sports | 403 | Descartadas |

## Gorras (New Era)

| Opción | Acceso | Notas |
|--------|--------|-------|
| **neweracap.com (EE. UU.)** | `/products.json` abierto (Shopify) | **Recomendada.** Es la misma marca y plataforma que `newera.com.ar`, así que los modelos se emparejan por nombre/SKU |

## Problemas de diseño que esto abre

1. **Emparejar productos.** Juleriaque expone EAN y tamaño; Perfumania no. Plan: emparejar por EAN
   cuando ambos lo tengan y, si no, por marca + nombre normalizado + mililitros.
2. **Comparar manzanas con manzanas.** Precio retail de EE. UU. no incluye impuestos locales ni envío, y
   en Argentina hay costos de importación. `PENDIENTE`: definir un factor de ajuste configurable.
3. **Tipo de cambio.** Usar dólar configurable (en Fraganzia: dolarapi.com).
4. **Cobertura parcial.** Muchos productos argentinos no tendrán referencia. En ese caso el bot solo
   puede evaluar la condición 1 (historial) y debe marcar la alerta como "sin referencia internacional".
