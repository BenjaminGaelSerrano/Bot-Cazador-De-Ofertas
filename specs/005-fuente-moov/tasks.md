# Tasks: Fuente Moov y cruce por modelo

**Entrada**: [spec.md](spec.md) y [plan.md](plan.md). Las pruebas se escriben antes que el código.

## Fase 1: Clave de modelo

- [x] T001 `modelo.mjs`: `claveModelo`, alias de marca, palabras genéricas, género y `compatibles`. Pruebas con nombres
  reales de Grid y Moov (los pares del prototipo deben emparejar; Superstar II y Superstar II Cuero no)

## Fase 2: Lector SFCC

- [x] T002 Fixture real recortada de la grilla de Moov y pruebas de parseo (pid, nombre, precio, lista tachada, género
  por categoría, entidades HTML)
- [x] T003 `sfcc.mjs`: paginación hasta página incompleta, deduplicado por pid, lectura parcial ante páginas fallidas,
  corte ante 403/429. Pruebas

## Fase 3: Cruce y mensaje

- [x] T004 Grid (modo producto) y Moov calculan `modelo` y `genero`; el historial los guarda (`km`, `gen`). Pruebas
- [x] T005 `mercado.mjs`: nivel `modelo` con compatibilidad de género; el índice guarda el género. Pruebas
- [x] T006 `formato.mjs`: `~` cuando el cruce no es por código de barras. Pruebas
- [x] T007 `config.fuentes.moov`, CLI, `todas`; configuración coherente. Pruebas

## Fase 4: Verificación y entrega

- [x] T008 Prueba real de Moov y vista previa de Grid contra Moov con datos reales
  Resultado 2026-10-22: Moov 1.807 tiles = 1.371 productos únicos en 39 pedidos y 0,8 min, sin 429. Grid: 597 gangas = 71 buenas,
  11 regulares, 44 evitadas, 471 sin referencia (la mayoría ropa). Moov: 505 gangas = 16 buenas, 7 regulares, 73 evitadas.
- [x] T009 Revisión manual de 20 pares emparejados
  Los 20 eran el mismo modelo. Se hallaron dos defectos de género y se corrigieron: un género desconocido era comodín (comparaba
  "SAMBA OG" de Grid sin género con la versión de mujer de Moov) y un producto listado en hombre y en mujer quedaba con el
  género de la primera categoría (ahora es unisex). Tras el arreglo: 376 pares, 0 con géneros incompatibles; 76 con Grid 30 % o
  más barato que Moov, 34 entre 5 y 30 %, 93 parejos y 173 con Grid más caro.
- [x] T010 Documentación y subida a `main`

## Pendiente fuera de esta spec

- Indumentaria de Moov, Stock Center, New Balance y Puma como fuentes y referencias.
