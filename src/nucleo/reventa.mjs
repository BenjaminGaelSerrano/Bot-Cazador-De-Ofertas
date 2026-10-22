import { config } from '../config.mjs';
import { diasEntre, sumarDias } from './fechas.mjs';

/**
 * Cuántas unidades por día se vendieron de un producto, a partir de cómo bajó su stock en la ventana.
 * Las subidas son reposición y no cuentan. Devuelve null si no se puede estimar: menos de `minDias` días
 * de datos, o cantidades de relleno (≥ `relleno`, ej. 99999) que no reflejan stock real.
 */
export function velocidadVenta(producto, hoy, { ventanaDias = config.reventa.ventanaVelocidadDias, relleno = config.reventa.stockRelleno, minDias = config.reventa.minDiasVelocidad } = {}) {
  const serie = producto.stk;
  if (!serie || serie.length === 0) return null;

  const visto = producto.visto ?? hoy;
  const inicio = sumarDias(hoy, -ventanaDias);
  const desde = serie[0][0] > inicio ? serie[0][0] : inicio;
  const dias = diasEntre(desde, visto);
  if (dias < minDias) return null;

  // Cantidad vigente al comenzar la ventana, y los cambios que ocurrieron después.
  let anterior = serie[0][1];
  const cambios = [];
  for (const [fecha, cantidad] of serie) {
    if (fecha <= desde) anterior = cantidad;
    else if (fecha <= visto) cambios.push(cantidad);
  }
  if ([anterior, ...cambios].some((q) => q >= relleno)) return null;

  let vendidas = 0;
  for (const cantidad of cambios) {
    if (cantidad < anterior) vendidas += anterior - cantidad;
    anterior = cantidad;
  }
  return { porDia: vendidas / dias, vendidas, dias, stockActual: anterior };
}

/** 'alta' | 'media' | 'baja' según las unidades por día, o null si no hay dato de velocidad. */
export function nivelDemanda(velocidad, { alta = config.reventa.demandaAltaPorDia, media = config.reventa.demandaMediaPorDia } = {}) {
  if (!velocidad) return null;
  if (velocidad.porDia >= alta) return 'alta';
  if (velocidad.porDia >= media) return 'media';
  return 'baja';
}

const EPS = 1e-9;

/**
 * Puntaje de reventa de una oferta (spec 003). `mercado` es el menor precio de otra tienda (o null).
 * Veredictos: 'buena' (margen ≥ margenBueno y demanda no baja), 'regular', 'evitar' (otra tienda lo vende más
 * barato o el margen no alcanza) y 'sin-referencia' (ninguna otra tienda lo vende: no se inventa un número).
 */
export function puntuar({ costo, mercado, demanda = null }, cfg = config.reventa) {
  if (!mercado) return { veredicto: 'sin-referencia', demanda };

  const precioReventa = mercado.precio * (1 - cfg.descuentoCompetitivo);
  const ingreso = precioReventa * (1 - cfg.comision) - cfg.envio;
  const margen = (ingreso - costo) / costo;

  let veredicto;
  if (mercado.precio < costo) veredicto = 'evitar'; // otra tienda ya lo vende más barato de lo que lo pagaríamos
  else if (margen + EPS >= cfg.margenBueno) veredicto = demanda === 'baja' ? 'regular' : 'buena';
  else if (margen + EPS >= cfg.margenRegular) veredicto = 'regular';
  else veredicto = 'evitar';

  return { veredicto, margen, precioReventa, precioMercado: mercado.precio, fuente: mercado.fuente, demanda };
}

const RANGO = { buena: 0, regular: 1, 'sin-referencia': 2 };

/** Orden de los avisos: buenas, regulares, sin referencia; dentro de cada grupo, la de mayor margen o descuento primero. */
export function compararPorReventa(a, b) {
  const rango = RANGO[a.puntaje.veredicto] - RANGO[b.puntaje.veredicto];
  if (rango !== 0) return rango;
  if (a.puntaje.veredicto === 'sin-referencia') return b.evaluacion.descuento - a.evaluacion.descuento;
  return b.puntaje.margen - a.puntaje.margen;
}
