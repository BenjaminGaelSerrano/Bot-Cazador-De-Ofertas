import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Lectura rápida o completa de cada tienda VTEX (2026-11-18). Casi todas las corridas leen solo lo que tiene descuento
// (el catálogo ordenado por mayor descuento); la primera corrida de cada día por tienda lee el catálogo ENTERO, para que
// el historial de precios (bajas reales, "desde cuándo bajó") siga al día. El estado es `datos/lecturas.json`:
// `{ tienda: 'AAAA-MM-DD' }` = el día de la última lectura completa exitosa.

export async function cargarLecturas(ruta) {
  try {
    return JSON.parse(await readFile(ruta, 'utf8'));
  } catch {
    return {};
  }
}

/** ¿Corresponde leer rápido? Solo si hoy ya hubo una lectura completa de esa tienda y no se pidió la completa. */
export function leerRapido(lecturas, tienda, fecha, { forzarCompleta = false } = {}) {
  return !forzarCompleta && lecturas[tienda] === fecha;
}

/** Anota la lectura completa de hoy. No cuenta si quedó algo parcial o truncado. */
export function anotarCompleta(lecturas, tienda, fecha, informe) {
  if (informe?.parciales?.length || informe?.truncados?.length || informe?.incompletos?.length) return false;
  lecturas[tienda] = fecha;
  return true;
}

export async function guardarLecturas(ruta, lecturas) {
  await mkdir(dirname(ruta), { recursive: true });
  const temporal = `${ruta}.tmp`;
  await writeFile(temporal, `${JSON.stringify(lecturas, null, 1)}\n`, 'utf8');
  await rename(temporal, ruta);
}
