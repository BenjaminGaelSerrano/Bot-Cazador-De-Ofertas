# Feature Specification: Precio de mercado en eBay EE. UU.

**Feature Branch**: `007-mercado-ebay`

**Created**: 2026-11-02

**Status**: Implementada, falta probar con las credenciales reales

**Input**: el usuario notó que los precios de mercado estaban mal ("en EE. UU. son mucho menores") y pidió hacer todo con
eBay o Amazon. Verificado el 2026-11-02: la columna "Merc." era el precio de lista de Rouge, 2,0 a 2,8 veces el de
EE. UU. (One Million EDT 100 ml: $321k contra $163k; Acqua di Gioia EDP 100 ml: $419k contra $182k; CK Everyone 200 ml:
$330k contra $117k). En los 516 perfumes que venden Rouge y Juleriaque, Rouge cobra hoy lo mismo que la lista de
Juleriaque (mediana 1,00): el "+58 %" era el descuento de Juleriaque contra un precio que nadie paga.

## Decisiones

- **eBay, no Amazon.** La API de Amazon (PA-API) pide una cuenta de afiliado con 3 ventas en 180 días; las
  alternativas (Keepa) son pagas. eBay tiene la Browse API oficial, ~5.000 consultas por día, búsqueda por `gtin`.
- **Solo se consulta lo que está en oferta** (las gangas de la corrida, primero las de mayor descuento), con caché de
  3 días y tope de 1.500 consultas por corrida.
- **Precio de mercado** = mediana de las 5 publicaciones nuevas, a precio fijo, de vendedores de EE. UU., más baratas
  (con envío fijo), × dólar blue medio. Se descartan decants, muestras, testers, réplicas, lotes, de chicos y usados, y
  las publicaciones a menos de la mitad de la mediana. Hacen falta al menos 3.
- **Búsqueda**: por código de barras (Juleriaque y Rouge, ~90 % de los productos); por código de modelo (Moov lo trae
  en el id: `NICW2288-111` = `CW2288-111`); por marca + modelo + género para ropa y calzado sin códigos (Grid), con `~`.
  Un perfume sin código no se busca por nombre (demasiados decants y ediciones con el mismo nombre).
- **Sin precio de eBay** (no hay publicaciones, o no se pudo consultar) = *sin referencia*: no se avisa, no se marca, se
  reevalúa en la próxima corrida.
- **Reemplaza** al cruce entre tiendas (spec 003) y a Perfumania (spec 006) cuando hay credenciales
  (`EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`). Sin credenciales, todo sigue como antes.
- **Fallas**: si eBay rechaza las credenciales o corta desde el primer pedido, se avisa una vez (fuente `ebay`). Un
  corte a mitad de corrida (límite) no: lo pendiente sale en la próxima.

## Acceptance Scenarios

1. **Given** una oferta con código de barras y 5 o más publicaciones nuevas en eBay, **Then** el precio de mercado es la
   mediana de las 5 más baratas con envío, en pesos, y el margen se calcula contra él.
2. **Given** que eBay tiene menos de 3 publicaciones válidas, **Then** la oferta queda sin referencia y no se avisa.
3. **Given** un tester o un decant entre las publicaciones, **Then** no cuenta.
4. **Given** credenciales inválidas, **Then** no se insiste, ninguna oferta se avisa y llega un aviso único de falla.
5. **Given** un producto consultado hace menos de 3 días, **Then** se usa el caché sin pedir de nuevo.

## Pendiente

- Probar con las credenciales reales: forma real de las respuestas, cobertura por tienda y tiempo por corrida.
- Ver si el 5 % de "descuento competitivo" sigue teniendo sentido contra eBay (precio de reventa en Argentina).
