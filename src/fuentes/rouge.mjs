import { config } from '../config.mjs';
import { crearLector } from './vtex.mjs';

// Rouge (perfumería): VTEX, un aviso por SKU (cada tamaño tiene su precio), leído por categoría.
export const { normalizarProducto, leerCatalogo } = crearLector(config.fuentes.rouge);
