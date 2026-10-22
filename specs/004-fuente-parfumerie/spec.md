# Feature Specification: Fuente Parfumerie (Magento GraphQL)

**Feature Branch**: `004-fuente-parfumerie`

**Created**: 2026-10-22

**Status**: Draft

**Input**: Sumar Parfumerie (perfumería, 27 locales en shoppings) como fuente. Además de sus propias ofertas,
sirve de competidor para las demás: con sus códigos de barras, más productos de Juleriaque y Rouge pasan de
"sin referencia" a tener precio de mercado (spec 003).

## Relevamiento (2026-10-22)

- Plataforma: Magento 2. Su `robots.txt` no bloquea `/graphql` ni las páginas de producto.
- `POST https://www.parfumerie.com.ar/graphql` (el método que usa la propia tienda) responde sin credenciales.
  Con `GET` redirige y pierde la consulta.
- **6.357 productos** (`total_count`), 64 páginas de 100. 93 de cada 100 son productos simples; el resto son
  configurables con variantes por tamaño (ej. 60, 100 y 200 ml), cada una con su SKU y precio.
- Por producto: `price_range` (precio de lista y precio final), `stock_status` y `only_x_left_in_stock` (cantidad
  real solo cuando queda poco), `url_key` (el link es `https://www.parfumerie.com.ar/<url_key>`, verificado).
- **Código de barras y marca en atributos**: `gtin` (EAN-13, presente en el 93 % de una muestra de 100), `mgs_brand`
  (marca) y `tamanio_perfume`. Los atributos pesan ~4 KB por producto porque vienen junto a descripciones largas;
  el filtro `is_wysiwyg_enabled:false` las descarta y conserva `gtin` y `mgs_brand`.
- Los hijos de un configurable suelen no tener página propia (su link es el del padre), **pero algunos también figuran
  como productos simples sueltos, con su propia página** (hallado en la prueba real): se registran una sola vez por
  SKU y gana el simple.
- Cruce medido: de 100 unidades de perfumería, el 57 % de los `gtin` están en Juleriaque, el 65 % en Rouge y el
  **75 % en al menos una**.
- Costo de lectura: la lista liviana de 100 productos pesa ~40 KB y tarda ~4 s (64 pedidos, unos 6 minutos); los
  atributos de 8 productos, ~32 KB en 1,4 s.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ofertas de Parfumerie con el mismo trato que las demás (Priority: P1)

El bot lee Parfumerie en cada corrida, registra precios y avisa sus gangas con las reglas de las specs 001 a 003
(descuento contra lista, historial, línea base de la primera corrida, reventa).

**Independent Test**: con respuestas simuladas, un producto con precio final 40 % menor que el regular genera una
ganga, con su link y su puntaje de reventa.

**Acceptance Scenarios**:

1. **Given** un producto simple con precio regular $267.605 y final $164.000, **When** corre Parfumerie, **Then** es
   una oferta con 39 % de descuento y su link directo.
2. **Given** un configurable con tres tamaños, **Then** cada tamaño es una oferta propia con su precio y su
   tamaño en ml, y todas apuntan al link del producto padre.
3. **Given** `stock_status` agotado, **Then** la oferta queda sin stock y no se avisa.

---

### User Story 2 - Los atributos se piden una sola vez por producto (Priority: P1)

El código de barras y la marca casi nunca cambian, así que se piden una vez por SKU y se guardan en el historial;
las corridas siguientes solo leen la lista liviana (precio y stock).

**Independent Test**: con un historial que ya conoce los atributos de 90 productos y 10 nuevos, el bot pide los
atributos solo de los 10.

**Acceptance Scenarios**:

1. **Given** un SKU nuevo, **When** corre Parfumerie, **Then** se piden sus atributos y se guardan `ean` y `marca`.
2. **Given** un SKU ya conocido, **Then** no se piden sus atributos y se reutilizan los guardados.
3. **Given** más SKU desconocidos que el tope por corrida, **Then** se enriquecen hasta el tope y el resto sigue en
   la corrida siguiente; mientras tanto esos productos se leen igual (precio y stock), sin EAN.

