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
- Mientras el historial tenga menos de 30 días, la condición 1 no se puede evaluar: el bot **solo
  junta datos y no avisa**, salvo que se configure lo contrario.

## 5. Notificaciones

- Canal: WhatsApp vía **CallMeBot**, al número propio.
- Límites conocidos (página oficial, verificada el 2026-10-20): el plan gratuito es solo para uso
  personal y solo texto; no publica un tope diario ni de longitud; es un proyecto personal sin garantía
  de disponibilidad; el bot de activación a veces está lleno y hay que reintentar.
- Consecuencias de diseño: mensajes cortos, agrupar varias ofertas en un solo mensaje, máximo de
  mensajes por corrida y por día configurable, y un canal alternativo previsto (Telegram o TextMeBot)
  por si CallMeBot falla.
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
| 2 | Páginas de referencia internacional por categoría | Investigar |
| 3 | Franjas horarias de ofertas relámpago y frecuencia de corrida | Investigar |
| 4 | Dónde se guarda el historial de precios | Decidir en el plan |
| 5 | Canal alternativo si CallMeBot falla | Decidir en el plan |
