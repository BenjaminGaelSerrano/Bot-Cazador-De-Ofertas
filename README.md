# Cazador de ofertas

Bot personal que vigila precios online de perfumería y ropa, detecta gangas y avisa por WhatsApp con el
link directo. **Nunca compra**: la decisión es siempre de la persona. Reglas del proyecto en
[`constitution.md`](constitution.md).

## Cómo funciona

1. Lee el catálogo de la tienda (hoy: Juleriaque) y guarda el precio de cada producto.
2. Un producto es ganga si está al menos 30 % por debajo de su precio mínimo de los últimos 30 días.
   Mientras no haya 30 días de historial usa el descuento que declara el sitio y lo marca "sin historial".
3. Avisa por WhatsApp (CallMeBot), una sola vez por oferta; vuelve a avisar solo si baja otro 10 %.
4. Si el sitio falla o lo bloquea, avisa una vez y no se queda en silencio.

## Uso

```bash
npm test                                          # pruebas (no tocan la red)
node src/cli.mjs --fuente juleriaque --dry-run    # lee el sitio real, no escribe ni envía nada
node src/cli.mjs --fuente juleriaque              # corrida real: guarda datos y manda WhatsApp
```

Para correr en local, copiar `.env.example` a `.env` y completar `CALLMEBOT_PHONE` y `CALLMEBOT_APIKEY`.
Una lectura completa de Juleriaque son unos 283 pedidos y tarda unos 8 minutos (pausa de 1 s entre pedidos).

## Automatización (GitHub Actions)

El workflow [`cazador.yml`](.github/workflows/cazador.yml) corre dos veces por día (09:17 y 19:41, hora de
Argentina) y también a mano desde *Actions → Run workflow* (por defecto en modo simulación).

Requisitos, una sola vez: cargar en *Settings → Secrets and variables → Actions* los secrets
`CALLMEBOT_PHONE` (con código de país, solo dígitos) y `CALLMEBOT_APIKEY`.

Los datos (`historial.json`, `alertas.json`, `fallas.json`) se guardan en la rama **`datos`**, que el propio
workflow crea en la primera corrida. No se editan a mano.

## Documentación

- [`docs/fuentes.md`](docs/fuentes.md): marcas relevadas y cómo se lee cada una.
- [`docs/referencias.md`](docs/referencias.md): comparadores de precios para la referencia internacional.
- [`specs/001-fuente-juleriaque/`](specs/001-fuente-juleriaque/): spec, plan y tareas de la primera fuente.
