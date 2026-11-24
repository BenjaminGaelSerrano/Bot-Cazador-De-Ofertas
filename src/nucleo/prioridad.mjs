import { minimoPrevio } from './historial.mjs';

// En qué orden se consulta el precio de EE. UU. cuando el cupo no alcanza para todas las gangas (pedido del usuario,
// 2026-11-02: "que tengan mayor descuento no significa que sean mejores, pueden tener el precio inflado").
//
// 1. Lo que ya está en caché va primero: no gasta cupo.
// 2. Baja REAL: cuánto bajó contra el menor precio que tuvo en los días anteriores (no contra el precio de lista, que
//    puede estar inflado). Si hoy no está más barato que antes, la baja real es 0 aunque el sitio diga "-50 %". Un
//    producto sin días anteriores no tiene baja comprobable: cuenta la mitad del descuento declarado.
// 3. Inflación de la marca: con lo que ya se consultó, cuánto sale la marca acá en relación con EE. UU. (costo ÷ precio
//    de EE. UU., mediana). Una marca que suele salir 1,5 veces más cara baja en la fila; una que sale más barata sube.

const DIAS = 30;
const PESO_MARCA = 0.5;

const claveMarca = (m) => String(m ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Baja contra el menor precio de los días anteriores (0 si no está más barato), o null si no hay días anteriores. */
export function bajaReal(registro, precioActual, fecha) {
  if (!registro) return null;
  const minimo = minimoPrevio(registro, fecha, DIAS);
  if (!minimo) return null;
  return Math.max(0, 1 - precioActual / minimo);
}

/** Relación costo ÷ precio de EE. UU. por marca, con las ofertas que ya tienen precio en caché. */
export function relacionPorMarca(conPrecio) {
  const porMarca = new Map();
  for (const { oferta, precio } of conPrecio) {
    const k = claveMarca(oferta.marca);
    if (!k || !(precio > 0)) continue;
    if (!porMarca.has(k)) porMarca.set(k, []);
    porMarca.get(k).push(oferta.precioActual / precio);
  }
  return new Map([...porMarca].map(([k, xs]) => [k, mediana(xs)]));
}

/**
 * Ordena las gangas para consultar. `enCache(oferta)` devuelve el resultado guardado (sin pedir nada) o null.
 * Devuelve `{ orden, prioridades }` (la prioridad de cada ganga, para poder mostrarla).
 */
export async function ordenarParaConsultar(gangas, { historial, fecha, enCache }) {
  const cacheadas = [];
  const resto = [];
  for (const g of gangas) {
    const c = enCache ? await enCache(g.oferta) : null;
    if (c) {
      g.ebay = c; // ya resuelta: no hace falta volver a pedirla
      cacheadas.push(g);
    } else {
      resto.push(g);
    }
  }
  const relacion = relacionPorMarca(cacheadas.filter((g) => g.ebay.estado === 'ok').map((g) => ({ oferta: g.oferta, precio: g.ebay.precio })));
  const prioridades = new Map();
  for (const g of resto) {
    const baja = bajaReal(historial?.productos?.[g.oferta.id], g.oferta.precioActual, fecha);
    // Primero lo que más probabilidad tiene de ser buena (2026-11-18): la mayor entre la baja real y la mitad del descuento
    // declarado. Antes, con historial y sin baja real la prioridad era 0 y el descuento no contaba (todo empataba).
    const base = Math.max(baja ?? 0, (g.evaluacion?.descuento ?? 0) * 0.5);
    const r = relacion.get(claveMarca(g.oferta.marca));
    prioridades.set(g, base + (r ? (1 - r) * PESO_MARCA : 0));
  }
  resto.sort((a, b) => prioridades.get(b) - prioridades.get(a));
  return { orden: [...cacheadas, ...resto], prioridades, relacion };
}

/**
 * Orden de los avisos (pedido del usuario, 2026-11-05: "ordename según las que te parecen mejores ofertas, teniendo
 * como criterio el porcentaje de ahorro y la cantidad de ventas"). Puntaje = margen × confianza, con confianza =
 * ventas ÷ (ventas + 5): 0 ventas no suma, 3 ventas 0,38, 20 ventas 0,8, 100 o más casi 1. Así un margen enorme con
 * pocas ventas no pasa adelante de uno bueno que se vende mucho. Sin dato de ventas, confianza 0,5.
 */
export const VENTAS_MEDIA_CONFIANZA = 5;
export function puntajeAviso({ margen, ventas, debil = false }) {
  const confianza = Number.isFinite(ventas) ? ventas / (ventas + VENTAS_MEDIA_CONFIANZA) : 0.5;
  // Referencia débil (pocas publicaciones en eBay): pesa menos, pero se avisa igual.
  return (Number.isFinite(margen) ? margen : 0) * confianza * (debil ? 0.6 : 1);
}

const normal = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Filtro del aviso (pedido del usuario, 2026-11-05): margen mínimo contra eBay, ventas mínimas en eBay y, si hay lista,
 * que la marca o el nombre contengan alguno de los términos ("jordan", "samba", "carolina herrera"...).
 */
export function pasaFiltroAviso({ oferta, margen, ventas, via }, { margenMinimo = 0, ventasMinimas = 0, soloTerminos = [] } = {}) {
  if (!(margen >= margenMinimo)) return false;
  // Las ventas mínimas valen para zapatillas y ropa. Perfumes (por código de barras): "más barato que eBay, sin exigir
  // ventas" (criterio aprobado el 2026-11-03); ahí las ventas son solo un dato (2026-11-17: dejaba afuera a Juleriaque).
  if (ventasMinimas > 0 && via !== 'ean' && !((ventas ?? 0) >= ventasMinimas)) return false;
  if (soloTerminos.length === 0) return true;
  const texto = ` ${normal(oferta.marca)} ${normal(oferta.nombre)} `;
  return soloTerminos.some((t) => texto.includes(` ${normal(t)} `));
}

// Palabras que marcan un producto de mujer en el nombre (perfumes sin categoría de género, ropa y calzado).
const DE_MUJER = /\b(mujer|mujeres|women|womens|woman|femme|femenin[oa]s?|dama|damas|her|elle|lady|girl)\b/;

/**
 * El usuario no quiere nada de mujer (2026-11-06: "todo lo que es de mujer no me va a interesar nunca"): por el género
 * del producto (categoría de la tienda) o por el nombre. Unisex o sin dato: se queda.
 */
export function esDeMujer(oferta) {
  if (oferta.genero === 'm') return true;
  if (oferta.genero === 'h' || oferta.genero === 'u') return false;
  return DE_MUJER.test(normal(oferta.nombre));
}

const CALZADO = /\b(zapatillas?|botines?|botitas?|ojotas?|botas?|sandalias?|zuecos?|calzado|mocasines?)\b/;
// Rendimiento deportivo: disciplinas, líneas de running y telas técnicas (calzado y ropa).
// En ropa, solo lo claramente técnico: Dri-FIT y calzas se usan también como estilo (2026-11-17, el usuario no quiere
// perderse prendas buenas por pensar que son de otra categoría).
const ES_PRENDA = /\b(camisetas?|remeras?|shorts?|camperas?|buzos?|pantal[oó]n(es)?|musculosas?|chombas?|calzas?|conjuntos?|canguros?|joggers?|chalecos?|tops?|bermudas?|rompevientos|poleras?|sweaters?|polleras?|vestidos?)\b/i;
const RENDIMIENTO_ROPA = /\b(running|runner|run|trail|training|entrenamiento|futbol|futsal|rugby|hockey|padel|tenis|golf|natacion|ciclismo|trekking|crossfit|aeroready|climacool|climalite|compresion|adizero|basquet|basketball)\b/;
const RENDIMIENTO = /\b(running|runner|run|trail|training|entrenamiento|botines?|futbol|futsal|rugby|hockey|padel|tenis|golf|natacion|ciclismo|trekking|crossfit|metcon|dri fit|aeroready|climacool|climalite|compresion|basquet|basketball|harden|lillard|trae young|ja morant|pegasus|vomero|structure|winflo|revolution|downshifter|quest|adizero|ultraboost|supernova|duramo|galaxy|runfalcon|response|solarglide|velocity nitro|deviate|zoom fly|invincible|calzas?)\b/;

/**
 * Perfil del usuario (2026-11-18): perfumes de diseñador o nacionales; calzado solo de las marcas elegidas; y nada de
 * rendimiento deportivo en calzado ni ropa. `perfil` viene de config.avisar.perfil; sin perfil, todo pasa.
 */
export function pasaPerfil(oferta, { esPerfumeria = false, perfil } = {}) {
  if (!perfil) return true;
  const texto = ` ${normal(oferta.marca)} ${normal(oferta.nombre)} `;
  const contiene = (t) => texto.includes(` ${normal(t)} `);
  if (esPerfumeria) {
    const marcas = [...(perfil.perfumes?.disenador ?? []), ...(perfil.perfumes?.nacionales ?? [])];
    return marcas.length === 0 || marcas.some(contiene);
  }
  const esCalzado = CALZADO.test(normal(oferta.nombre));
  if (esCalzado && perfil.calzadoMarcas?.length && !perfil.calzadoMarcas.some(contiene)) return false;
  const exenta = (perfil.sinFiltroRendimiento ?? []).some(contiene);
  // Ropa sin filtro de rendimiento (2026-11-24, pedido del usuario: "eliminemos filtros de ropa, así entra más ropa"):
  // `rendimientoRopa: true` en el perfil lo vuelve a activar.
  const esRopa = !esCalzado && ES_PRENDA.test(oferta.nombre);
  if (esRopa && !perfil.rendimientoRopa) return true;
  if (perfil.excluirRendimiento && !exenta && (esRopa ? RENDIMIENTO_ROPA : RENDIMIENTO).test(normal(oferta.nombre))) return false;
  return true;
}

/**
 * ¿Cuesta lo mismo (o más, con 3 % de margen) que en la tienda oficial de Argentina? Entonces no es una oferta, es el precio
 * normal de la marca. `precioOficialLocal` viene de config.avisar: { 'cod:JL8546': 154999 } (se completa a mano).
 */
export function esPrecioOficial(precioActual, clave, { precioOficialLocal = {} } = {}) {
  const oficial = clave ? precioOficialLocal[clave] : undefined;
  return Boolean(oficial) && precioActual >= oficial * 0.97;
}
