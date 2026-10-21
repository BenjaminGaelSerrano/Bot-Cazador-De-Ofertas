# Tasks: Fuentes Grid, Rouge y New Era

**Entrada**: [spec.md](spec.md) y [plan.md](plan.md). Las pruebas se escriben antes que el código.

## Fase 1: Lector VTEX genérico

- [x] T001 Extraer `src/fuentes/vtex.mjs` con `crearLector(cfg)`; `juleriaque.mjs` pasa a instanciarlo. Las
  pruebas existentes de Juleriaque deben seguir pasando sin cambios
- [x] T002 Modo `agrupar: 'producto'` con pruebas: talles al mismo precio dan un solo ítem, el precio es
  el del SKU con stock más barato, el stock se suma, sin stock no avisa
- [x] T003 Lectura sin subdividir (`ruta: null`) con pruebas: sin `fq`, cobertura propia, truncado si supera 5.100

## Fase 2: Lector Shopify

- [x] T004 [P] Fixture de `products.json` de New Era y pruebas de `src/fuentes/shopify.mjs`: paginación hasta
  página vacía, deduplicado, precio mínimo entre variantes disponibles, `compare_at_price` como lista,
  exclusión de gift cards, tope de páginas

## Fase 3: Configuración de las tres fuentes

- [x] T005 [P] `config.fuentes.grid` (VTEX, por producto, sin subdividir), `rouge` (VTEX, por SKU, 4
  categorías, excluir `giftcards`) y `newera` (Shopify). Prueba de que la configuración es coherente
- [x] T006 Fixtures reales recortadas de Grid y Rouge y pruebas de normalización

## Fase 4: CLI con varias fuentes y tope de mensajes

- [x] T007 `correrFuente` acepta `maxMensajes`; prueba de que lo respeta
- [x] T008 `cli.mjs`: `--fuente a,b,c` y `todas`, continuar tras una falla, código de salida 1 si alguna
  falló, tope total de mensajes repartido en orden. Pruebas del reparto y de la continuidad
- [x] T009 Probar en el sitio real con `--dry-run` cada fuente (una por vez, con pausa) y medir tiempos
  Resultado 2026-10-20 (sin 429): New Era 924 productos, 4 pedidos, 0,1 min; Grid 2.139 de 2.139, 43 pedidos,
  1,4 min, 548 gangas con descuento declarado; Rouge 4.808 de 4.836, 99 pedidos, 2,0 min, 352 gangas.

## Fase 5: Automatización

- [x] T010 Workflow: `--fuente todas`, `timeout-minutes` ajustado
- [x] T011 Actualizar README, `docs/fuentes.md`, CLAUDE.md y la constitución
- [x] T011b Línea base de la primera corrida de cada fuente (FR-010): 8 mejores y el resto marcado como visto;
  escritura en orden seguro (alertas antes que historial); pruebas de caída a mitad de la primera corrida
- [ ] T012 El usuario corre el workflow en modo simulación y luego real

## Dependencias

- T001 antes de T002, T003, T005, T006. T004 es independiente. T007 antes de T008. T009 después de T005 y T008.
