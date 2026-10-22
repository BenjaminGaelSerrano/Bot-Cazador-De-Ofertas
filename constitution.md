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

Detalles de la referencia internacional:
- Hay **una fuente de referencia por categoría** (perfumes, calzado, indumentaria, etc.).
  `PENDIENTE`: elegir las páginas concretas.
- La conversión usa un tipo de cambio configurable (en Fraganzia se usa dolarapi.com). `PENDIENTE`:
  decidir si se suman impuestos o costos de importación a la referencia.
- Mientras el historial tenga menos de 30 días, la condición 1 no se puede evaluar: el bot usa el
  descuento declarado por el sitio (mínimo 30 %) y marca el aviso como **"sin historial"**.
- Si un producto no tiene referencia internacional, se evalúa solo la condición 1 y el aviso lo indica.
- Referencia elegida: **PriceRunner UK** (comparador, GBP). Ver `docs/referencias.md`.

### Reventa (spec 003)

Además de ser ganga, cada oferta se juzga como negocio de reventa (se revende por Instagram, sin comisión):

- **Precio de mercado**: el menor precio con stock de *otra* tienda para el mismo producto. Se busca por código de
  barras; si no hay, por marca + tamaño + nombre (perfumería); y para ropa y calzado por marca y modelo, que exige
  clave idéntica y género compatible, y se marca con `~` en el aviso por ser menos seguro. Se calcula con datos ya
  guardados, sin pedidos extra a los sitios.
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
- Formato del mensaje: marca, producto, precio actual, descuento vs. historial, referencia
  internacional y link directo.

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
| 2 | Referencia internacional por categoría | Elegido PriceRunner UK (perfumes verificado); falta calzado y gorras, y leer sus términos de uso |
| 3 | Franjas horarias de ofertas relámpago y frecuencia de corrida | Foros sin resultados útiles; se infieren registrando clusters de promo de las APIs |
| 4 | Dónde se guarda el historial de precios | Decidido: JSON en rama `datos` (plan 001) |
| 5 | Canal alternativo si CallMeBot falla | Decidir en el plan |
