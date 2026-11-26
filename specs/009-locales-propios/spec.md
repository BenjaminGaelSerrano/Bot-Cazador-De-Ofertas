# Feature Specification: Locales propios (sin referencia internacional)

**Created**: 2026-11-26

**Status**: Implementada (primera tanda: La Martina, Key Biscayne, Tommy Hilfiger, Decathlon, Frères)

**Input**: el usuario quiere más marcas de shopping. Las marcas con local propio no existen en eBay, así que no hay
referencia internacional. Aprobó comparar cada marca contra sí misma y además un precio máximo por prenda ("algo que
consideres normal pagar").

## Criterio de una oferta

1. Solo hombre (o sin género declarado). Nada de mujer ni de niños.
2. Con stock en L o XL (calzado: 44,5 a 46; pantalón 42 a 44, o 32 a 34 en pulgadas). Si la marca usa otra numeración, se muestran los talles tal cual.
3. Precio de hoy menor o igual al máximo de ese tipo de prenda (`config.locales.topes`).
4. Descuento:
   - Con menos de 14 días de historial: descuento declarado de 40 % o más, y no menor al percentil 75 de los descuentos
     de esa tienda.
   - Con 14 días o más: además, el precio tiene que estar 20 % o más por debajo del habitual (mediana de lo observado).
5. Sin tope por tienda. Cada corrida manda todo lo vigente; lo nuevo o lo que volvió a bajar lleva 🆕.

Se envían en un mensaje aparte, rotulado "sin referencia internacional", solo por Telegram.

## Promos de la web (2026-11-26)

- El precio que cuenta es el que se paga por transferencia, si la tienda lo publica en el producto o en la portada. La
  tarjeta muestra también el precio con otro medio de pago.
- Las demás promos de la portada (2x1, extras, cupones, primera compra) se listan al pie del mensaje; no se aplican solas.
- Los descuentos de locales presenciales quedan afuera (pedido del usuario).

## Límites conocidos

- Al principio se depende del precio de lista que declara la tienda, que puede estar inflado.
- El historial arranca en la semana de Black Friday.

## Estado al 2026-11-26

El usuario pidió dejar **solo las tiendas que venden muchas marcas**. En locales propios quedan Decathlon, Cristóbal
Colón y Open Sports. Se sacaron las de una sola marca: La Martina, Key Biscayne, Tommy Hilfiger, Frères, King of the
Kongo, BullBenny, Benkyo, Old Bridge, Garçon García, Tussy, Ay Not Dead, Etiqueta Negra, Quiksilver, DC y RVCA. Los
lectores quedan en el código: volver a sumar una es agregar su línea en `config.locales.tiendas`.

Más tarde el mismo día pidió sumar: Frères, King of the Kongo, Twohip, Hazze, Le France, Bomba Project, Arturo Fuego,
Substract, CasaClan y Raco de Loix (todas se leen). No se pudieron leer: Zara y Animal (ANM Store) rechazan al bot (403);
Odin Hood, Nasty Mondays y Undefined arman la tienda de un modo que el lector no entiende; Shaka y Sample, sin sitio
confirmado.

Después pidió: Harvey Willys, My Saint, Bowen, Moss, Baib Project, Davila (Davila Clouds), Ona Saez (solo hombre),
Tussy y Benkyo: se leen. Sin sumar: Rotten Future (su web no usa el formato de Tiendanube), Samples Studios
(Squarespace) y Aura 7 (sin sitio confirmado).

Después pidió Tommy Hilfiger, Etiqueta Negra, Equus y Giesso: se leen. Sin sumar: Lacoste (bloquea al bot), Ralph Lauren
(el sitio argentino no responde), Kevingston, Mauro Sergio y Brooksfield (harían falta lectores propios), Tucci y Yagmour
(ropa de mujer).

Lectores propios (src/fuentes/propias.mjs): Kevingston, Brooksfield y Rotten Future. No se suman: Mauro Sergio (su
catálogo muestra precios mayoristas "+ IVA"), Odin Hood, Nasty Mondays y Undefined (protegidas contra lectura
automática o sin datos en la página), Samples Studios (no se encontró la tienda argentina).
El usuario pasó los links de Samples (samples.com.ar) y Shaka (sh-aka.com.ar): se leen.
