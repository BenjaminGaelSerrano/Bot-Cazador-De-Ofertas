import { config } from '../config.mjs';
import { crearLectorSfcc } from './sfcc.mjs';

// Moov (calzado): Salesforce Commerce Cloud. Competidora de Grid; se empareja por modelo, no por código de barras.
export const { normalizarProducto, leerCatalogo, leerTalles } = crearLectorSfcc(config.fuentes.moov);
