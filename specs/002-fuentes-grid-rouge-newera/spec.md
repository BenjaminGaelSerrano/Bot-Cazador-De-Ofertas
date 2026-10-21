# Feature Specification: Fuentes Grid, Rouge y New Era

**Feature Branch**: `002-fuentes-grid-rouge-newera`

**Created**: 2026-10-20

**Status**: Draft

**Input**: Sumar tres fuentes al bot, reutilizando el núcleo de la spec 001: Grid (Nike, Jordan, NBA;
VTEX), Rouge (perfumería; VTEX) y New Era (gorras; Shopify).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recibir ofertas de las tres tiendas nuevas (Priority: P1)

El bot lee Grid, Rouge y New Era en cada corrida y avisa sus gangas por WhatsApp con las mismas reglas
que Juleriaque (constitución §4), cada tienda con su propio título de mensaje.

**Why this priority**: es el objetivo de la spec.

**Independent Test**: cada fuente se prueba sola con `--fuente grid --dry-run`, y con fixtures sin red.

**Acceptance Scenarios**:

1. **Given** un buzo con 5 talles al mismo precio y 30 % de descuento, **When** corre Grid, **Then** llega
   **un** aviso del producto, no cinco.
2. **Given** un perfume de Rouge con dos tamaños y solo uno en oferta, **When** corre Rouge, **Then** el
   aviso es del tamaño en oferta.
3. **Given** una gorra de New Era que baja 30 % contra su mínimo de 30 días, **When** corre New Era,
   **Then** llega el aviso con el link a la gorra.
4. **Given** productos sin stock, **When** corre cualquier fuente, **Then** no hay aviso.

---

### User Story 2 - Una fuente caída no frena a las otras (Priority: P1)

Si una tienda bloquea o falla, las demás se leen igual, y la falla se avisa una sola vez.

**Why this priority**: con cuatro fuentes, una falla es probable; no debe apagar todo.

**Independent Test**: simular una fuente que lanza 429 y verificar que las demás corren, que hay un único
aviso de falla y que la corrida termina con error (queda en rojo en GitHub).

**Acceptance Scenarios**:

1. **Given** Grid devuelve 429, **When** corren las cuatro fuentes, **Then** Juleriaque, Rouge y New Era
   se procesan y llega un aviso de falla de Grid.
2. **Given** Grid sigue fallando en la corrida siguiente, **Then** no se repite el aviso.

---

### User Story 3 - Tope de mensajes compartido (Priority: P2)

El total de WhatsApp por corrida tiene un tope único, para no saturar a CallMeBot (límite no publicado).

**Why this priority**: con cuatro fuentes, el tope por fuente podría sumar 12 mensajes en una corrida.

**Independent Test**: con ofertas de sobra en todas las fuentes, una corrida nunca supera el tope total y
lo que no se avisó queda para la siguiente.

**Acceptance Scenarios**:

1. **Given** el tope total es 5 y Juleriaque usa 3, **When** corre Grid, **Then** Grid puede usar hasta 2.
2. **Given** se agotó el tope, **Then** las fuentes restantes igual registran precios, y sus ofertas
   quedan pendientes (sin marcar como avisadas).

---

### Edge Cases

- Gift cards de Rouge (categoría `giftcards`) y de cualquier tienda: se excluyen.
- Producto sin ningún SKU con stock: se registra su precio, no avisa.
- SKU en promoción exclusiva sin stock (ej. "Promo 150ml" de Rouge): el precio se registra pero sin stock no avisa.
- Shopify devuelve el mismo producto en dos páginas si el catálogo cambia durante la lectura: se deduplica.
- Catálogo de Grid que supere los 2.550 productos: se lee con dos órdenes (ya soportado) o se subdivide.
- New Era no tiene descuentos declarados hoy: hasta tener 30 días de historial no habrá avisos de esa tienda.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST leer Grid y Rouge por la API VTEX y New Era por `/products.json`, respetando
  pausa ≥ 1 s, User-Agent propio y corte ante 403/429.
- **FR-002**: Para Grid y New Era MUST agrupar por producto: un solo ítem con el precio más bajo entre los
  talles con stock, su precio de lista y el stock total.
- **FR-003**: Para Rouge MUST mantener un ítem por SKU (cada tamaño tiene precio propio).
- **FR-004**: El sistema MUST excluir por configuración las categorías que no son productos de venta
  (gift cards).
- **FR-005**: El sistema MUST aplicar a las tres fuentes la misma regla de ganga, deduplicación de avisos
  (10 % adicional) y manejo de fallas de la spec 001.
- **FR-006**: El comando MUST aceptar varias fuentes (`--fuente juleriaque,grid` o `--fuente todas`),
  procesarlas en orden, continuar tras una falla y terminar con código de error si alguna falló.
- **FR-007**: El sistema MUST aplicar un tope total de mensajes por corrida (configurable, 5 por defecto)
  además del tope por fuente.
- **FR-008**: El workflow MUST correr las cuatro fuentes en cada ejecución programada.
- **FR-009**: Cada fuente MUST informar cobertura (productos leídos vs. total del sitio) y avisar si queda
  truncada o incompleta.

### Key Entities

- **Oferta** (igual que en 001): `{ id, productoId, ean, marca, nombre, ml, categoria, precioActual,
  precioLista, moneda, url, stock }`. En fuentes agrupadas por producto, `id` es el id del producto.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una corrida completa de las cuatro fuentes termina en menos de 25 minutos.
- **SC-002**: Un producto con varios talles genera como máximo un aviso por cambio de precio.
- **SC-003**: Una fuente con falla no impide que las otras tres se procesen en la misma corrida.
- **SC-004**: El total de WhatsApp de una corrida nunca supera el tope total configurado.
- **SC-005**: El consumo mensual de Actions con 2 corridas por día queda por debajo de 1.200 minutos.

## Assumptions

- Hoy (2026-10-20): Grid 2.140 productos, Rouge 4.836, New Era 924. Las APIs públicas siguen abiertas.
- Las categorías de Rouge se relevaron desde los datos de los productos, como en Juleriaque; 10 de 4.836
  productos quedan fuera de las raíces conocidas (0,2 %, bajo la tolerancia).
- Parfumerie, Moov y Dexter (requieren HTML) quedan para otra spec.
- La referencia internacional (PriceRunner UK) es otra spec posterior.
