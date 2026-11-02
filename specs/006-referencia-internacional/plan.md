# Plan: referencia internacional (spec 006)

## Piezas

| Archivo | Qué hace |
|---|---|
| `src/nucleo/internacional.mjs` | Emparejado con Perfumania (código de barras; si no, marca + nombre + concentración + ml), caché, cupo de pedidos, corte ante bloqueo, dólar blue |
| `src/correr.mjs` | Paso 3b: después de elegir lo que se va a avisar, consulta la referencia y saca lo más caro que en EE. UU. y lo sin consultar |
| `src/notificar/tabla.mjs` | Marca de un carácter delante del nombre (`~`, `*`) y leyenda nueva |
| `src/cli.mjs` | Crea el servicio (cliente propio con pausa de 8 s y sin reintentos), guarda el caché y avisa la falla si Perfumania bloquea desde el primer pedido |
| `src/reenviar.mjs` | Reenvío de lo avisado un día, con el filtro |
| `src/config.mjs` | `internacional`: pausa, cupo, resultados por búsqueda, tolerancia de ml, vigencia |

## Pedidos a Perfumania

Por oferta nueva: 1 búsqueda (`/search/suggest.json`) + hasta 3 fichas (`/products/<handle>.json`), cortando en la
primera que coincide por código de barras. Las sugerencias se filtran por marca y sin combos antes de pedir fichas. Lo
encontrado y lo no encontrado se guardan 7 días en `datos/referencias/perfumania.json`.

## Por qué el filtro va después de la reventa

Consultar solo lo que ya es ganga, vale la pena por reventa y no fue avisado deja muy pocos pedidos por corrida
(Perfumania bloquea rápido). En la primera corrida de una tienda, primero se silencia la línea base y después se
consulta, para no gastar el cupo en ofertas que no se van a mandar.

## Riesgos

- Los términos de Perfumania hablan de uso "personal, non-commercial" (riesgo aceptado por el usuario).
- El límite real de Perfumania no está publicado: si bloquea seguido, subir `pausaMs` o bajar `maxPedidosPorCorrida`.
- El emparejado por nombre puede fallar en ambos sentidos: es conservador (todo tiene que coincidir) y va con `~`.
