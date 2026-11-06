import { config } from '../config.mjs';
import { crearLector } from './vtex.mjs';

// Beauty 24 (perfumería de shoppings): VTEX, un aviso por SKU, solo perfumes (2026-11-05).
export const { normalizarProducto, leerCatalogo } = crearLector(config.fuentes.beauty24);
