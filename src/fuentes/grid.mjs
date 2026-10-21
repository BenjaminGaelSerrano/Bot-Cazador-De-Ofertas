import { config } from '../config.mjs';
import { crearLector } from './vtex.mjs';

// Grid (Nike, Jordan, NBA): VTEX, aviso por producto, catálogo completo en una consulta.
export const { normalizarProducto, leerCatalogo } = crearLector(config.fuentes.grid);
