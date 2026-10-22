# Cazador de ofertas

Bot personal que vigila precios online de perfumería y ropa, detecta gangas y avisa por WhatsApp con el
link directo. **Nunca compra**: la decisión es siempre de la persona. Reglas del proyecto en
[`constitution.md`](constitution.md).

## Cómo funciona

1. Lee el catálogo de cinco tiendas (Juleriaque, Grid, Rouge, Parfumerie y New Era) y guarda el precio de cada producto.
2. Un producto es ganga si está al menos 30 % por debajo de su precio mínimo de los últimos 30 días.
   Mientras no haya 30 días de historial usa el descuento que declara el sitio ("vs lista" en el aviso).
3. Para cada ganga mira cuánto vende el mismo producto otra tienda (cruce por código de barras) y calcula el margen
   de reventa: **buena** (40 % o más), **regular** (20 % o más) o **evitar** (otra tienda lo vende más barato; no se
   avisa). Sin otra tienda que lo venda, dice "sin referencia".
4. Avisa por WhatsApp (CallMeBot), una sola vez por oferta; vuelve a avisar solo si baja otro 10 %. Los mensajes no
   pasan de 700 de largo efectivo: CallMeBot corta en silencio a ~768.
5. Si el sitio falla, avisa una vez; ante errores pasajeros reintenta y, si una página sigue fallando, la lectura queda
   parcial en vez de caerse.

## Uso

```bash
npm test                                          # pruebas (no tocan la red)
node src/cli.mjs --dry-run                        # lee todas las tiendas, no escribe ni envía nada
node src/cli.mjs --fuente grid,rouge --dry-run    # solo algunas (juleriaque, grid, rouge, newera)
node src/cli.mjs                                  # corrida real: guarda datos y manda WhatsApp
```

Para correr en local, copiar `.env.example` a `.env` y completar `CALLMEBOT_PHONE` y `CALLMEBOT_APIKEY`.
Una lectura completa de las cuatro tiendas son unos 430 pedidos y tarda unos 11 minutos (pausa de 1 s entre pedidos).

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