---

### User Story 3 - Parfumerie como competidora de las demás (Priority: P2)

Una vez que Parfumerie tiene datos, el precio de mercado de un producto de Juleriaque o de Rouge puede salir de
Parfumerie, y viceversa.

**Acceptance Scenarios**:

1. **Given** un producto de Juleriaque cuyo EAN está en Parfumerie a un precio menor, **Then** el precio de mercado
   es el de Parfumerie y la fuente figura como "Parfumerie".

---

### Edge Cases

- Producto sin `gtin` ni marca (7 % de la muestra): se avisa igual, sin referencia posible por EAN.
- Marca desconocida (aún sin enriquecer): el nombre se muestra tal cual, sin anteponer marca.
- Un pedido de la lista que falla tras los reintentos deja la lectura parcial (comportamiento de la spec 001).
- Productos que cambian de posición entre páginas durante la lectura: se deduplica por SKU.
- La consulta de atributos devuelve menos productos de los pedidos: los faltantes quedan para la próxima corrida.
- El API de Magento limita el tamaño de página y la profundidad de paginación: se informa si el total supera lo leído.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST leer Parfumerie por `POST /graphql`, paginando la categoría raíz de a 100, con pausa
  ≥ 1 s, User-Agent propio, reintentos ante 5xx y corte ante 403/429.
- **FR-002**: El sistema MUST convertir cada producto simple y cada variante de un configurable en una oferta
  `{ id: SKU, productoId, ean, marca, nombre, ml, precioActual, precioLista, stock, url }`.
- **FR-003**: `precioActual` MUST ser el precio final y `precioLista` el regular; si el regular fuera menor, se
  iguala al final.
- **FR-004**: El link de una variante MUST ser el de su producto padre.
- **FR-005**: El stock MUST ser la cantidad real cuando el API la informa (`only_x_left_in_stock`), 0 si está
  agotado, y un marcador alto (99999) si hay stock sin cantidad; el marcador se ignora al estimar velocidad.
- **FR-006**: El sistema MUST pedir los atributos (`gtin`, `mgs_brand`) solo de los SKU que el historial no conoce,
  con un tope configurable de productos por corrida, sin descripciones, y MUST reutilizar los ya guardados.
- **FR-007**: Un producto cuyos atributos no se pudieron obtener MUST leerse igual, con `ean` y `marca` en blanco.
- **FR-008**: El cliente HTTP MUST soportar `POST` con cuerpo JSON con las mismas garantías que el `GET`.
- **FR-009**: Parfumerie MUST participar del cruce de la spec 003 (como competidora y como fuente).
- **FR-010**: El sistema MUST informar cobertura (leídos vs. `total_count`), cuántos SKU se enriquecieron y cuántos
  siguen sin atributos.

### Key Entities

- **Oferta de Parfumerie**: la forma normalizada de las specs anteriores, con `id` = SKU.
- **Atributos conocidos**: `ean` y `marca` de un SKU, guardados en el historial.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una lectura completa (lista liviana) termina en menos de 8 minutos.
- **SC-002**: Una corrida con atributos ya conocidos no pide atributos.
- **SC-003**: Tras completar el enriquecimiento, al menos el 85 % de las ofertas de Parfumerie tienen EAN.
- **SC-004**: El tamaño total de una corrida de las cinco fuentes se mantiene por debajo de 25 minutos.

## Assumptions

- El API GraphQL de la tienda seguirá abierto; hoy lo usa su propio sitio.
- El tope inicial es 1.500 productos por corrida para los atributos: el enriquecimiento completo toma unas 5
  corridas (unos 2,5 días); en ese lapso el cruce de Parfumerie con las demás va ganando cobertura.
- Moov y Dexter (Salesforce Commerce Cloud) quedan para una spec posterior; hay que verificar qué entregan.
