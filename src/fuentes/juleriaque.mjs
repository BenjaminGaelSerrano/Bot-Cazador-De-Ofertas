import { config } from '../config.mjs';
import { crearLector } from './vtex.mjs';

export { categoriaRaiz, extraerMl } from './vtex.mjs';

// Juleriaque: perfumería y cosmética. Un SKU por tamaño, cada uno con su precio.
export const { normalizarProducto, leerCatalogo } = crearLector(config.fuentes.juleriaque);
