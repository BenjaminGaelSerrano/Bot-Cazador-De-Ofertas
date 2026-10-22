# Tasks: Fuente Parfumerie

**Entrada**: [spec.md](spec.md) y [plan.md](plan.md). Las pruebas se escriben antes que el código.

## Fase 1: Cliente HTTP con POST

- [x] T001 `obtenerJson(url, { metodo, cuerpo })`: POST con cuerpo JSON, mismas pausas, reintentos y cortes. Pruebas

## Fase 2: Lector Magento

- [x] T002 Normalización: producto simple y variantes → ofertas (precio final/lista, stock numérico, link del padre,
  ml del nombre). Pruebas con la fixture real
- [x] T003 Lista liviana paginada de a 100 con deduplicado por SKU, errores de GraphQL como respuesta inválida y
  lectura parcial ante páginas fallidas. Pruebas
- [x] T004 Atributos incrementales: pedir solo los SKU desconocidos, con tope por corrida, reutilizar los
  conocidos del historial, tolerar productos faltantes. Pruebas con la fixture real

## Fase 3: Integración

- [x] T005 `correrFuente` carga el historial antes de leer y se lo pasa al lector; las demás fuentes lo ignoran. Pruebas
- [x] T006 `marca` nula tolerada en el mensaje y en el cruce. Pruebas
- [x] T007 `config.fuentes.parfumerie`, entrada en la CLI y en `todas`; configuración coherente. Pruebas
- [x] T008 Workflow: `timeout-minutes` a 45

## Fase 4: Verificación y entrega

- [x] T009 Prueba real en `--dry-run` de Parfumerie: tiempos, cobertura, enriquecimiento y mensajes
  Resultado 2026-10-22 (sin 429): 6.347 de 6.357 productos, 124 pedidos, 5,4 min; 5.302 ofertas; 426 gangas; 1.351 unidades
  enriquecidas de 1.500 productos pedidos (los que el sitio no devolvió se marcan como consultados); cruce con Rouge:
  las mejores ofertas salen BUENA con el precio de mercado de Rouge. Hallazgo: las variantes de un configurable también
  figuran como productos simples sueltos con página propia; se registra una sola vez por SKU y gana el simple.
- [x] T010 Documentación (README, `docs/fuentes.md`, CLAUDE.md, constitución) y subida a `main`
- [ ] T011 El usuario corre el workflow y revisa los primeros avisos

## Pendiente fuera de esta spec

- Moov y Dexter (Salesforce Commerce Cloud): verificar qué datos entregan y si traen código de barras.
