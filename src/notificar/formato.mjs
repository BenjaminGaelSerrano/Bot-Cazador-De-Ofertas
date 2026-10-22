import { config } from '../config.mjs';

/** 185000 -> "$185.000" (formato argentino, sin decimales). */
export const pesos = (n) => `${config.simboloMoneda}${Math.round(n).toLocaleString('es-AR')}`;

const recortar = (texto, max) => (texto.length <= max ? texto : `${texto.slice(0, max - 3).trimEnd()}...`);

/**
 * Una oferta de WhatsApp en tres líneas: nombre, precio con el descuento y contra qué se compara, y el link.
 * El link va entero y en su propia línea (nunca se recorta: un link cortado no sirve). Se recorta el nombre,
 * que es lo que más varía de largo.
 */
const nombreFuente = (fuente) => ({ newera: 'New Era' })[fuente] ?? fuente.charAt(0).toUpperCase() + fuente.slice(1);

/** Línea de reventa: a cuánto vende otra tienda el mismo producto, margen estimado y veredicto. */
function lineaReventa(p) {
  if (!p) return null;
  if (p.veredicto === 'sin-referencia') return 'Sin referencia de otra tienda';
  const demanda = p.demanda ? ` · demanda ${p.demanda}` : '';
  return `Mercado ${pesos(p.precioMercado)} (${nombreFuente(p.fuente)}) · margen ${Math.round(p.margen * 100)}% · ${p.veredicto.toUpperCase()}${demanda}`;
}

export function formatearOferta(oferta, evaluacion, { dias = config.diasHistorial, puntaje = null } = {}) {
  const pct = Math.round(evaluacion.descuento * 100);
  const contra = evaluacion.tipo === 'historial'
    ? `vs mín. ${dias} días ${pesos(evaluacion.base)}`
    : `vs lista ${pesos(evaluacion.base)} (sin historial)`;
  // No se antepone la marca si el nombre ya la menciona (ej. "ZAPATILLAS NIKE SPORTSWEAR ..." de Nike Sportswear).
  const nombre = oferta.nombre.toLowerCase().includes(oferta.marca.toLowerCase()) ? oferta.nombre : `${oferta.marca} ${oferta.nombre}`;
  const referencia = evaluacion.referencia !== null && evaluacion.referencia !== undefined
    ? ` · ref. intl ${pesos(evaluacion.referencia)}`
    : '';
  const lineas = [recortar(nombre, 60), `${pesos(oferta.precioActual)} · -${pct}% ${contra}${referencia}`];
  const reventa = lineaReventa(puntaje);
  if (reventa) lineas.push(reventa);
  lineas.push(oferta.url); // el link va último, entero y en su propia línea
  return lineas.join('\n');
}
