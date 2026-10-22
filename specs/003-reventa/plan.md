# Implementation Plan: Puntaje de reventa con datos propios

**Spec**: [spec.md](spec.md) · **Fecha**: 2026-10-22 · **Estado**: Aprobado

## Resumen

Se agrega un módulo `mercado` que cruza las tiendas por EAN (sin pedidos extra: usa los historiales ya
guardados), un puntaje de reventa con tus parámetros (Instagram: comisión 0 %, margen buscado 40 %), y el
registro de stock numérico para medir velocidad de venta con el tiempo. El mensaje de WhatsApp suma una
línea con el precio de mercado, el margen y el veredicto.

## Parámetros decididos por el usuario (2026-10-22)

| Parámetro | Valor |
|-----------|-------|
| Canal de reventa | Instagram: comisión 0 % |
| Envío | No cuenta (0) |
| Margen para "buena" | ≥ 40 % |
| Margen para "regular" | ≥ 20 % (propuesto) |
| Descuento competitivo al revender | 5 % por debajo del precio de mercado (propuesto) |

## Diseño

```
src/nucleo/
  mercado.mjs     # clave de producto, índice entre tiendas, precio de mercado local
  reventa.mjs     # margen, veredicto y velocidad de venta (puros, sin red)
src/notificar/formato.mjs   # suma la línea de mercado/margen/veredicto
src/correr.mjs              # carga los historiales de las otras tiendas, puntúa, filtra "evitar"
src/nucleo/historial.mjs    # registra stock numérico (stk) por producto
```

**Clave de producto**: el EAN si es válido (≥ 8 dígitos, no repetido ni de relleno); si no, marca + tamaño en
ml + nombre normalizado, y solo si hay tamaño (sin tamaño, la coincidencia es demasiado dudosa).

**Precio de mercado local**: el menor precio con stock entre las *otras* tiendas, visto en los últimos 3 días.
Un precio ajeno menor a un cuarto del propio se descarta (probablemente otro formato del producto).

**Flujo** en `correrFuente`: leer → registrar → ganga → cargar historiales de las otras tiendas →
puntuar cada ganga → quitar las "evitar" → ordenar (buenas, regulares, sin referencia) → avisar. Las "evitar"
no se marcan como avisadas.

**Stock**: `registrar` guarda `stk` = `[[fecha, cantidad]]` solo cuando cambia la cantidad. La velocidad de
venta suma las bajadas (las subidas son reposición) dentro de una ventana de 7 días, exige al menos 2 días
de datos e ignora cantidades de relleno (≥ 1000).

**Mensaje**: una cuarta línea por oferta, corta, para entrar en 650 caracteres:
`Mercado $286.000 (Rouge) · margen 90% · BUENA` o `sin referencia de otra tienda`.

## Riesgos

- **Pocos mensajes por corrida**: con 4 líneas por oferta entran 2 por mensaje (unas 10 por corrida).
- **Emparejado equivocado**: se mitiga con EAN y con el descarte de precios absurdos; nunca se inventa.
- **Datos de otras tiendas con hasta una corrida de antigüedad**: el mensaje no promete precio en vivo.
- **Stock de relleno (99999)**: se ignora al calcular velocidad.
