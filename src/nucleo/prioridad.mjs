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
    const base = baja ?? (g.evaluacion?.descuento ?? 0) * 0.5;
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
export function puntajeAviso({ margen, ventas }) {
  const confianza = Number.isFinite(ventas) ? ventas / (ventas + VENTAS_MEDIA_CONFIANZA) : 0.5;
  return (Number.isFinite(margen) ? margen : 0) * confianza;
}
