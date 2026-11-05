# Constitución — Cazador de ofertas

Reglas del proyecto. Todo spec, plan y tarea se contrasta contra este documento.
Estado: **borrador v0.1** (2026-10-20). Lo marcado como `PENDIENTE` se decide en la fase de spec.

## 1. Propósito

Bot personal que vigila precios online de perfumería y ropa en marcas y locales con fuerte presencia
en shoppings de Buenos Aires, detecta gangas reales y las avisa por WhatsApp con el link directo.
La compra la hace siempre la persona.

## 2. Principios no negociables

1. **Humano en el circuito.** El bot nunca compra, nunca completa un checkout y nunca guarda datos de
   pago. Su salida es una notificación con el link al producto.
2. **Uso personal.** Es una herramienta para uso propio, no un servicio para terceros. Esto además lo
   exige el plan gratuito de CallMeBot.
3. **Buen ciudadano con los sitios.** Se respeta `robots.txt`, se limita la frecuencia de pedidos, se
   identifica el bot con un User-Agent honesto y se prefieren feeds o APIs públicas (JSON de catálogo)
   antes que parsear HTML. No se evaden captchas, logins, ni bloqueos.
4. **Ganga = dato, no impresión.** Una oferta solo se avisa si cumple la regla de la sección 4. Menos
   avisos y más confiables.
5. **Una alerta, una vez.** Cada oferta se notifica una sola vez; se vuelve a avisar solo si el precio
   baja de forma material (`PENDIENTE`: umbral).
6. **Fallar a la vista.** Si una fuente se rompe (cambió el sitio, bloqueo, respuesta vacía), el bot
   avisa una vez por WhatsApp y lo registra. Nunca queda en silencio.
7. **Secretos fuera del repo.** Claves y teléfonos viven en variables de entorno o secrets de GitHub.
   Se versiona solo `.env.example`.
8. **Simple primero.** Se reutiliza lo ya probado en Fraganzia (Node, GitHub Actions con `cron`,
   CallMeBot, `--dry-run`). Cada pieza nueva necesita una razón.

## 3. Arquitectura

```
fuentes (un adaptador por marca)  →  normalizar  →  historial de precios
                                                  →  regla de ganga  →  notificar (WhatsApp)
```

- **Adaptador por fuente.** Cada marca es un módulo aislado con una interfaz común: devuelve productos
  `{ id, marca, nombre, categoria, precioActual, precioLista, moneda, url, stock }`. Agregar o quitar
  una marca no toca el resto.
- **Pruebas con fixtures.** Cada adaptador se prueba con respuestas guardadas, sin pegarle al sitio real.
- **Modo `--dry-run`** obligatorio: ejecuta todo menos enviar y escribir estado.
- **Stack inicial:** Node 22 (ESM), GitHub Actions como programador. `PENDIENTE`: dónde se guarda el
  historial (archivo JSON versionado en el repo, o Firestore como en Fraganzia).

## 4. Definición de ganga

Una oferta es ganga solo si cumple **las dos** condiciones:

1. **Contra su propio historial:** descuento de al menos **30 %** respecto del precio mínimo de los
   últimos **30 días** observados por el bot.
2. **Contra el mercado internacional:** el precio está por debajo de la referencia internacional de
   su categoría, convertido a pesos.

Detalles de la referencia internacional (spec 006, decisión del usuario del 2026-11-02):
- **Perfumes: Perfumania (EE. UU., USD)**, emparejado por código de barras y, si no hay, por marca + nombre +
  concentración + ml (aproximado, marcado con `~`). **API de eBay** como fuente principal cuando eBay apruebe el
  acceso. Calzado, ropa y gorras todavía no tienen referencia internacional.
- **PriceRunner UK quedó descartado**: sus términos prohíben el scraping y el uso no privado.
- La conversión es **dólares × dólar blue medio** (dolarapi.com), **sin ajuste** por impuestos ni importación.
  Si no hay dólar, la condición 2 no se aplica en esa corrida.
- Mientras el historial tenga menos de 30 días, la condición 1 no se puede evaluar: el bot usa el
  descuento declarado por el sitio (mínimo 30 %) y marca el aviso como **"sin historial"**.
- Si un producto no tiene referencia internacional, se evalúa solo la condición 1 y la fila del aviso lleva `*`.
- Las fuentes de referencia se consultan despacio y solo para lo que se va a avisar; ante un bloqueo (429) se deja
  de consultar en esa corrida y lo que quedó sin consultar se avisa en la siguiente.

### Reventa (spec 003)

