# Implementation Plan: Fuente Parfumerie

**Spec**: [spec.md](spec.md) · **Fecha**: 2026-10-22 · **Estado**: Draft

## Resumen

Un lector Magento (`src/fuentes/magento.mjs`, `parfumerie.mjs` lo instancia) que lee la lista liviana por GraphQL
en cada corrida y pide los atributos pesados una sola vez por SKU, guardándolos en el historial. El cliente HTTP
suma `POST`. `correrFuente` pasa el historial al lector para que reutilice los atributos ya conocidos.

## Diseño

```
src/nucleo/http.mjs         # obtenerJson(url, { metodo, cuerpo }): POST con JSON, mismas garantías
src/fuentes/magento.mjs     # crearLectorMagento(cfg): lista liviana + atributos incrementales
src/fuentes/parfumerie.mjs  # = crearLectorMagento(config.fuentes.parfumerie)
src/correr.mjs              # carga el historial ANTES de leer y se lo pasa al lector
```

**Dos fases de lectura**

1. Lista liviana: `products(filter:{category_id:{eq:"2"}}, pageSize:100, currentPage:n)` con `sku`, `name`,
   `url_key`, `stock_status`, `only_x_left_in_stock`, `price_range` y, para configurables, `variants`. 64 pedidos.
2. Atributos: para los productos con algún SKU desconocido, `products(filter:{sku:{in:[...]}}, pageSize:25)` con
   `custom_attributesV2(filters:{is_wysiwyg_enabled:false})` (trae `gtin`, `mgs_brand`; sin descripciones). Hasta
   `maxProductosPorCorrida`. Se leen los hijos a través del padre, porque no son visibles por sí solos.

**Qué se sabe de antes**: el lector recibe `{ historial }` y busca `historial.productos[sku]` para reutilizar
`ean` y `marca`. Si el SKU no se enriquece en esta corrida, la oferta sale sin `ean`/`marca` y se completa en una
corrida posterior.

**Stock numérico**: `IN_STOCK` con `only_x_left_in_stock` → esa cantidad; `IN_STOCK` sin cantidad → 99999 (marcador);
`OUT_OF_STOCK` → 0.

**Marca vacía**: `formatearOferta` y el cruce toleran `marca` nula (no se antepone nada y no hay clave de nombre).

**Integración**: `config.fuentes.parfumerie`, entrada `parfumerie` en la CLI (`todas` la incluye) y en el
cruce de `cargarOtros`, que ya recorre `Object.keys(config.fuentes)`.

## Presupuesto de Actions

La lista liviana tarda ~6 minutos y los atributos ~2 minutos por corrida (durante ~5 corridas). Con las otras
cuatro fuentes la corrida total pasa de ~11 a ~18 minutos: unos 1.080 minutos al mes con 2 corridas por día,
bajo los 2.000 gratuitos. El `timeout-minutes` del workflow sube a 45.

## Control contra la constitución

| Principio | Cómo se cumple |
|-----------|----------------|
| Buen ciudadano | Pausa ≥ 1 s, User-Agent propio, endpoint que la propia tienda usa, atributos pesados una sola vez |
| Nunca inventar un dato | Sin EAN/marca queda en blanco y el cruce lo omite |
| Fallar a la vista | Páginas fallidas → lectura parcial avisada una vez; mensajes ≤ 650 caracteres |

## Riesgos

- **Cambios del esquema GraphQL**: una consulta con error devuelve `errors`; se trata como respuesta inválida.
- **Tamaño de lectura**: si el catálogo crece, el tiempo de corrida crece; se mide cada corrida.
- **Atributos sin gtin (7 %)**: esos productos no cruzan por EAN.
