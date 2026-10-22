# Feature Specification: Puntaje de reventa con Mercado Libre

**Feature Branch**: `003-reventa-mercadolibre`

**Created**: 2026-10-22

**Status**: Draft (falta verificar el acceso al API; ver "Fase 0")

**Input**: El usuario pidió comparar cada oferta con un precio de referencia fuera de la tienda y con la
cantidad de ventas, para decidir según el precio y la probabilidad de reventa si es una buena oferta.
Decisiones del 2026-10-22: se revende **en Argentina** y la fuente de datos es **Mercado Libre**.

## Por qué Mercado Libre y no StockX (relevamiento del 2026-10-22)

| Fuente | Resultado | Motivo |
|--------|-----------|--------|
| StockX (endpoint interno) | Descartada | Responde 403 a pedidos automatizados |
| StockX API oficial v2 | Descartada por ahora | Requiere aprobación (1 a 2 semanas), API key más login OAuth con la cuenta del usuario, y solo entrega precio de oferta más bajo y puja más alta: **no trae cantidad de ventas**. Sin ARS. Solo sneakers, ropa y gorras (no perfumes) |
| Flight Club, eBay API | Descartadas | 403 sin credenciales |
| Stadium Goods | Disponible pero sin uso | Shopify abierto, precios de reventa en USD, sin volumen de ventas |
| **Mercado Libre API** | **Elegida, a verificar** | Es donde el usuario revende; tiene precios locales y `sold_quantity`. Sin credenciales todo devuelve 403 (`PA_UNAUTHORIZED_RESULT_FROM_POLICIES`) |

## Fase 0 — Verificación de acceso (bloquea al resto; requiere al usuario)

No se puede confirmar sin credenciales qué devuelve realmente el API. Hay que comprobar, con una app propia:

1. Registrar una app gratuita en el portal de desarrolladores de Mercado Libre Argentina.
2. Conseguir un token y probar `GET /sites/MLA/search?q=...` y `GET /items/{id}`.
3. Confirmar: ¿alcanza un token de aplicación (`client_credentials`) o exige el login del usuario?
   ¿`sold_quantity` llega exacto, por rangos o no llega? ¿Cuáles son los límites de uso?
4. Decidir dónde se guardan las credenciales: como secrets de GitHub. Si el token rota (el refresh token de
   Mercado Libre cambia en cada renovación), hace falta un lugar seguro para el nuevo; **no** en el repo.

Si el API no entrega `sold_quantity` útil, se reevalúa (ver "Plan B" al final).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cada oferta trae su puntaje de reventa (Priority: P1)

Cuando una oferta es ganga, el mensaje de WhatsApp agrega cuánto se vende ese producto en Mercado Libre, a
qué precio, cuánto ganarías y un veredicto (buena, regular o evitar).

**Why this priority**: es lo pedido: separar "barato" de "buen negocio para revender".

**Independent Test**: con una fuente de mercado simulada (fixture), una ganga con margen alto y muchas
ventas sale "buena"; una con margen alto pero casi sin ventas sale "regular" o "evitar".

**Acceptance Scenarios**:

1. **Given** una ganga de $100.000 y publicaciones iguales en ML a $180.000 con cientos de ventas,
   **When** se arma el aviso, **Then** muestra el precio de reventa, el margen neto estimado y "BUENA".
2. **Given** una ganga con margen alto pero 2 ventas en total, **Then** el veredicto no es "buena" y el
   motivo es la baja liquidez.
3. **Given** una ganga cuyo producto no se encuentra en ML con confianza, **Then** el aviso sale igual,
   marcado "sin dato de reventa", sin inventar un número.
4. **Given** que Mercado Libre no responde o rechaza el pedido, **Then** el aviso de la oferta sale igual
   sin puntaje y la falla se avisa una sola vez.

---

### User Story 2 - El bot ordena y filtra por reventa (Priority: P2)

Entre varias gangas, el bot muestra primero las de mejor ganancia esperada, y permite exigir un mínimo
(por ejemplo, avisar solo las "buenas").

**Independent Test**: con 10 gangas simuladas de distinto puntaje, el orden del mensaje sigue la ganancia
esperada y, con el filtro activo, solo salen las de veredicto "buena".

**Acceptance Scenarios**:

1. **Given** el filtro "solo buenas" activo, **When** hay gangas regulares y buenas, **Then** solo se avisan
   las buenas; las regulares quedan registradas, no se pierden.

