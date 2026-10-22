# Implementation Plan: Fuente Moov y cruce por modelo

**Spec**: [spec.md](spec.md) · **Fecha**: 2026-10-22 · **Estado**: Draft

## Resumen

Un lector Salesforce Commerce Cloud (`sfcc.mjs`, `moov.mjs` lo instancia) que lee la grilla de calzado, un cálculo de
clave de modelo y género (`modelo.mjs`) usado por Grid y Moov, y un tercer nivel en el cruce de mercado (`mercado.mjs`)
que empareja por modelo con compatibilidad de género y lo marca aproximado.

## Diseño

```
src/nucleo/modelo.mjs     # claveModelo(marca, nombre) -> { marca, genero, clave }; compatibles(g1, g2)
src/fuentes/sfcc.mjs      # crearLectorSfcc(cfg): grilla Search-UpdateGrid, paginada, parseo del HTML de cada tile
src/fuentes/moov.mjs      # = crearLectorSfcc(config.fuentes.moov)
src/fuentes/vtex.mjs      # en modo "producto" (Grid) suma modelo y género a la oferta
src/nucleo/historial.mjs  # guarda km (clave de modelo) y gen (género)
src/nucleo/mercado.mjs    # índice y precioMercado con tercer nivel por modelo y filtro de género
src/notificar/formato.mjs # "~" antes del precio de mercado cuando el cruce es aproximado
```

**Lector SFCC**: por cada categoría pide `Search-UpdateGrid?cgid=<c>&start=<n>&sz=48` hasta recibir menos de 48
productos. Del HTML de cada `div.product` extrae `data-pid`, el nombre del `a.link[title]`, el precio actual
(`.sales .value[content]`) y el de lista (`.strike-through.list .value[content]`). Deduplica por pid entre categorías.
El género sale de la categoría. Un pedido que falla tras los reintentos deja la lectura parcial (como VTEX).

**Clave de modelo**: se normaliza el texto (minúsculas, sin acentos ni apóstrofos), se detecta la marca con una tabla de
alias, se quita la marca, las palabras genéricas y el género, y las palabras restantes se ordenan. `clave` es
`marca|palabras`. Solo hay clave si hay marca conocida y al menos una palabra.

**Cruce**: tres niveles en orden: `ean` → `nombre` (marca + ml + nombre, perfumería) → `modelo`. Para `modelo` el
índice guarda el género de cada entrada y `precioMercado` descarta las incompatibles. El resultado trae `via`, y el
formato antepone `~` cuando `via !== 'ean'`.

**Presupuesto de Actions**: dos categorías de ~600 a ~900 productos son 25 a 35 pedidos de ~6 s: unos 3 a 4 minutos por
corrida. Con las cinco fuentes actuales (~17 min) el total pasa a ~21 min, unos 1.260 minutos al mes con 2 corridas
por día (de 2.000 gratuitos).

## Control contra la constitución

| Principio | Cómo se cumple |
|-----------|----------------|
| Buen ciudadano | Pausa ≥ 1 s, User-Agent propio, endpoint de la propia tienda, solo calzado, sin evadir nada |
| Nunca inventar un dato | Clave idéntica o no hay cruce; el aproximado se marca con `~` |
| Fallar a la vista | Lectura parcial avisada una vez; mensajes ≤ 700 de largo efectivo |

## Riesgos

- **Falsos emparejados por nombre**: se mitigan exigiendo marca y clave idénticas y compatibilidad de género; se
  marcan aproximados.
- **Cambio del HTML de Moov**: el parseo se prueba con una fixture real; si cambia, las ofertas salen vacías y la
  lectura falla a la vista.
- **Tiempo de corrida**: se mide cada fuente.
