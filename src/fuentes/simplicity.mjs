import { config } from '../config.mjs';
import { crearLector } from './vtex.mjs';

// Simplicity (perfumería de shoppings, grupo Farmacity): VTEX, un aviso por SKU, solo Fragancias. Reemplaza a
// Parfumerie, que bloquea a los lectores automáticos desde el 2026-10-23 (pedido del usuario, 2026-11-05).
export const { normalizarProducto, leerCatalogo } = crearLector(config.fuentes.simplicity);