---

### User Story 3 - Aprender de lo que pasa en la realidad (Priority: P3)

El bot guarda el puntaje que dio a cada aviso, para que el usuario pueda contrastarlo con lo que
efectivamente vendió y se ajusten los umbrales.

**Independent Test**: cada aviso con puntaje queda en `datos/` con precio, estimación y fecha.

## Modelo de puntaje (propuesta a validar)

Para cada ganga se buscan en Mercado Libre las publicaciones **nuevas** del mismo producto (marca, modelo y
tamaño) y se calcula:

- **Precio de reventa** = percentil 25 de los precios de esas publicaciones (un precio competitivo, no el
  más alto que alguien se anima a pedir).
- **Ingreso neto** = precio de reventa × (1 − comisión de ML) − costo de envío estimado.
- **Margen** = (ingreso neto − costo de compra) / costo de compra.
- **Liquidez** (0 a 1): crece con las ventas acumuladas de las publicaciones comparables, en escala
  logarítmica (el salto de 0 a 10 ventas importa más que el de 500 a 510), y se penaliza si hay muchísima
  competencia.
- **Ganancia esperada** = margen × liquidez.
- **Veredicto**: *buena* si margen ≥ 30 % y liquidez ≥ 0,5; *regular* si margen ≥ 15 % o liquidez ≥ 0,5;
  *evitar* en otro caso.

Todos estos umbrales van a configuración. **Son una heurística, no una predicción**: la "probabilidad de
reventa" es un índice relativo de demanda, no una probabilidad estadística, y el aviso lo dice así.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST consultar Mercado Libre solo para ofertas que ya son ganga, para acotar el
  uso del API.
- **FR-002**: El sistema MUST emparejar el producto con publicaciones de ML por marca, modelo y tamaño, y
  descartar publicaciones usadas, de otra variante o sospechosas.
- **FR-003**: El sistema MUST calcular precio de reventa, ingreso neto, margen, liquidez, ganancia esperada y
  veredicto con la fórmula anterior, con todos los parámetros configurables.
- **FR-004**: El mensaje MUST mostrar el precio de reventa, la cantidad de ventas y el veredicto sin superar
  los topes de largo de la constitución §5.
- **FR-005**: Si no hay dato confiable, el sistema MUST decirlo ("sin dato de reventa") y MUST NOT inventar
  un valor.
- **FR-006**: Una falla de Mercado Libre MUST NOT impedir avisar la oferta ni frenar a las demás fuentes.
- **FR-007**: Las credenciales MUST salir de secrets de GitHub y MUST NOT guardarse en el repo ni en la
  rama `datos`.
- **FR-008**: Cada aviso con puntaje MUST registrarse para poder contrastarlo después.
- **FR-009**: El sistema MUST respetar los límites de uso del API de Mercado Libre, con pausa entre pedidos
  y corte ante 403/429.

### Key Entities

- **Mercado de un producto**: publicaciones comparables, precios, ventas acumuladas, cantidad de vendedores.
- **Puntaje de reventa**: precio de reventa, margen, liquidez, ganancia esperada, veredicto, nivel de
  confianza del emparejamiento.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ningún aviso inventa un dato de reventa: o hay datos de ML o dice "sin dato".
- **SC-002**: Una falla de ML no cambia la cantidad de avisos de ofertas respecto de la corrida sin reventa.
- **SC-003**: Al menos el 70 % de las gangas de prueba verificadas a mano se emparejan con el producto
  correcto en ML.
- **SC-004**: Los avisos con puntaje caben en los topes de largo de mensaje.

## Assumptions

- Se revende en Argentina a través de Mercado Libre; el usuario no vende en el exterior por ahora.
- Comisión de ML y costo de envío son parámetros que el usuario debe confirmar; no están verificados.
- La comparación con una tienda retail internacional (PriceRunner UK, ver `docs/referencias.md`) sigue como
  idea aparte y no se mezcla con esta spec.
- Los perfumes tienen un riesgo particular: en ML abundan las réplicas y los decants. El emparejamiento
  debe filtrarlos o marcar baja confianza.

## Plan B si Mercado Libre no entrega ventas

Estimación propia sin fuente externa: profundidad del descuento, stock bajo (escasez) y una lista curada
de marcas y modelos con demanda alta. Menos precisa, pero funciona sin credenciales.
