import { config } from '../config.mjs';

/** 185000 -> "$185.000" (formato argentino, sin decimales). */
export const pesos = (n) => `$${Math.round(n).toLocaleString('es-AR')}`;

/** Una línea de WhatsApp por oferta: marca, producto, precio, descuento contra qué, y link. */
export function formatearOferta(oferta, evaluacion, { dias = config.diasHistorial } = {}) {
  const pct = Math.round(evaluacion.descuento * 100);
  const contra = evaluacion.tipo === 'historial'
    ? `bajo el mínimo de ${dias} días ${pesos(evaluacion.base)}`
    : `sin historial, vs lista ${pesos(evaluacion.base)}`;
  const nombre = oferta.nombre.toLowerCase().startsWith(oferta.marca.toLowerCase()) ? oferta.nombre : `${oferta.marca} ${oferta.nombre}`;
  const referencia = evaluacion.referencia !== null && evaluacion.referencia !== undefined
    ? `, ref. internacional ${pesos(evaluacion.referencia)}`
    : '';
  return `${nombre}: ${pesos(oferta.precioActual)} (-${pct}% ${contra}${referencia})\n${oferta.url}`;
}
