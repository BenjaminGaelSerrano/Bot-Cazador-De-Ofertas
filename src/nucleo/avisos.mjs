import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Anota cada oferta realmente avisada, con el puntaje que se le dio, una línea JSON por aviso. Sirve para
 * contrastar después el veredicto del bot con lo que el usuario efectivamente pudo vender.
 */
export async function anexarAvisos(ruta, registros) {
  if (registros.length === 0) return;
  await mkdir(dirname(ruta), { recursive: true });
  await appendFile(ruta, registros.map((r) => `${JSON.stringify(r)}\n`).join(''), 'utf8');
}
