import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from '../config.mjs';

// Estado de lo ya avisado: { "<fuente>:<sku>": { precio, fecha } }. Evita repetir avisos.

/** ¿Hay que avisar? Sí si nunca se avisó, o si el precio bajó otro 10 % respecto del último aviso. */
export function debeAvisar(estado, clave, precioActual, { cfg = config } = {}) {
  const previa = estado[clave];
  if (!previa) return true;
  return precioActual <= previa.precio * (1 - cfg.descuentoAdicional) + 1e-9;
}

export function marcarAvisada(estado, clave, precio, fecha) {
  estado[clave] = { precio, fecha };
}

/**
 * Olvida los avisos de los SKU que dejaron de ser ganga (el precio volvió a subir), para poder avisar
 * de nuevo si más adelante vuelven a bajar. Se conservan los que siguen en ganga, los que están sin
 * stock (puede ser momentáneo) y los que hoy no aparecieron en el catálogo.
 */
export function limpiar(estado, { vistos, sinStock, gangasAhora }) {
  for (const clave of Object.keys(estado)) {
    if (vistos.has(clave) && !sinStock.has(clave) && !gangasAhora.has(clave)) delete estado[clave];
  }
}

export async function cargarAlertas(ruta) {
  try {
    return JSON.parse(await readFile(ruta, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error; // un archivo roto no se reemplaza por uno vacío: se repetirían todos los avisos
  }
}

export async function guardarAlertas(ruta, estado) {
  await mkdir(dirname(ruta), { recursive: true });
  const temporal = `${ruta}.tmp`;
  await writeFile(temporal, `${JSON.stringify(estado, null, 1)}\n`, 'utf8');
  await rename(temporal, ruta);
}
