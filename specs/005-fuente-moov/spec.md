# Feature Specification: Fuente Moov y cruce por modelo (calzado)

**Feature Branch**: `005-fuente-moov`

**Created**: 2026-10-22

**Status**: Implementada (2026-10-22)

**Input**: Grid (Nike, Adidas, New Balance, Puma...) no tenía con quién compararse, así que sus ofertas salían
"sin referencia". Moov es otra tienda de las mismas marcas. Esta spec suma Moov como fuente y como competidora, y
agrega un cruce **por nombre de modelo** para ropa y calzado, donde no hay códigos de barras en común.

## Relevamiento (2026-10-22)

- Moov, Dexter, Stock Center, New Balance y Puma corren Salesforce Commerce Cloud. Moov y Dexter comparten el
  catálogo `365-dabra` (mismas imágenes y rutas), así que Dexter probablemente repite lo que muestra Moov: se usa
  solo Moov.
- Su `robots.txt` no bloquea el listado (solo cuenta, carrito, checkout y similares).
- Listado: `GET /on/demandware.store/Sites-Moov-Site/default/Search-UpdateGrid?cgid=<categoria>&start=N&sz=48`
  devuelve un fragmento HTML con 48 productos (~350 KB, ~5 s). Categorías: `hombre-calzado` (entre 530 y 960
  productos), `mujer-calzado` (similar).
- Cada producto trae: `data-pid` (código del fabricante con prefijo de marca, ej. `PU634563-01`), nombre, link, precio
  actual (`class="sales"`, atributo `content`) y, si hay descuento, el precio de lista (`class="strike-through list"`).
  No muestra agotados. **No hay código de barras** en la grilla ni en el JSON-LD de la ficha (sí `sku` y `mpn`).
- Grid y Moov **no comparten identificador**: Grid solo expone códigos internos (`316-0836`) y los EAN por talle.
  Sporting no tiene EAN (el campo vale `null`); Open Sports y Digital Sport devuelven 403.
- **Prototipo con datos reales**: 384 zapatillas de Moov (4 páginas por género) contra las 626 de Grid: **137
  emparejan por modelo**, y los pares que se revisaron a mano son correctos (Superstar II, Samba OG, Air Force 1 '07,
  Campus 00s, Puma-180 Pro, Forum Low, Air Jordan 1 Low).
- Diferencias de precio reales encontradas: Air Force 1 '07 hombre $259.999 en Moov y $124.999 en un modelo de Grid;
  Puma-180 Pro $179.999 contra $107.999; Samba XLG $209.999 contra $167.999 y $75.999; y al revés, Campus 00s
  $124.999 en Moov (lista $179.999) contra $179.999 en Grid.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Las ofertas de Grid se comparan con Moov (Priority: P1)

Cuando una zapatilla de Grid es ganga y Moov vende el mismo modelo, el aviso muestra el precio de Moov y el
veredicto de reventa, marcando que el emparejado fue por nombre (aproximado).

**Why this priority**: es lo que faltaba: sin esto, Grid sale siempre "sin referencia".

**Independent Test**: con un catálogo simulado de Moov que contiene "Zapatillas Nike Air Force 1 '07 Hombre" a
$259.999 y una oferta de Grid "ZAPATILLAS NIKE SPORTSWEAR AIR FORCE 1 '07 HOMBRE" a $124.999, el aviso trae
"Mercado ~$259.999 (Moov)" y un margen.

**Acceptance Scenarios**:

1. **Given** el mismo modelo en Moov y en Grid, **Then** el precio de mercado de la oferta de Grid es el de Moov.
2. **Given** modelos con nombres parecidos pero no iguales (Superstar II y Superstar II Cuero), **Then** no se emparejan.
3. **Given** una zapatilla de mujer en Grid y la misma de hombre en Moov, **Then** no se emparejan; una unisex
   empareja con cualquiera.
4. **Given** que Moov vende más barato, **Then** la oferta de Grid se evalúa "evitar" y no se avisa.

---

### User Story 2 - Moov también es una fuente de ofertas (Priority: P1)

