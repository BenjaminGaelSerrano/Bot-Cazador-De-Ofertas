# Opciones de referencia internacional por categoría

Fecha: 2026-10-20. La referencia es el precio retail internacional contra el que se compara una oferta
argentina (constitución §4, condición 2). Sondeo con pedidos de lectura, sin evadir protecciones.

## Perfumes

| Opción | Acceso | Datos | Notas |
|--------|--------|-------|-------|
| **Perfumania (EE. UU.)** | `/products.json` abierto (Shopify) | `price` y `compare_at_price` en USD | **Recomendada.** No expone código de barras: emparejar por marca + nombre + tamaño (oz → ml) |
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
