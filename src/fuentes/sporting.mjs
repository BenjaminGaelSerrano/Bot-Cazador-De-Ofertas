import { config } from '../config.mjs';
import { crearLector } from './vtex.mjs';

// Sporting (multimarca deportiva): VTEX, código de estilo en la referencia (2026-11-05).
export const { normalizarProducto, leerCatalogo } = crearLector(config.fuentes.sporting);