Además de ser ganga, cada oferta se juzga como negocio de reventa (se revende por Instagram, sin comisión):

- **Precio de mercado: eBay EE. UU.** (spec 007, decisión del usuario del 2026-11-02). El precio de otra tienda
  argentina resultó inflado 2 a 3 veces respecto de EE. UU. (es su precio de lista), así que no sirve como mercado. Se
  consulta la API oficial de eBay (Browse) solo por los productos en oferta: por código de barras; si no hay, por código
  de modelo del fabricante; y para ropa y calzado sin códigos, por marca + modelo + género (aproximado, con `~`). Esto
  cumple también la condición 2 (referencia internacional): si el costo supera el precio de eBay, no es ganga.
- **Cómo se calcula el precio de eBay** (criterio fijado por el usuario el 2026-11-03, "de ahora en adelante"):
  - Solo publicaciones **nuevas, a precio fijo, de vendedores de EE. UU.**, y del **mismo producto**: por código de modelo
    el título tiene que tener el código; por código de barras, el mismo tamaño (±5 %).
  - Se descartan **packs, lotes, kits, combos**, testers, decants, muestras, réplicas, usados y de chicos, y los precios
    absurdos (menos de la mitad de la mediana).
  - Hacen falta **al menos 5 publicaciones**; con menos, *sin referencia* y no se avisa.
  - **Perfumes:** el precio es el **cuartil inferior (25 %)** de lo publicado, **sin envío**, × dólar blue medio. Motivo:
    son precios pedidos, no vendidos (lo caro no se vende y sigue publicado), así que la mediana queda arriba.
  - **Zapatillas y ropa: ventas reales** (usuario, 2026-11-03: "no me importan las publicaciones sino las ventas"). Se leen
    las fichas de las primeras 8 publicaciones del modelo, que traen cuántas unidades vendió cada una. Hacen falta **al
    menos 3 unidades vendidas**; si no, no se avisa por más descuento que tenga (los Yeezy a US$200-300 tenían 0). El
    precio es la **mediana de lo vendido**, ponderada por unidades, **con tope en la mediana de lo publicado** (usuario,
    2026-11-05): eBay da las ventas de toda la vida de una publicación con su precio de hoy, y una sola publicación cara
    con ventas viejas inflaba el precio (Blazer Low '77: US$193 con 8 ventas, cuando el resto pedía de 40 a 83).
  - **Color exacto** (usuario, 2026-11-05): zapatillas y ropa se buscan en eBay solo por el código de estilo del
    fabricante, que identifica modelo y color (Moov lo trae en el id; Grid, en la descripción: "Código: DA6364-001").
    Sin código no se consulta: por nombre se mezclaban todos los colores del modelo.
  - **Talles** (usuario, 2026-11-05): el aviso muestra los talles con stock (Grid los trae en el catálogo; Moov, en la
    página del producto, que se pide solo para lo que se va a avisar). Se avisa igual, pero con **⚠** si solo quedan
    talles poco comerciales (hombre fuera de 39 a 45; mujer, de 35,5 a 39,5) o 2 unidades o menos (Yeezy 350 V2 en
    Moov a $90k con solo 34,5 y 35,5).
- **De las perfumerías, solo perfumes** (usuario, 2026-11-03): ni maquillaje, ni cremas, ni tratamientos, ni geles,
  desodorantes o after shave.
- **Criterio de aviso** (usuario, 2026-11-02): vale la pena todo lo que cueste **menos que ese precio**, sin margen mínimo.
- Sin credenciales de eBay, el bot vuelve al cruce anterior: el menor precio con stock de *otra* tienda, por código de
  barras, por marca + tamaño + nombre (perfumería) o por marca y modelo (ropa y calzado, con `~`).
- **Veredicto**: *buena* si el margen estimado (revendiendo un 5 % bajo el mercado) es de 40 % o más y la demanda no es
  baja; *regular* de 20 % o más; *evitar* si otra tienda lo vende más barato o el margen no alcanza, y entonces
  **no se avisa**; *sin referencia* si ninguna otra tienda lo vende.
- **Nunca se inventa un dato**: sin otra tienda que lo respalde, el aviso dice "sin referencia".
- La demanda es una **estimación** a partir de cuánto baja el stock de la tienda, no una medición del mercado de
  reventa (no existe una fuente abierta de ventas reales). Los valores de stock de relleno (99999) se ignoran.

## 5. Notificaciones

- Canal: WhatsApp vía **CallMeBot**, al número propio.
- Límites conocidos (página oficial, verificada el 2026-10-20): el plan gratuito es solo para uso
  personal y solo texto; no publica un tope diario ni de longitud; es un proyecto personal sin garantía
  de disponibilidad; el bot de activación a veces está lleno y hay que reintentar.
- **Límite de largo medido (2026-10-22):** CallMeBot corta en silencio los mensajes a ~760-768 de *largo efectivo*:
  los caracteres, más cada salto de línea (cuenta doble) y los bytes extra de acentos y símbolos como "·". La
  codificación de la URL no es el límite (un mensaje de 768 caracteres con URL de 1.658 llegó bien). Dos mensajes de
  8 ofertas llegaron cortados y las ofertas del final se perdieron, porque el envío "salió bien" y se las dio por
  avisadas. Regla: **un mensaje nunca supera 700 de largo efectivo (con tope duro de 740), y si no entra, no se
  envía** (falla a la vista). Los links van enteros en su propia línea y nunca se recortan.
- Las líneas no empiezan con `N.` (WhatsApp las convierte en lista numerada); se usa `N)`.
- Consecuencias de diseño: mensajes cortos, agrupar varias ofertas en un solo mensaje, máximo de
  mensajes por corrida y por día configurable, y un canal alternativo previsto (Telegram o TextMeBot)
  por si CallMeBot falla.
- **Cantidad de mensajes: lo más posible hasta el límite** (decisión del usuario, 2026-10-22). CallMeBot no publica su
  límite, así que se descubre en la práctica: se manda en orden de importancia (buenas primero), con pausa de 3 s, y
  se frena en el primer mensaje rechazado después de que otros salieron. Eso **no es una falla**: lo no enviado no se
  marca como avisado y sale en la corrida siguiente. Si ni el primer mensaje sale, sí es una falla y se informa. Riesgo
  conocido: si CallMeBot descarta mensajes en silencio (responde bien pero no entrega), el bot no puede detectarlo; por
  eso, si llegan menos mensajes de los que el log dice haber enviado, hay que bajar el tope en `src/config.mjs`.
- **Qué se avisa y cómo se ve** (decisión del usuario, 2026-10-23): el mensaje de varias líneas por oferta era ineficiente.
  Ahora se avisa **solo lo que realmente vale la pena** (veredicto *buena*) y en **formato de tabla**: una fila por
  oferta (nombre corto, costo, precio en otra tienda y ganancia, con `~` si el cruce fue por modelo) en un bloque de
  letra de ancho fijo, y debajo los links enteros y numerados (afuera del bloque, para que sean clickeables). Entran
  unas 4 a 5 ofertas por mensaje en vez de 2 a 3. Lo que no vale la pena (*regular*, *sin referencia*, *evitar*) no se avisa y
  tampoco se marca como avisado: se reevalúa y sale si más adelante pasa a valer la pena. Se puede ampliar la lista en
  `config.avisar.veredictos`, y el formato anterior sigue disponible con `formatoMensaje: 'detalle'`.
- Las marcas de "ya avisado" anteriores al 2026-10-23 se ignoran una vez (`reiniciarAlertasAntesDe`): las primeras
  corridas silenciaron como línea base muchas ofertas buenas que nunca llegaron al WhatsApp.
- CallMeBot responde `200` cuando el mensaje queda en cola; otro código, aunque sea 2xx (se vieron 201 y 210), se
  trata como rechazo y no se marca como avisado.

## 6. Fuera de alcance

- Compra o checkout automático.
- Ofertas que solo existen en el local físico y no están publicadas online (se podrían cargar a mano
  más adelante).
- Servicio para otras personas o reventa de datos.
- Saltear protecciones anti-bot.

## 7. Flujo de trabajo (SSD)

`constitution` → `spec` (qué y por qué) → `plan` (cómo) → `tasks` → implementación.
Cada fuente nueva es su propia spec chica. Cambios a este documento se versionan con commit propio.

## 8. Decisiones abiertas

| # | Tema | Estado |
|---|------|--------|
| 1 | Marcas y retailers iniciales | Relevadas, ver `docs/fuentes.md`. Primera fuente propuesta: Juleriaque |
| 2 | Referencia internacional por categoría | Perfumes: Perfumania, y eBay cuando apruebe el acceso (spec 006). PriceRunner descartado por sus términos. Falta calzado y gorras |
| 3 | Franjas horarias de ofertas relámpago y frecuencia de corrida | Foros sin resultados útiles; se infieren registrando clusters de promo de las APIs |
| 4 | Dónde se guarda el historial de precios | Decidido: JSON en rama `datos` (plan 001) |
| 5 | Canal alternativo si CallMeBot falla | Decidir en el plan |
