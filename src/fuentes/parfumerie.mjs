import { config } from '../config.mjs';
import { crearLectorMagento } from './magento.mjs';

// Parfumerie (perfumería, 27 locales en shoppings): Magento 2, GraphQL público. Una oferta por unidad vendible.
export const { normalizarProducto, leerCatalogo } = crearLectorMagento(config.fuentes.parfumerie);
