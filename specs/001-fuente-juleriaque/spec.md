# Feature Specification: Fuente Juleriaque

**Feature Branch**: `001-fuente-juleriaque`

**Created**: 2026-10-20

**Status**: Draft

**Input**: Primera fuente del bot cazador de ofertas: leer el catálogo online de Juleriaque
(juleriaque.com.ar, VTEX), detectar ofertas y avisar por WhatsApp.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Leer el catálogo y registrar precios (Priority: P1)

El bot recorre el catálogo completo de Juleriaque, normaliza cada producto y guarda su precio del día en
el historial. Esta historia no avisa nada: construye la base de datos que hace posible detectar gangas.

**Why this priority**: sin historial de 30 días no se puede evaluar la condición 1 de la constitución §4.
Cuanto antes empiece a juntar datos, antes sirve el bot.

**Independent Test**: correr el bot con `--dry-run` y verificar que lista N productos normalizados con
precio, precio de lista, stock y EAN, sin enviar mensajes ni escribir estado.

**Acceptance Scenarios**:

1. **Given** el catálogo tiene más de 50 productos, **When** corre el bot, **Then** recorre todas las
   páginas de resultados y no se queda en las primeras 50.
2. **Given** un producto con stock 0, **When** se normaliza, **Then** se guarda su precio pero queda
   marcado sin stock y no genera alertas.
3. **Given** el sitio responde con error o vacío, **When** corre el bot, **Then** no borra ni
   sobrescribe el historial y registra la falla (US3).

---

### User Story 2 - Avisar una ganga por WhatsApp (Priority: P1)

Cuando un producto con stock cumple la regla de ganga, el bot manda un mensaje corto por CallMeBot con
marca, producto, precio, descuento y link directo.

**Why this priority**: es el objetivo del proyecto.

**Independent Test**: con un historial de fixture y un producto cuyo precio cae un 35 % bajo el mínimo
de 30 días, `--dry-run` imprime el mensaje exacto que se enviaría; sin `--dry-run` y con credenciales
llega a WhatsApp.

**Acceptance Scenarios**:

1. **Given** historial de 30 días o más y descuento de al menos 30 % contra el mínimo de ese período,
   **When** corre el bot, **Then** envía un mensaje con el link del producto.
2. **Given** una oferta ya avisada con el mismo precio, **When** corre de nuevo, **Then** no vuelve a
   avisar.
3. **Given** varias ofertas nuevas en la misma corrida, **When** se envían, **Then** van agrupadas en un
   solo mensaje, hasta el máximo de mensajes configurado.
4. **Given** menos de 30 días de historial y un descuento declarado por el sitio de al menos 30 %,
   **When** corre el bot, **Then** avisa con el mensaje marcado "sin historial" (ver FR-009).

---

### User Story 3 - Fallar a la vista (Priority: P2)

Si Juleriaque cambia su API, bloquea al bot o devuelve datos inválidos, el bot avisa una vez por
WhatsApp y lo registra, sin quedar en silencio ni repetir el aviso en cada corrida.

**Why this priority**: sin esto el bot puede dejar de funcionar semanas sin que lo notes.

**Independent Test**: simular una respuesta 403, una 500 y un JSON vacío con fixtures; cada caso
produce un único aviso de falla y deja el historial intacto.

**Acceptance Scenarios**:

1. **Given** el sitio devuelve 403 o 429, **When** corre el bot, **Then** corta, avisa una sola vez y no
   reintenta en la misma corrida.
2. **Given** la falla persiste en corridas siguientes, **When** corre el bot, **Then** no repite el
   aviso hasta que se recupere y vuelva a fallar.

---

### Edge Cases

- Producto con `ListPrice` menor que `Price` o precio 0: se descarta como dato inválido.
- Producto que cambia de EAN o de nombre: se identifica por `productId`/SKU y el EAN se actualiza.
- Precio que sube y baja varias veces en un día: se usa el mínimo del día para el historial.
- El catálogo supera la ventana de paginación de la API: máximo 50 por pedido y `_from` ≤ 2500, con
  11.167 productos en total. Se segmenta por marca (ver plan).
- Corrida lenta: respetar pausa entre pedidos aunque alargue el tiempo total.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST leer el catálogo desde `/api/catalog_system/pub/products/search`
  paginando por rangos, sin tocar rutas bloqueadas por `robots.txt`.
- **FR-002**: El sistema MUST esperar al menos 1 segundo entre pedidos y usar un User-Agent que
  identifique al bot.
- **FR-003**: El sistema MUST normalizar cada producto a `{ id, ean, marca, nombre, tamaño,
  categoria, precioActual, precioLista, moneda, url, stock }`.
- **FR-004**: El sistema MUST guardar el precio mínimo observado por producto y por día.
- **FR-005**: El sistema MUST evaluar la ganga con la regla de la constitución §4 (condición 1 siempre;
  condición 2 cuando exista referencia internacional).
- **FR-006**: El sistema MUST notificar cada oferta una sola vez y volver a avisar solo si el precio
  baja al menos un 10 % adicional respecto del precio ya avisado.
- **FR-007**: El sistema MUST agrupar ofertas en un mensaje y respetar un máximo de mensajes por
  corrida y por día, configurable.
- **FR-008**: El sistema MUST soportar `--dry-run`: hace todo menos enviar mensajes y escribir estado.
- **FR-009**: Mientras haya menos de 30 días de historial, el sistema MUST usar el descuento declarado
  por el sitio (`ListPrice` contra `Price`, mínimo 30 %) para avisar, y MUST marcar el mensaje como
  "sin historial". Cuando el historial alcance los 30 días, pasa a la regla de la constitución §4.
- **FR-010**: El sistema MUST ignorar productos sin stock a la hora de avisar.
- **FR-011**: Ante errores del sitio MUST aplicar la historia 3 y preservar el historial.
- **FR-012**: Las credenciales MUST salir de variables de entorno (`CALLMEBOT_PHONE`,
  `CALLMEBOT_APIKEY`).

### Key Entities

- **Producto**: lo que ofrece el sitio. Identificado por ID del sitio; con EAN, marca, nombre, tamaño y
  categoría.
- **Observación de precio**: precio actual, precio de lista y stock de un producto en un día.
- **Alerta enviada**: producto, precio y fecha avisados, para no repetir.
- **Falla de fuente**: tipo de error y fecha, para avisar una sola vez.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una corrida completa recorre el 100 % del catálogo visible y termina en menos de 15
  minutos respetando las pausas.
- **SC-002**: Cero mensajes duplicados para la misma oferta con el mismo precio.
- **SC-003**: Ante cualquier falla de la fuente, llega exactamente un aviso y el historial queda intacto.
- **SC-004**: Al menos el 90 % de las alertas de prueba son ofertas que el usuario considera
  interesantes (se mide a mano durante las primeras dos semanas).
- **SC-005**: Ninguna compra ni acción de checkout es ejecutada por el bot.

## Assumptions

- Uso personal, un solo destinatario (el usuario), por CallMeBot.
- La API de catálogo seguirá siendo pública; el sondeo del 2026-10-20 mostró `Price`, `ListPrice`,
  `AvailableQuantity` y EAN sin autenticación. Sobre 50 productos, 9 ya traían descuento declarado.
- El historial se guarda fuera del scope de esta spec (decisión de plan: archivo JSON en el repo o
  Firestore).
- La referencia internacional (condición 2) se integra en una spec posterior; esta fuente funciona sin
  ella.
- Se ejecuta en GitHub Actions con `cron`; la frecuencia se define según el hallazgo de horarios.
