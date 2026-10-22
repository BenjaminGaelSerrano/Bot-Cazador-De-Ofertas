# Feature Specification: Puntaje de reventa con datos propios

**Feature Branch**: `003-reventa`

**Created**: 2026-10-22

**Status**: Draft (a validar con el usuario)

**Input**: El usuario pidió saber, para cada oferta, si realmente es buen negocio para revender: compararla
con un precio de referencia externo y con la cantidad de ventas. Se revende en Argentina. El usuario pidió
**no depender de Mercado Libre**, así que esta spec arma el puntaje con datos que el bot ya obtiene y con
fuentes abiertas. Mercado Libre queda como proveedor opcional futuro.

## Qué se puede y qué no sin Mercado Libre (relevamiento del 2026-10-22)

| Dato | ¿Sin Mercado Libre? | Cómo |
|------|---------------------|------|
| **Precio de mercado local** (a cuánto lo vende otra tienda) | **Sí** | Cruce de las tiendas que el bot ya lee, por código de barras (EAN) |
| Precio retail internacional | Sí | PriceRunner UK para perfumes (`docs/referencias.md`); para sneakers y gorras, Stadium Goods y neweracap.com (Shopify abiertos) |
| **Velocidad de venta en la tienda** | Sí, a medida que pasan los días | Seguir la cantidad de stock en cada corrida: lo que baja es lo que se vende |
| **Ventas reales en reventa** (cuántas unidades se venden en el mercado secundario) | **No hay fuente abierta** | StockX, GOAT, eBay y Mercado Libre responden 403 sin credenciales; el API oficial de StockX no incluye ventas |

La "probabilidad de reventa" sin Mercado Libre es entonces una **estimación** a partir de demanda minorista y
escasez, no una medición del mercado secundario. El aviso lo dice así.

## Evidencia del cruce entre tiendas (datos reales del 2026-10-22)

- Juleriaque y Rouge comparten **4.988 productos** identificados por EAN (88 % y 78 % de sus SKU traen EAN).
  Otros 1.664 coinciden por marca, tamaño y nombre.
- De esos 4.988: en el **72 %** el precio es idéntico (precios de lista coordinados por la marca), en el 12 %
  difiere 1 a 10 %, en el 6 % entre 10 y 30 %, y en el **10 % (513 productos) una tienda es 30 % o más barata**.
- Ejemplo que valida los descuentos declarados: CK One EDT 200 ml está $143.000 en Juleriaque y **$286.000 en
  Rouge**; ese $286.000 es el precio de lista de Juleriaque. El descuento es real y el precio de mercado es
  $286.000. También ocurre al revés: Dior Eau Sauvage Extreme está $145.057 en Rouge y $276.300 en Juleriaque.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Confirmar que el descuento es real (Priority: P1)

Cuando una oferta es ganga y otra tienda vende el mismo producto, el mensaje lo dice: "Rouge lo vende a
$286.000". Si el competidor vende al precio de lista, el descuento queda confirmado; si vende más barato, la
oferta se degrada.

**Why this priority**: descarta de entrada las listas infladas, que era la duda sobre los descuentos
del -65 %, y no requiere ninguna credencial.

**Independent Test**: con dos tiendas simuladas que comparten un EAN, una ganga cuyo competidor vende a la
lista sale "confirmada"; una cuyo competidor ya vende más barato sale degradada.

**Acceptance Scenarios**:

1. **Given** una ganga a $143.000 con lista $286.000 y otra tienda vendiendo el mismo EAN a $286.000,
   **Then** el aviso muestra "precio de mercado $286.000 (Rouge)" y la marca como confirmada.
2. **Given** una ganga a $145.000 y otra tienda vendiendo el mismo EAN a $120.000, **Then** el aviso no la
   da como buena oferta y dice que hay una tienda más barata.
3. **Given** un producto sin equivalente en otra tienda, **Then** dice "sin referencia de otra tienda".

---

### User Story 2 - Margen estimado de reventa (Priority: P1)

El mensaje muestra cuánto ganarías al revender al precio de mercado local, descontando los costos del canal
de venta que el usuario configure.

**Independent Test**: con costo, precio de mercado y comisión conocidos, el margen coincide con la fórmula.

**Acceptance Scenarios**:

1. **Given** compra a $143.000, precio de mercado $286.000 y comisión 15 %, **Then** el aviso muestra un
   precio de reventa competitivo (por debajo del de mercado), el margen neto y el veredicto.

---

### User Story 3 - Índice de demanda (Priority: P2)

El bot registra la cantidad de stock de cada producto en cada corrida y estima cuán rápido se vende. Un
producto con descuento, poco stock y salida rápida puntúa mejor que uno con stock abundante y quieto.

**Independent Test**: con un historial simulado de stock que baja 10 unidades por día, el índice es alto;
con stock constante, es bajo; con el stock "infinito" (99999) del sitio, no se calcula.

