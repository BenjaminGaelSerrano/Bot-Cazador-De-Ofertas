import { config } from '../config.mjs';
import { crearLector } from './vtex.mjs';

// Dash (multimarca deportiva en shoppings): VTEX como Grid, un aviso por producto (2026-11-05).
export const { normalizarProducto, leerCatalogo } = crearLector(config.fuentes.dash);