El bot lee el calzado de Moov en cada corrida y avisa sus gangas (descuento contra la lista tachada), con las mismas
reglas que las demás tiendas, comparadas contra Grid.

**Acceptance Scenarios**:

1. **Given** una zapatilla con precio de lista tachado un 30 % o más sobre el actual, **Then** es una oferta.
2. **Given** que la lectura de una página falla tras los reintentos, **Then** la lectura queda parcial (spec 001).

---

### User Story 3 - El aviso dice que el cruce es aproximado (Priority: P2)

Un emparejado por nombre es menos seguro que uno por código de barras, y el mensaje lo muestra con un `~` delante
del precio de mercado.

**Acceptance Scenarios**:

1. **Given** un cruce por EAN, **Then** el precio de mercado va sin marca. **Given** un cruce por modelo, **Then** va
   con `~`.

## Modelo de emparejado por nombre

- **Marca**: se detecta en el nombre o en el campo marca contra una lista conocida (Nike y Nike Sportswear son Nike;
  Adidas, Adidas Originals y Adidas Performance son Adidas; etc.). Sin marca conocida no hay clave.
- **Modelo**: el nombre sin acentos ni apóstrofos, sin la marca, sin palabras genéricas (zapatillas, de, para, running,
  moda...) y sin el género; las palabras restantes, ordenadas, forman la clave. Dos productos emparejan si la marca y
  la clave son **idénticas** (conservador: prefiere no emparejar a emparejar mal).
- **Género** (hombre, mujer, unisex, niños): se toma del nombre o de la categoría. Dos productos son compatibles si
  tienen el mismo género o si alguno es unisex o no lo informa.
- Si hay varios en la otra tienda, el precio de mercado es el menor, como con los códigos de barras.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST leer el calzado de Moov (`hombre-calzado` y `mujer-calzado`) por el listado de la
  tienda, paginando de a 48 hasta una página vacía, con pausa ≥ 1 s, User-Agent propio, reintentos ante 5xx y corte
  ante 403/429.
- **FR-002**: Cada producto MUST convertirse en una oferta `{ id: pid, nombre, marca, precioActual, precioLista,
  stock, url, genero }`; el precio de lista es el tachado si existe, o el actual si no.
- **FR-003**: El stock MUST ser un marcador alto (99999), porque la grilla solo lista productos disponibles y no
  informa cantidades.
- **FR-004**: El sistema MUST calcular una clave de modelo y un género para las ofertas de ropa y calzado (Grid y
  Moov) y guardarlos en el historial.
- **FR-005**: El cruce MUST probar en orden EAN, nombre (perfumería) y modelo; solo el último se marca aproximado.
- **FR-006**: El cruce por modelo MUST respetar la compatibilidad de género y MUST NOT emparejar claves distintas.
- **FR-007**: El mensaje MUST mostrar `~` antes del precio de mercado cuando el cruce no sea por código de barras.
- **FR-008**: Moov MUST participar del cruce como competidora de Grid, y Grid como competidora de Moov.
- **FR-009**: El sistema MUST informar cobertura y cuántas ofertas lograron clave de modelo.

### Key Entities

- **Clave de modelo**: marca + palabras distintivas del nombre, ordenadas. Identifica un modelo, no un color ni un talle.
- **Género**: h, m, u (unisex) o n (niños).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Con los datos del 2026-10-22, el emparejado por modelo no produce pares de modelos distintos en una
  revisión manual de 20 pares.
- **SC-002**: Al menos el 30 % de las zapatillas de Moov tienen par en Grid (el prototipo dio 36 %).
- **SC-003**: La lectura de Moov (dos categorías) termina en menos de 8 minutos (real: 0,8 minutos).
- **SC-004**: Ninguna oferta de Grid con par en Moov sale "sin referencia".

## Assumptions

- La grilla de Moov lista solo productos con stock.
- Una misma zapatilla tiene aproximadamente el mismo precio en todos sus colores en cada tienda; los colores en
  liquidación de una tienda son justamente las oportunidades.
- Solo calzado en esta primera versión; la indumentaria (más productos y nombres más genéricos) queda para después.
- Dexter se omite por compartir catálogo con Moov; Stock Center, New Balance y Puma quedan para después.
