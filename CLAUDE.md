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

## Estado actual

Fase: definición. Pendiente investigar marcas iniciales, referencias internacionales por categoría y
franjas horarias de ofertas (ver constitución §8).
