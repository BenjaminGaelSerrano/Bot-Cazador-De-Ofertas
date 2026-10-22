# Tasks: Puntaje de reventa con datos propios

**Entrada**: [spec.md](spec.md) y [plan.md](plan.md). Las pruebas se escriben antes que el código.

## Fase 1: Registrar stock (empieza a juntar datos ya)

- [x] T001 `historial.registrar` guarda `stk` (cantidad) cuando cambia; migra productos sin `stk`; misma fecha
  reemplaza la cantidad. Pruebas
- [x] T002 `velocidadVenta(producto, hoy)`: suma bajadas en 7 días, ignora reposiciones y cantidades de relleno,
  exige 2 días de datos. Pruebas

## Fase 2: Mercado local

- [x] T003 `mercado.mjs`: clave de producto (EAN válido o marca + ml + nombre), índice entre tiendas con
  vigencia de 3 días y stock, precio de mercado local con descarte de precios absurdos. Pruebas con datos reales
- [x] T004 Prueba de emparejado con los historiales reales de Juleriaque y Rouge (4.988 EAN en común)

## Fase 3: Puntaje y mensaje

- [x] T005 `reventa.mjs`: precio de reventa, margen, veredicto (buena/regular/evitar/sin referencia) con los
  parámetros del usuario; la demanda baja degrada. Pruebas de cada borde
- [x] T006 `formato.mjs`: línea de mercado, margen y veredicto; caben en los topes de largo. Pruebas
- [x] T007 `correrFuente`: cargar las otras tiendas, puntuar, quitar "evitar" sin marcarlas, ordenar. Pruebas
  de extremo a extremo
- [x] T008 Registrar cada aviso con su puntaje en `datos/` (FR-008). Pruebas

## Fase 4: Verificación y entrega

- [x] T009 Vista previa offline con los datos reales de la rama `datos`: los mensajes que se enviarían
  Resultado 2026-10-22: Juleriaque 230 gangas = 14 buenas, 22 regulares, 19 evitadas, 175 sin referencia; Rouge 373 = 5 buenas,
  2 regulares, 15 evitadas, 351 sin referencia; Grid 593 = todas sin referencia (sin EAN ni competidor). Emparejado: 1.926 de
  5.065 SKU de Juleriaque con stock tienen referencia en Rouge, 99,5 % de la misma marca (el resto son nombres distintos del
  mismo producto, ej. Donna Karan = DKNY).
- [x] T010 Documentación (README, constitución) y subida a `main`
- [ ] T011 El usuario corre el workflow y contrasta los primeros avisos

## Pendiente fuera de esta spec

- Referencia internacional (PriceRunner UK), Mercado Libre y StockX como proveedores opcionales.
- Moov y Dexter para tener competidores de ropa y calzado.
