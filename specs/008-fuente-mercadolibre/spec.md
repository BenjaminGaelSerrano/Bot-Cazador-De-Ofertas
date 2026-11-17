# Feature Specification: Fuente Mercado Libre (Tiendas Oficiales) y referencia local

**Feature Branch**: `008-fuente-mercadolibre`

**Created**: 2026-11-17

**Status**: Especificada, **sin implementar** (el usuario pidió dejarla como spec y aplicarla más adelante)

**Input**: el usuario propuso sumar Mercado Libre "solo para el nicho que exploramos en las webs, nada más", con la
reserva de que "nada garantiza que sea oficial y verídico". Verificado el 2026-11-17: la búsqueda pública
(`api.mercadolibre.com/sites/MLA/search`) responde **403 sin credenciales**; la API oficial exige una aplicación
registrada. Se descartó leer las páginas de Mercado Libre (protecciones anti-bot y riesgo de bloqueo, como pasó con
Parfumerie, que responde un desafío de Cloudflare).

## Alcance (el nicho, nada más)

- **Zapatillas de hombre**, **ropa deportiva de hombre** y **perfumes originales** de las marcas que ya cubre el bot.
- Mismos filtros de siempre: sin mujer (`excluirMujer`), sin agotados, margen mínimo contra eBay
  (`avisar.margenMinimo`), ventas mínimas solo para zapatillas y ropa (`avisar.ventasMinimas`), descuento declarado
  (`descuentoMinimo`), referencia de eBay con al menos 3 publicaciones (`ebay.ventas.minPublicaciones`).
- Mismo formato de aviso (tarjetas) y mismo repetir lo vigente (`avisar.repetirVigentes`), con 🆕 en lo nuevo.

## Decisiones

- **API oficial, no scraping.** Se crea una aplicación gratis en developers.mercadolibre.com.ar (la crea el usuario con su
  cuenta) y se usan las credenciales como secretos de GitHub (`ML_CLIENT_ID`, `ML_CLIENT_SECRET`), igual que eBay. Nunca
  se pegan en el chat. Sin credenciales, la fuente queda apagada y nada cambia.
- **Autenticidad: empezar solo con Tiendas Oficiales** (`official_store_id` presente: Nike, Adidas, Puma, Topper, Fila,
  etc.). La marca vendiendo directo es lo más seguro. Opcional y posterior: vendedores MercadoLíder Platinum con
  muchas ventas, **siempre marcados** en el aviso ("Vendedor externo").
- **Siempre**: solo `condition = new`; se descartan publicaciones con palabras de réplica ("1:1", "calidad AAA",
  "importado igual al original", "primera marca") y precios imposibles (menos de la mitad de lo que cuesta en las
  tiendas ya leídas o contra eBay, sospechoso).
- **Búsqueda**: por código de modelo (el mismo que en eBay: Nike `DA6364-001`, Adidas `IH8218`) cuando se conoce; por
  GTIN en perfumes. Sin código no se busca por nombre (mismo criterio que eBay: no se mezclan colores).
- **Doble rol**:
  1. **Fuente de ofertas**: una publicación oficial más barata que eBay y que pasa el filtro se avisa como las demás.
  2. **Referencia local de precio** (el aporte nuevo): con el mismo código, mostrar cuánto cuesta en Argentina y detectar
     precios de lista inflados de las tiendas (el "precio retail" que el usuario vio mal en algunos avisos).
- **Entrega**: mostrar si llega a domicilio a CABA (envío gratis o a cargo del comprador) y plazo. El usuario vive en
  Parque Chas; lo que solo se retira lejos no sirve (ver memoria `talle-zapatillas-usuario`).
- **Cupo y tiempo**: respetar el límite de la API y repartirlo como el de eBay (`ajustarCupo`/`repartir`); caché de 3 días.
- **Fallas**: credenciales inválidas o corte desde el primer pedido se avisan una sola vez (fuente `mercadolibre`), igual
  que eBay; no pone roja la corrida (fuente opcional).

## Acceptance Scenarios

1. **Given** una zapatilla de Tienda Oficial con el mismo código que una oferta ya leída, **Then** se muestra su precio en
   Argentina como referencia local en la tarjeta.
2. **Given** una publicación de Tienda Oficial más barata que eBay (margen y ventas según las reglas de siempre),
   **Then** se avisa con "Tienda oficial" y el plazo de entrega a CABA.
3. **Given** un vendedor externo (si se habilita), **Then** se avisa marcado "Vendedor externo" y solo si es
   MercadoLíder Platinum.
4. **Given** una publicación con palabras de réplica o usada, **Then** se descarta.
5. **Given** un precio menor a la mitad de la referencia de eBay para el mismo código, **Then** se descarta por sospechoso.
6. **Given** que no hay credenciales, **Then** la fuente no corre y el resto del bot no cambia.
7. **Given** credenciales inválidas, **Then** no se insiste y llega un único aviso de falla.

## Pendiente

- **Crear la aplicación de Mercado Libre** (usuario) y cargar `ML_CLIENT_ID` y `ML_CLIENT_SECRET` como secretos del repo.
- Confirmar con el usuario: **solo Tiendas Oficiales** o también MercadoLíder Platinum.
- Medir con credenciales reales: cobertura por código de modelo, cuántos productos de las tiendas ya leídas aparecen en
  Mercado Libre, tiempo por corrida y cupo de la API.
- Decidir si la referencia local de Mercado Libre pasa a ser un criterio de aviso (por ejemplo, "al menos 15 % más barato
  que en Mercado Libre") o solo un dato en la tarjeta.
- Verificar si la API informa el envío a un código postal (CABA, 1431) sin autenticación de usuario.
