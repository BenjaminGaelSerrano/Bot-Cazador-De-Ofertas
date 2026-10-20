import { config } from '../config.mjs';
import { diasObservado, minimoPrevio } from './historial.mjs';

const EPS = 1e-9; // evita que 70000 * 0.7 caiga justo del lado equivocado por redondeo de decimales

/**
 * Decide si una oferta es ganga (constitución §4). Devuelve null o
 * `{ tipo, descuento, base, referencia }`:
 *  - tipo 'historial': hay ≥ 30 días de datos y el precio está al menos 30 % bajo el mínimo previo.
 *  - tipo 'sin-historial': todavía no hay 30 días; se usa el descuento que declara el sitio.
 *  - `referencia` (precio internacional en pesos, opcional): si se pasa, el precio no puede superarla.
 * Sin stock nunca es ganga.
 */
export function evaluar(oferta, registro, hoy, { referencia = null, cfg = config } = {}) {
  if (!(oferta.stock > 0)) return null;
  const corte = 1 - cfg.descuentoMinimo;

  let tipo;
  let base;
  const minimo = registro ? minimoPrevio(registro, hoy, cfg.diasHistorial) : null;
  if (registro && minimo !== null && diasObservado(registro, hoy) >= cfg.diasHistorial) {
    tipo = 'historial';
    base = minimo;
  } else {
    tipo = 'sin-historial';
    base = oferta.precioLista;
  }

  if (!(base > oferta.precioActual) || oferta.precioActual > base * corte + EPS) return null;
  if (referencia !== null && oferta.precioActual > referencia) return null;

  return { tipo, descuento: 1 - oferta.precioActual / base, base, referencia };
}
