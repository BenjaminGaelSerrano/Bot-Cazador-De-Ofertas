# CLAUDE.md — Cazador de ofertas

Bot personal que detecta ofertas de perfumería y ropa en marcas con presencia en shoppings de Buenos
Aires y avisa por WhatsApp (CallMeBot). Reglas completas en [`constitution.md`](constitution.md): leerlo
antes de proponer cambios.

## Reglas que no se rompen

- **Nunca** automatizar compra, checkout ni pagos. El bot solo notifica.
- **Nunca** evadir captchas, logins o bloqueos. Respetar `robots.txt` y limitar la frecuencia.
- Preferir feeds/APIs públicas (JSON de catálogo) antes que parsear HTML.
- Secretos solo en variables de entorno o secrets de GitHub. No commitear `.env`.
- Una alerta por oferta. Si una fuente falla, avisar una vez y registrar; nunca silencio.

## Método (SSD)

constitution → spec → plan → tasks → implementar. No escribir código de una fuente nueva sin su spec.
Si algo contradice la constitución, se discute primero y se cambia la constitución en un commit aparte.

## Stack y convenciones

- Node 22, ESM, sin dependencias salvo que se justifiquen.
- Un adaptador por marca en `src/fuentes/<marca>.mjs`, misma interfaz de salida (ver constitución §3).
- Tests con fixtures guardadas; no pegarle a sitios reales en los tests.
- Todo script con `--dry-run` que no envía mensajes ni escribe estado.
- Programación con GitHub Actions (`cron`), minuto no redondo para evitar demoras.
- Código y commits en español, igual que el resto de los proyectos del usuario.

## Notificaciones (CallMeBot)

- Variables: `CALLMEBOT_PHONE` (con código de país, solo dígitos) y `CALLMEBOT_APIKEY`.
- Solo texto, uso personal, sin tope publicado ni garantía de disponibilidad. Agrupar ofertas y poner
  un máximo de mensajes por corrida.
- Referencia de implementación: `Fraganzia/Fraganzia-WEB/tools/bot-proveedor.mjs` (función de envío) y
  `.github/workflows/bot-proveedor.yml` (cron + dry-run).

## Estructura prevista

`src/fuentes/` (un adaptador por marca), `src/nucleo/` (http, historial, ganga, alertas, fallas),
`src/notificar/` (CallMeBot), `tests/` con fixtures. Historial de precios en la rama `datos`, no en `main`.
Detalle en [`specs/001-fuente-juleriaque/plan.md`](specs/001-fuente-juleriaque/plan.md).

## Estado actual

Specs 001 (Juleriaque), 002 (Grid, Rouge, New Era), 004 (Parfumerie, Magento GraphQL) y 005 (Moov, Salesforce, cruce por modelo) implementadas. Avisos por WhatsApp, datos en la rama `datos`,
hasta 40 mensajes por corrida (8 por tienda) con pausa de 3 s: se manda lo más posible hasta que CallMeBot rechace uno, y ahí
se corta sin perder nada (lo no enviado queda en cola). Marcas relevadas en [`docs/fuentes.md`](docs/fuentes.md).
Spec 003 (reventa con datos propios) implementada: precio de mercado por cruce de tiendas, margen con comisión 0 %
(Instagram) y margen buscado de 40 %, velocidad de venta por stock (empieza a juntar datos el 2026-10-22).
Pendiente: indumentaria de Moov y más competidoras de ropa (Stock Center, New Balance, Puma: misma plataforma),
API de eBay como referencia internacional (spec 006, fase 2), y Mercado Libre y StockX como proveedores opcionales de reventa.
Ropa y calzado se cruzan por marca y modelo (`src/nucleo/modelo.mjs`), conservador: clave idéntica y género
compatible (un género desconocido NO es comodín); el aviso lo marca con `~`.
Spec 006 (referencia internacional, 2026-11-02): filtro de ganga contra **Perfumania** (EE. UU.), dólares × blue sin ajuste;
PriceRunner descartado por sus términos, eBay pendiente de aprobación. Perfumania bloquea tras 2-3 pedidos (~25 min): pocos
pedidos por corrida, caché en `datos/referencias/perfumania.json`, y lo no consultado sale con `*`. Reenvío de un día con
`node src/reenviar.mjs --datos <dir> --fecha AAAA-MM-DD`. Reanálisis forzado de todo lo leído un día (ignora "ya avisado", no pide nada a las tiendas):
`node src/reanalizar.mjs --datos <dir> --fecha AAAA-MM-DD`.
Formato de aviso (pedido del usuario, 2026-10-23): **tabla** (`src/notificar/tabla.mjs`), solo ofertas con veredicto
*buena*; lo demás no se avisa ni se marca. Un CallMeBot que responde distinto de 200 se trata como rechazo.
