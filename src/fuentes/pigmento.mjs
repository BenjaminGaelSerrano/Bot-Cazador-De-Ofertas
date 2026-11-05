import { config } from '../config.mjs';
import { crearLector } from './vtex.mjs';

// Pigmento (perfumería de shoppings): VTEX, un aviso por SKU (cada tamaño), solo la categoría Perfume. Elegida por el
// usuario el 2026-11-05 en lugar de Simplicity (que reemplazaba a Parfumerie, bloqueada).
export const { normalizarProducto, leerCatalogo } = crearLector(config.fuentes.pigmento);
