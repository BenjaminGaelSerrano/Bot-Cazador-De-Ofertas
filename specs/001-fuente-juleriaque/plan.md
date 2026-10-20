# Implementation Plan: Fuente Juleriaque

**Spec**: [spec.md](spec.md) · **Fecha**: 2026-10-20 · **Estado**: Draft

## Resumen

Un script Node sin dependencias que corre en GitHub Actions, lee el catálogo de Juleriaque por su API
VTEX, guarda el historial de precios en una rama de datos, evalúa la regla de ganga y avisa por
CallMeBot. Las piezas del núcleo (historial, regla, alertas, notificador) son independientes de la
fuente para que Grid, Rouge y New Era las reutilicen.

## Contexto técnico

| Tema | Decisión |
|------|----------|
| Lenguaje | Node 22+, ESM (`.mjs`), sin dependencias. `fetch` y `node:test` ya vienen incluidos |
| Programador | GitHub Actions `cron` + `workflow_dispatch` con `dry_run` |
| Historial | Archivos JSON en una **rama aparte `datos`**, no en `main` (ver abajo) |
| Notificación | CallMeBot, texto, al número propio |
| Pruebas | `node --test` con fixtures guardadas; ningún test pega al sitio real |

## Hallazgos técnicos (sondeo del 2026-10-20)

- El catálogo tiene **11.167 productos**. La API entrega **máximo 50 por pedido** (`_to` ≤ 50 o devuelve
  400) y **no acepta `_from` mayor a 2500**. Un recorrido plano solo llega a ~2.550 productos.
- Solo Fragancias suma 5.529 productos: segmentar por categoría tampoco alcanza.
- **Solución: segmentar por marca** con `fq=B:<brandId>` (lista de marcas en
  `/api/catalog_system/pub/brand/list`). Una marca que supere 2.550 productos se subdivide por categoría
  (`fq=B:<id>&fq=C:<id>`). Total estimado: unos 224 pedidos de 50 más uno por marca.
- Categorías que no son producto de venta y se excluyen por configuración: Testers, Exhibidores,
  Packaging, In Store Merchandising, Servicios, Gift Cards.
- Cada ítem trae `ean`, el tamaño dentro del nombre del SKU (`"... 30 ml"`), `Price`, `ListPrice` y
  `AvailableQuantity`.

## Presupuesto de minutos de Actions

El plan gratuito de GitHub da 2.000 minutos mensuales a repos privados (verificar en
*Settings → Billing*). Una corrida de Juleriaque tarda unos 4 a 6 minutos por las pausas de 1 s.

| Frecuencia | Minutos/mes (solo Juleriaque) | ¿Alcanza para 4 fuentes? |
|------------|-------------------------------|--------------------------|
| Cada 6 horas (4 por día) | ~600 | Justo, ~2.400 → **no** |
| Cada 12 horas (2 por día) | ~300 | Sí, ~1.200 |
| Cada hora | ~3.600 | No |

**Decisión inicial: 2 corridas por día** (misma lógica que el bot de Fraganzia). Si más adelante se
detectan franjas de ofertas relámpago, se agregan corridas puntuales en esas horas. Alternativa si falta
cupo: ejecutar localmente con el Programador de tareas de Windows (gratis, pero requiere la PC
encendida).

## Historial en la rama `datos`

Cada corrida modifica los JSON y hace commit. En `main` eso ensuciaría el historial de código; en una rama
`datos` queda separado. El workflow hace `checkout` de esa rama en la carpeta `datos/`.

```
datos/
  juleriaque/historial.json   # precios por producto
  alertas.json                # lo ya avisado
  fallas.json                 # estado de fallas por fuente
```

**Formato de `historial.json`**: guarda solo los **cambios de precio**, no una fila por día, para que el
archivo crezca poco.