**Acceptance Scenarios**:

1. **Given** stock que baja de 20 a 6 en 3 días, **Then** el índice de demanda es alto.
2. **Given** un producto con stock 99999 (sin dato real), **Then** no hay índice y el aviso lo omite.
3. **Given** menos de 3 días de historial de stock, **Then** dice "sin dato de velocidad todavía".

---

### User Story 4 - Referencia internacional (Priority: P3)

Cuando exista, se agrega el precio retail en el exterior (PriceRunner UK u otra) como segundo punto de
comparación. Se trata en su propia spec.

## Modelo de puntaje (propuesta a validar)

- **Precio de mercado local** = el menor precio vigente, con stock, entre las *otras* tiendas para el mismo
  producto (EAN, o marca + tamaño + nombre si no hay EAN). Se usa el menor porque es el que fija el techo:
  nadie le compra más caro a un revendedor que a la tienda.
- **Precio de reventa** = precio de mercado × (1 − descuento competitivo configurable, por defecto 5 %).
- **Ingreso neto** = precio de reventa × (1 − comisión del canal) − costo de envío estimado.
- **Margen** = (ingreso neto − costo de compra) / costo de compra.
- **Índice de demanda** (0 a 1) a partir de la velocidad de agotamiento y la escasez; sin dato → no se usa.
- **Veredicto**: *buena* si margen ≥ 30 % y (demanda ≥ 0,5 o sin dato de demanda con margen ≥ 40 %);
  *regular* si margen ≥ 15 %; *evitar* si hay una tienda más barata o el margen es menor.

Todos los umbrales van a configuración. Son una heurística, no una predicción.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST emparejar productos entre tiendas por EAN, y por marca + tamaño + nombre
  normalizado cuando no haya EAN, descartando coincidencias dudosas.
- **FR-002**: El sistema MUST calcular el precio de mercado local solo con ofertas de otras tiendas con
  stock, y MUST indicar cuál tienda lo fija.
- **FR-003**: El sistema MUST usar el último precio registrado de las otras tiendas (sin pedidos extra al
  sitio) e indicar que puede tener hasta una corrida de antigüedad.
- **FR-004**: El sistema MUST registrar el stock numérico por corrida y MUST ignorar los valores de stock
  que son marcadores (ej. 99999) al estimar velocidad.
- **FR-005**: El mensaje MUST incluir precio de mercado, margen y veredicto sin superar los topes de largo de
  la constitución §5 (650 caracteres crudos por mensaje).
- **FR-006**: Si no hay dato confiable, el sistema MUST decirlo y MUST NOT inventar un número.
- **FR-007**: La comisión del canal, el costo de envío estimado y los umbrales MUST ser configurables.
- **FR-008**: Cada aviso con puntaje MUST registrarse para contrastarlo después con lo que realmente se vendió.
- **FR-009**: Los proveedores de datos MUST ser enchufables, de modo que Mercado Libre, PriceRunner o
  StockX puedan agregarse sin tocar el resto.

### Key Entities

- **Producto comparable**: mismo EAN (o marca + tamaño + nombre) en distintas tiendas.
- **Mercado local de un producto**: precios y stock vigentes en las otras tiendas.
- **Puntaje de reventa**: precio de mercado, precio de reventa, margen, demanda, veredicto, confianza.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ningún aviso inventa un dato: o hay una tienda que lo respalda o dice "sin referencia".
- **SC-002**: Con los datos del 2026-10-22, al menos el 90 % de los 4.988 EAN en común se emparejan sin error.
- **SC-003**: Los avisos con puntaje caben en los topes de largo de mensaje.
- **SC-004**: Agregar el puntaje no agrega pedidos a los sitios (usa los datos ya leídos).

## Assumptions

- Se revende en Argentina; el canal y su comisión los define el usuario (no están verificados).
- El precio de otra tienda es una buena aproximación del precio al que se puede revender, porque quien
  compra elige la opción más barata. Es una hipótesis: Mercado Libre mediría el precio real de reventa.
- Hoy el cruce funciona entre Juleriaque y Rouge (perfumería y cosmética). Grid y New Era no traen EAN y no
  tienen competidor entre las fuentes actuales; para ropa y calzado hará falta sumar Moov y Dexter.
- Los productos exclusivos de una sola tienda (por ejemplo, una colección propia) no tendrán referencia.

## Mercado Libre y StockX como proveedores opcionales (futuro)

- **Mercado Libre**: mide el precio y las ventas reales de reventa. Requiere registrar una app propia
  (todo el API devuelve 403 sin credenciales). Se agrega como proveedor si el usuario quiere más precisión.
- **StockX**: solo sneakers, ropa y gorras; requiere aprobación; sin ventas ni ARS. Prioridad baja.
