import { config } from '../config.mjs';
import { crearLectorSfcc } from './sfcc.mjs';

// Stock Center (calzado, outlet): SFCC como Moov y Dexter (2026-11-05).
export const { normalizarProducto, leerCatalogo, leerTalles } = crearLectorSfcc(config.fuentes.stockcenter);
