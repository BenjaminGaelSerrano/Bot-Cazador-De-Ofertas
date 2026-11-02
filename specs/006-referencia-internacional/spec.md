# Feature Specification: Referencia internacional como filtro de ganga

**Feature Branch**: `006-referencia-internacional`

**Created**: 2026-11-02

**Status**: Aprobada (2026-11-02)

**Input**: la constitución (§4, condición 2) pide que una ganga esté por debajo de una referencia internacional, pero
nunca se implementó: hoy solo se evalúa el historial propio y la reventa contra otras tiendas argentinas. El usuario
pidió replantear de dónde sale el valor de referencia y eligió (2026-11-02):

- **Fuente:** las dos, la API de eBay como principal y Perfumania (EE. UU.) como respaldo para perfumes.
- **Rol:** **filtro de ganga**: si el precio argentino no está por debajo de la referencia internacional, no se avisa.
- **Ajuste:** **ninguno**: dólares × dólar blue, sin sumar impuestos ni costos de importación.

## Relevamiento (2026-11-02)

- **PriceRunner UK, descartado.** Sus términos (`pricerunner.com/info/terms`) dicen: *"The framing, mirroring,
  scraping or data mining of the Site… will not be permitted"* y limitan el uso a *"your own private use"*. Rompe la
  regla de no evadir ni usar fuentes que lo prohíben.
- **Perfumania (Shopify, USD):**
  - `robots.txt` no bloquea `/products/` ni `/search/suggest.json`.
  - Los términos permiten usar el sitio para *"personal, non-commercial use only"*. El bot es de uso personal, pero
    sirve a un negocio de reventa: **riesgo aceptado por el usuario**, anotado acá para revisarlo si cambia algo.
  - La ficha `GET /products/<handle>.json` trae cada tamaño con `price`, `compare_at_price` y **`barcode`**. Ejemplo:
    1 Million EDT 3.4 oz, `barcode 3349666007921`, US$104,95, que es **el mismo EAN** que Juleriaque usa para
    "One Million EDT 100 ml" ($224.525). El emparejado puede ser por código de barras, igual que el cruce local.
  - El listado `products.json` **no** trae `barcode`. La búsqueda `search/suggest.json?q=` devuelve título, precio
    mínimo y `handle`.
  - Hay variantes **Tester** (1 Million 3.4 oz Tester a US$62) y combos ("Bundle Deal"): no sirven como referencia.
  - Después de unos 5 pedidos seguidos, el sitio respondió `local_rate_limited`: **hay que ir despacio**.
- **API de eBay (Browse API):** busca por `gtin` y filtra por condición nueva. Pero **el acceso de producción a las
  Buy APIs requiere la aprobación de eBay** (eBay Partner Network), sin garantía de obtenerla. El *sandbox* es libre,
  pero no tiene datos reales. Su licencia de 2025 trata los datos de precios como "Restricted APIs". **No se puede
  implementar hasta que eBay apruebe la cuenta**: queda como fase 2.
- **Ejemplo con datos reales** (dólar blue medio $1.555, 2026-11-02): One Million EDT 100 ml en Perfumania sale
  US$104,95 → **$163.200**. Juleriaque lo vende a $224.525, así que solo sería ganga si baja a $163.200 o menos
  (−27 %). Combinado con la condición 1 (−30 % sobre su propio mínimo), el filtro es exigente pero no imposible.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - No se avisa una "ganga" que es cara en el mundo (Priority: P1)

Un perfume que bajó 30 % en Juleriaque pero sigue saliendo más caro que en EE. UU. no se avisa.

**Why this priority**: es la condición 2 de la constitución, que hoy no se aplica.

**Independent Test**: con una referencia simulada de US$104,95 y dólar $1.555 ($163.200), una oferta de $170.000
que cumple la condición 1 no es ganga, y una de $160.000 sí.

**Acceptance Scenarios**:

1. **Given** una oferta por encima de la referencia en pesos, **Then** no es ganga y no se avisa.
2. **Given** una oferta igual o por debajo de la referencia, **Then** sigue el camino de siempre (reventa, tabla).
3. **Given** un producto sin referencia internacional, **Then** se evalúa solo la condición 1 y el aviso lo indica.

---

### User Story 2 - La referencia se empareja por código de barras (Priority: P1)

**Acceptance Scenarios**:

1. **Given** el mismo EAN en la oferta y en una variante de Perfumania, **Then** esa variante es la referencia.
2. **Given** una variante "Tester", un combo o un set, **Then** se ignora.
3. **Given** que ningún código coincide pero hay una variante de la misma marca, el mismo nombre, la misma
   concentración (EDP, EDT, Parfum…) y el mismo tamaño (oz pasadas a ml, ±4 %), **Then** esa es la referencia y la
   fila lleva `~` (decisión del usuario, 2026-11-02). Si la concentración de alguno de los dos no se conoce, no se
   empareja.
4. **Given** una oferta que no es un perfume (maquillaje, tratamiento, calzado), **Then** no se busca y la fila lleva `*`.

