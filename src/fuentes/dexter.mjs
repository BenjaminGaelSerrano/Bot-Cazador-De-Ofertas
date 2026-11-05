import { config } from '../config.mjs';
import { crearLectorSfcc } from './sfcc.mjs';

// Dexter (calzado, multimarca en shoppings): Salesforce Commerce Cloud, igual que Moov (pedido del usuario, 2026-11-05).
// El id trae el código de modelo y color con el prefijo de la marca (NIFJ9509-402 = Nike FJ9509-402).
export const { normalizarProducto, leerCatalogo, leerTalles } = crearLectorSfcc(config.fuentes.dexter);
