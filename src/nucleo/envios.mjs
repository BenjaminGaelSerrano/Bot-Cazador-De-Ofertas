import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Cuántos WhatsApp salieron en el día (hora de Argentina). CallMeBot tiene un límite diario que no publica: el
// 2026-11-02, después de unos 30 mensajes, siguió respondiendo 200 pero dejó de entregar (ni una prueba corta llegó).
// Como no se puede detectar, el bot lleva la cuenta y no pasa de `config.maxMensajesPorDia`.

export async function enviadosHoy(ruta, fecha) {
  try {
    const estado = JSON.parse(await readFile(ruta, 'utf8'));
    return estado.fecha === fecha ? Number(estado.enviados) || 0 : 0;
  } catch {
    return 0; // sin archivo o roto: se arranca de cero (en el peor caso se manda alguno de más)
  }
}

export async function sumarEnviados(ruta, fecha, cantidad) {
  const total = (await enviadosHoy(ruta, fecha)) + cantidad;
  await mkdir(dirname(ruta), { recursive: true });
  const temporal = `${ruta}.tmp`;
  await writeFile(temporal, `${JSON.stringify({ fecha, enviados: total })}\n`, 'utf8');
  await rename(temporal, ruta);
  return total;
}

/** Cuántos mensajes puede usar una corrida: el tope por corrida, sin pasar lo que queda del día. */
export const cupoDeCorrida = (porCorrida, porDia, yaEnviados) => Math.max(0, Math.min(porCorrida, porDia - yaEnviados));
