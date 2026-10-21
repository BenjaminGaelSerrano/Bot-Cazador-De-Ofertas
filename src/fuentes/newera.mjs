import { config } from '../config.mjs';
import { crearLectorShopify } from './shopify.mjs';

// New Era (gorras): Shopify, aviso por producto.
export const { normalizarProducto, leerCatalogo } = crearLectorShopify(config.fuentes.newera);