---

### User Story 3 - El bot no abusa de Perfumania (Priority: P1)

**Acceptance Scenarios**:

1. **Given** una corrida, **Then** se hacen como mucho `maxPedidosPorCorrida` pedidos, con pausa entre ellos.
2. **Given** una respuesta `local_rate_limited` o 429, **Then** se deja de consultar en esa corrida (sin reintentos)
   y lo que faltó se busca en la corrida siguiente.
3. **Given** una oferta que no se llegó a consultar (cupo o bloqueo), **Then** se avisa igual con `*`
   (`avisarSinConsultar: true`). Motivo, medido el 2026-11-02: Perfumania bloquea después de 2 o 3 pedidos (aun con
   8 s entre ellos) durante ~25 minutos; si lo no consultado esperara, los perfumes dejarían de avisarse. Con
   `avisarSinConsultar: false` espera a la corrida siguiente. Como nada queda silenciado, un bloqueo no se avisa
   como falla.
4. **Given** una referencia vista hace menos de `vigenciaDias`, **Then** se usa la guardada sin pedir de nuevo.

---

### User Story 4 - eBay como fuente principal (Priority: P3, bloqueada)

Cuando eBay apruebe el acceso: búsqueda por `gtin` en `EBAY_US`, solo productos nuevos a precio fijo, y la
referencia es la **mediana** de los primeros resultados (un mínimo lo movería un vendedor dudoso). Si eBay tiene
referencia, se usa esa; si no, la de Perfumania.

## Cómo se busca una referencia

1. Solo se busca para ofertas que **ya cumplen la condición 1** y tienen EAN válido (pocas por corrida).
2. Si hay una referencia guardada vigente para ese EAN, se usa.
3. Si no, se busca en Perfumania con `search/suggest.json` usando marca + nombre, y se piden las fichas de los
   primeros resultados hasta encontrar una variante con el mismo `barcode`. Si ninguna coincide, se guarda como
   "sin referencia" (también vigente por `vigenciaDias`, para no repetir la búsqueda).
4. Precio de referencia: el `price` actual de la variante (no el `compare_at_price`), × dólar blue medio de
   dolarapi.com. Sin ajuste.
5. Se guarda en la rama `datos`, en `referencias/perfumania.json`: `{ ean: { precioUSD, url, visto } }` o
   `{ ean: { sinReferencia: true, visto } }`.

## Requisitos

- **R1.** `evaluar` (en `src/nucleo/ganga.mjs`) ya acepta `referencia` en pesos: `correr.mjs` se la tiene que pasar.
- **R2.** Configuración nueva en `config.internacional`: `vigenciaDias` (14), `avisarSinConsultar` (true) y, en
  `perfumania`, `pausaMs` (30 s), `maxPedidosPorCorrida` (6), `resultadosBusqueda` (3), `toleranciaMl` (4 %).
- **R3.** Si dolarapi.com falla, no se aplica la condición 2 en esa corrida (y se registra). Nunca se usa un dólar
  inventado.
- **R4.** Tests con fixtures guardadas (sugerencias, ficha con Tester y combos, respuesta `local_rate_limited`).
- **R5.** `--dry-run` no escribe `referencias/` ni manda mensajes.
- **R6.** Antes de implementar, cambiar la constitución §4 en un commit aparte: fuente de referencia (Perfumania y
  eBay en vez de PriceRunner) y "sin ajuste" en lugar del `PENDIENTE` sobre impuestos.

## Cómo se ve en el WhatsApp (decisión del usuario, 2026-11-02)

Un carácter delante del nombre, en el lugar del espacio que lo separaba del número (la fila no se alarga):

```
 #  Producto          Costo  Merc.  Gana
 1 INVICTUS PARFUM 50  157k   313k  +90%    ← debajo del precio de EE. UU. (por código de barras)
 2~PHANTOM INTENSE 10  151k   301k  +90%    ← debajo del precio de EE. UU. (por nombre, aproximado)
 3*JORDAN SESSION       80k  ~200k +138%    ← sin precio de EE. UU. (solo historial)
```

La leyenda dice `~ = aproximado · * = sin precio EE.UU.`. El `~` significa lo mismo en las dos columnas: cruce
aproximado (por modelo en la de mercado, por nombre en la de EE. UU.).

## Reenvío de lo ya avisado

`node src/reenviar.mjs --fecha AAAA-MM-DD` toma lo avisado ese día (`avisos.jsonl`), le aplica el filtro y vuelve a
mandar lo que pasa, con el título "Reenvío". No toca `alertas.json` (las ofertas ya estaban avisadas). Lo que se
filtró por caro se lista en la consola.

## Fuera de alcance

- Calzado, ropa y gorras: Perfumania es solo perfumería. Para ellos queda eBay (fase 2) o `neweracap.com` en otra spec.
- Cambiar cómo se calcula la reventa: sigue con el cruce entre tiendas argentinas (spec 003).
