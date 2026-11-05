// Talles disponibles de una oferta de calzado o ropa (pedido del usuario, 2026-11-05: "que evalúe los colores y los
// talles"). La oferta se avisa igual; el aviso muestra los talles y se marca con ⚠ cuando solo quedan talles poco
// comerciales o muy pocas unidades. Caso que lo motivó: Yeezy 350 V2 en Moov a $90k con solo los talles 34,5 y 35,5.

// Talles argentinos que se venden sin problema, por género (hombre ≈ US 7 a 12; mujer ≈ US 6 a 9).
export const RANGO_COMERCIAL = { h: [39, 45], m: [35.5, 39.5], otro: [36, 45] };
export const POCAS_UNIDADES = 2;
const MAX_LISTADOS = 6;

const numero = (t) => Number(String(t).replace(',', '.'));

/**
 * `talles`: `[{ t, u? }]` (talle argentino y, si la tienda lo informa, unidades). Devuelve `{ texto, alerta }`, o null si
 * no se conocen los talles (la tienda no los da o no se pudieron leer).
 */
export function evaluarTalles(talles, genero = null) {
  if (!Array.isArray(talles)) return null;
  if (talles.length === 0) return { texto: 'sin talles con stock', alerta: true };
  const numericos = talles.filter((x) => Number.isFinite(numero(x.t)));
  const [min, max] = RANGO_COMERCIAL[genero] ?? RANGO_COMERCIAL.otro;
  // Ropa (S, M, L...): no hay rango numérico; cuenta solo la cantidad de unidades.
  const sinComerciales = numericos.length > 0 && !numericos.some((x) => numero(x.t) >= min && numero(x.t) <= max);
  const conocidas = talles.every((x) => Number.isFinite(x.u));
  const unidades = conocidas ? talles.reduce((s, x) => s + x.u, 0) : null;
  const alerta = sinComerciales || (unidades !== null && unidades <= POCAS_UNIDADES);
  const lista = talles.length > MAX_LISTADOS
    ? `${talles[0].t} a ${talles.at(-1).t} (${talles.length} talles)`
    : talles.map((x) => `${x.t}${Number.isFinite(x.u) && x.u <= POCAS_UNIDADES ? ` (${x.u} u.)` : ''}`).join(', ');
  return { texto: `${alerta ? '⚠ ' : ''}talles ${lista}`, alerta };
}
