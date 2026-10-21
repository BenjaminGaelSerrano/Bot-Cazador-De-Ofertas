# Implementation Plan: Fuentes Grid, Rouge y New Era

**Spec**: [spec.md](spec.md) · **Fecha**: 2026-10-20 · **Estado**: Draft

## Resumen

Se generaliza el lector VTEX de Juleriaque para que sirva a Grid y Rouge (con modo de agrupación por
SKU o por producto y con la posibilidad de leer sin subdividir), se agrega un lector Shopify para New
Era, y la CLI pasa a procesar varias fuentes con un tope de mensajes compartido.

## Relevamiento (2026-10-20)

| Tienda | Plataforma | Productos | Lectura | Unidad |
|--------|-----------|-----------|---------|--------|
| Grid | VTEX | 2.140 | Cabe en el tope de 2.550: una sola consulta sin `fq` | Producto (SKU = talle, mismo precio) |
| Rouge | VTEX | 4.836 | Por categoría: Perfumes 2.335, Maquillaje 1.113, Tratamientos 1.122, Capilares 247 | SKU (tamaños con precio propio) |
| New Era | Shopify | 924 | `/products.json?limit=250&page=N`, 4 páginas | Producto (variantes = talles) |

- Grid: `robots.txt` pide `Crawl-delay: 0.5`; la pausa de 1 s lo cumple.
- Rouge: excluir la categoría `giftcards` (9 productos). 10 productos quedan fuera de las raíces conocidas.
- New Era: hoy ningún producto tiene `compare_at_price` mayor al precio; sus avisos dependen del historial.
- Una corrida de las cuatro fuentes: unos 283 + 45 + 100 + 4 = ~430 pedidos, ~13 min.

## Presupuesto de Actions

~13 min por corrida × 2 por día × 30 = ~780 min/mes (de 2.000 gratuitos).

## Diseño

```
src/fuentes/
  vtex.mjs         # lector VTEX genérico: crearLector(cfg) -> { normalizarProducto, leerCatalogo }
  juleriaque.mjs   # = crearLector(config.fuentes.juleriaque)  (misma API pública que antes)
  grid.mjs         # = crearLector(config.fuentes.grid)         agrupar: 'producto', sin subdividir
  rouge.mjs        # = crearLector(config.fuentes.rouge)        agrupar: 'sku', categorías
  shopify.mjs      # crearLector(cfg) para Shopify; newera.mjs lo instancia
```

Configuración por fuente (`config.fuentes.<nombre>`): `base`, `agrupar` (`'sku'` | `'producto'`),
`categorias` (árbol; una raíz con `ruta: null` significa "leer todo sin filtro"),
`categoriasExcluidas`, y para Shopify `porPagina`, `maxPaginas`.

**Agrupar por producto**: `id` = id del producto; precio = el más bajo entre los SKU con stock (si
ninguno tiene stock, el más bajo de todos); `precioLista` = el del SKU elegido; `stock` = suma.

**Lectura sin subdividir**: si `categorias = [{ name, ruta: null }]` se pide sin `fq`, se usa el total
del propio sitio como cobertura y se omite el control global.

**Varias fuentes en la CLI**: `--fuente juleriaque,grid,rouge,newera` o `--fuente todas`. Cada una se
procesa con `correrConAvisoDeFalla`; si una falla se anota y se sigue. Al final, código de salida 1 si
alguna falló. El tope total de mensajes (`maxMensajesTotalPorCorrida`) se reparte en orden: a cada fuente
se le pasa lo que queda como `maxMensajes`.

## Control contra la constitución

| Principio | Cómo se cumple |
|-----------|----------------|
| Humano en el circuito | Solo links, sin compra |
| Buen ciudadano | Pausa ≥ 1 s, User-Agent propio, corte ante 403/429, sin endpoints bloqueados |
| Alertas con señal | Misma regla de ganga y deduplicación; agrupar por producto evita avisos por talle |
| Fallar a la vista | Falla por fuente, aviso único; una fuente caída no frena a las otras |
| Simple primero | Un lector VTEX compartido en vez de tres copias |

## Riesgos

- **Cupo de Actions**: se mide la duración real de cada fuente.
- **Rouge: raíces no vistas**: el control de cobertura avisa si superan el 1 %.
- **Shopify `page`**: si la tienda deja de soportarlo o limita la cantidad, el informe lo marca como truncado.
- **CallMeBot**: tope total de 5 mensajes por corrida; canal alternativo sigue pendiente.
