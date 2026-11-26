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
5. Máximo 3 por tienda y por corrida. Solo se avisa lo nuevo o lo que volvió a bajar.

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

- Se leen: La Martina, Key Biscayne, Tommy, Decathlon, Frères, King of the Kongo, BullBenny, Benkyo, Old Bridge, Garçon
  García, Cristóbal Colón, Tussy, Ay Not Dead (sección hombre), Etiqueta Negra, Open Sports, Quiksilver, DC y RVCA (las
  tres últimas son las tiendas de Boardriders).
- No se leen y no se fuerza: Lacoste y Zara rechazan los pedidos automáticos; María Cher también (403).
- Sin catálogo para leer: Harlem (no se encontraron datos en su sitio), Revolver (sitio vacío), Bolivia (marca nacional,
  su sitio propio no responde), Scuff (sin sitio encontrado).
- De mujer, afuera: Delaostia, Complot, Jazmín Chebar, Ginebra, María Cher, Max Mara.
- Sin tienda online argentina y no nacionales: Polo Ralph Lauren, Salvatore Ferragamo.
