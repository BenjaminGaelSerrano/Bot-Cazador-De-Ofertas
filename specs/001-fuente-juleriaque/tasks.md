# Tasks: Fuente Juleriaque

**Entrada**: [spec.md](spec.md) y [plan.md](plan.md). `[P]` = se puede hacer en paralelo con otras tareas
`[P]` de la misma fase. `[US#]` = historia de la spec. Las pruebas se escriben antes que el código.

## Fase 1: Base del proyecto

- [ ] T001 Crear `package.json` (`"type": "module"`, scripts `test` y `cazador`, engines Node ≥ 22) y
  `src/config.mjs` con umbrales (30 %, 10 %, 30 días), categorías excluidas y topes de mensajes
- [ ] T002 [P] Crear la rama `datos` vacía en el remoto con `datos/alertas.json` y `datos/fallas.json`
  iniciales (`{}`)
- [ ] T003 [P] Guardar fixtures en `tests/fixtures/`: una página de 50 productos de la API real, una
  respuesta 400, una 403 y un JSON vacío

## Fase 2: Núcleo común (bloquea a todas las historias)

- [ ] T004 [P] Test y código de `src/nucleo/http.mjs`: User-Agent propio, pausa ≥ 1 s, corta ante 403 y 429,
  reintento único ante 5xx
- [ ] T005 [P] Test y código de `src/nucleo/historial.mjs`: cargar/guardar, registrar solo si cambió el
  precio o la lista, calcular el mínimo de los últimos N días, contar días de historial
- [ ] T006 [P] Test y código de `src/notificar/callmebot.mjs`: armar mensaje agrupado, recortar al tope,
  `--dry-run` imprime en vez de enviar. Referencia: `Fraganzia-WEB/tools/bot-proveedor.mjs`

## Fase 3: US1 — Leer el catálogo y registrar precios (P1)

- [ ] T007 [US1] Test de `src/fuentes/juleriaque.mjs` con fixtures: normalizar a
  `{ id, ean, marca, nombre, ml, categoria, precioActual, precioLista, moneda, url, stock }`; descartar
  precio 0 o `ListPrice < Price`; extraer los ml del nombre del SKU
- [ ] T008 [US1] Implementar la lectura: listar marcas, paginar de 50 en 50 por marca, subdividir por
  categoría si una marca supera 2.550, deduplicar por `productId`
- [ ] T009 [US1] Prueba de que una marca grande se subdivide y de que ningún pedido usa `_from` > 2500
- [ ] T010 [US1] `src/cli.mjs`: `--fuente juleriaque --dry-run` imprime la cantidad de productos leídos y un
  resumen, sin escribir ni enviar
- [ ] T011 [US1] Prueba manual con `--dry-run` contra el sitio real; medir duración total (objetivo < 15 min,
  esperado 4 a 6)

**Punto de control:** US1 sola ya junta datos útiles.

## Fase 4: US2 — Avisar una ganga (P1)

- [ ] T012 [P] [US2] Test y código de `src/nucleo/ganga.mjs`: regla con historial, regla sin historial
  ("sin historial"), stock obligatorio, campo opcional `referencia`
- [ ] T013 [P] [US2] Test y código de `src/nucleo/alertas.mjs`: no repetir, volver a avisar solo con baja del
  10 % adicional
- [ ] T014 [US2] Conectar en `cli.mjs`: leer → registrar → evaluar → agrupar → enviar → persistir alertas
- [ ] T015 [US2] Prueba de extremo a extremo con historial de fixture: producto con −35 % genera el mensaje
  esperado; el mismo estado al correr dos veces genera un único aviso

## Fase 5: US3 — Fallar a la vista (P2)

- [ ] T016 [P] [US3] Test y código de `src/nucleo/fallas.mjs`: un solo aviso por falla, nuevo aviso solo tras
  una recuperación
- [ ] T017 [US3] Pruebas con fixtures 403, 500 y JSON vacío: un aviso, historial intacto
- [ ] T018 [US3] Integrar en `cli.mjs`: ante falla, no escribir historial parcial

## Fase 6: Automatización

- [ ] T019 Workflow `.github/workflows/cazador.yml`: `cron` en minuto no redondo, 2 corridas por día,
  `workflow_dispatch` con `dry_run` (por defecto verdadero), checkout de la rama `datos`, tests antes de
  correr, commit de datos al final
- [ ] T020 Cargar los secrets `CALLMEBOT_PHONE` y `CALLMEBOT_APIKEY` (tarea manual del usuario)
- [ ] T021 Primera corrida manual con `dry_run`, luego una real; verificar el WhatsApp recibido
- [ ] T022 Registrar en el README cómo ejecutar, probar y leer los datos

## Dependencias

- Fase 2 antes de las fases 3 a 5. Las fases 4 y 5 dependen de la 3.
- T020 lo hace el usuario antes de T021.

## Pendiente fuera de esta spec

- Referencia internacional (PriceRunner UK) como spec 002.
- Fuentes Grid, Rouge y New Era como specs 003 a 005.
- Registro de clusters de promoción para inferir franjas horarias.