```json
{
  "schema": 1,
  "productos": {
    "18121": {
      "ean": "769915195941", "marca": "THE ORDINARY",
      "nombre": "Niacinamide 10% + Zinc 1%", "ml": 30,
      "cat": "Tratamiento", "url": "https://www.juleriaque.com.ar/niacinamide-10-zinc-1-905782/p",
      "obs": [["2026-10-20", 24100, 24100, 1]]
    }
  }
}
```

`obs` = `[fecha, precioActual, precioLista]`. Se agrega una entrada solo si cambia el precio o la lista;
el stock (`stock`: 1 o 0) y la última fecha vista (`visto`) se guardan en el producto, no en cada entrada.
Si hay varias lecturas el mismo día, queda la de precio más bajo. El precio de un día cualquiera es el de
la última entrada anterior o igual a esa fecha. Estimación
inicial: unos 1 a 2 MB para 11.000 productos. Si crece más de 20 MB, se evalúa Firestore.

## Estructura del código

```
src/
  cli.mjs                    # entrada: --fuente, --dry-run
  config.mjs                 # umbrales, categorías excluidas, máximos de mensajes
  fuentes/
    juleriaque.mjs           # leer API, segmentar por marca, normalizar
  nucleo/
    http.mjs                 # fetch con User-Agent, pausa, tope de reintentos
    historial.mjs            # cargar, registrar observación, mínimo de N días
    ganga.mjs                # regla de ganga (con y sin historial)
    alertas.mjs              # deduplicar y umbral del 10 %
    fallas.mjs               # avisar una vez por falla
  notificar/
    callmebot.mjs            # envío + armado/agrupado del mensaje
tests/
  fixtures/juleriaque-pagina.json
  *.test.mjs
.github/workflows/cazador.yml
```

## Reglas de ganga (resumen operativo)

- **Con historial (≥ 30 días):** `precioActual <= 0.70 × mínimoPrevio` y stock > 0. El `mínimoPrevio` es
  el menor precio de los 30 días **anteriores a hoy**; hoy no cuenta porque una baja de hoy se compararía
  consigo misma y nunca dispararía el aviso.
- **Sin historial:** `precioActual <= 0.70 × precioLista` (descuento del sitio) y stock > 0; el mensaje
  incluye "sin historial".
- **Referencia internacional** (condición 2 de la constitución): fuera de esta spec; el módulo `ganga.mjs`
  acepta un campo opcional `referencia` para enchufarla después.
- **Repetir aviso:** solo si `precioActual <= 0.90 × precioAvisado`.

## Mensaje de WhatsApp

Una línea por oferta, agrupadas, con tope de caracteres configurable (CallMeBot no publica un máximo):

```
Ofertas Juleriaque (3)
1. DIOR Sauvage EDP 100ml: $185.000 (-42% vs mín. 30d $320.000)
   https://www.juleriaque.com.ar/...
2. ...
```

Tope inicial: 8 ofertas por mensaje y 3 mensajes por corrida; el resto se resume como "y N más".

## Control contra la constitución

| Principio | Cómo se cumple |
|-----------|----------------|
| Humano en el circuito | El bot solo manda el link; no hay código de compra |
| Buen ciudadano | Pausa ≥ 1 s, User-Agent propio, sin rutas bloqueadas, corta ante 403/429 |
| Alertas con señal | Regla de ganga + deduplicación + umbral del 10 % |
| Fallar a la vista | `fallas.mjs` avisa una vez y conserva el historial |
| Secretos fuera del repo | Secrets de GitHub; `.env.example` |
| Simple primero | Sin dependencias, JSON en vez de base de datos |

## Riesgos

- **Cupo de Actions** (ver tabla). Se vigila con la duración medida de cada corrida.
- **Cambio de la API de VTEX o bloqueo del sitio:** lo cubre la historia 3 de la spec.
- **Productos duplicados entre marcas o categorías:** se deduplican por `productId`.
- **CallMeBot caído o con límites no publicados:** tope de mensajes propio; canal alternativo pendiente.
