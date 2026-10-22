import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { enviar } from '../notificar/callmebot.mjs';

// Estado de fallas: { "<fuente>": { tipo, desde, ultimaVez, avisado } }. Sin entrada = la fuente anda bien.
// Una falla se avisa una sola vez; si persiste no se repite, y recién tras una corrida exitosa se
// "rearma" para avisar la próxima.

const ETIQUETAS = {
  bloqueo: 'el sitio bloqueó al bot',
  servidor: 'error del servidor del sitio',
  cliente: 'el sitio rechazó el pedido (¿cambió la API?)',
  red: 'sin conexión con el sitio',
  respuesta_invalida: 'respuesta inesperada del sitio (¿cambió la API?)',
  parcial: 'lectura parcial: faltaron páginas del sitio (se usó lo que se pudo leer)',
  notificacion: 'no se pudo enviar el WhatsApp',
  interno: 'error interno del bot',
};

export const tipoDe = (error) => error?.tipo ?? 'interno';

export function mensajeDeFalla(nombre, error) {
  const tipo = tipoDe(error);
  const detalle = String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 160);
  return `Cazador de ofertas: falla en ${nombre}. ${ETIQUETAS[tipo] ?? ETIQUETAS.interno}. Detalle: ${detalle}. Aviso único: no se repite hasta que se recupere.`;
}

async function cargar(ruta) {
  try {
    return JSON.parse(await readFile(ruta, 'utf8'));
  } catch {
    return {}; // archivo ausente o roto: en el peor caso se repite un aviso, nunca se queda sin avisar
  }
}

async function guardar(ruta, estado) {
  await mkdir(dirname(ruta), { recursive: true });
  const temporal = `${ruta}.tmp`;
  await writeFile(temporal, `${JSON.stringify(estado, null, 1)}\n`, 'utf8');
  await rename(temporal, ruta);
}

/**
 * Registra una falla y avisa por WhatsApp si es nueva (o si el aviso anterior no pudo salir).
 * Devuelve `{ avisada }`. Con `dryRun` solo imprime.
 */
export async function avisarFalla({ nombre, error, fecha, directorioDatos, dryRun = false, enviarFn = enviar, log = console.log }) {
  const ruta = `${directorioDatos}/fallas.json`;
  const estado = await cargar(ruta);
  const tipo = tipoDe(error);
  const previa = estado[nombre];

  if (previa && previa.tipo === tipo && previa.avisado) {
    if (!dryRun) await guardar(ruta, { ...estado, [nombre]: { ...previa, ultimaVez: fecha } });
    return { avisada: false };
  }

  let enviado = false;
  try {
    enviado = (await enviarFn(mensajeDeFalla(nombre, error), { dryRun, log })).enviado;
  } catch (falloEnvio) {
    log(`No se pudo avisar la falla por WhatsApp: ${falloEnvio.message}`);
  }
  if (!dryRun) {
    await guardar(ruta, { ...estado, [nombre]: { tipo, desde: previa?.tipo === tipo ? previa.desde : fecha, ultimaVez: fecha, avisado: enviado } });
  }
  return { avisada: enviado };
}

/** Una corrida exitosa borra la falla: la próxima se avisará de nuevo. */
export async function marcarRecuperada({ nombre, directorioDatos, dryRun = false }) {
  const ruta = `${directorioDatos}/fallas.json`;
  const estado = await cargar(ruta);
  if (!estado[nombre]) return false;
  if (!dryRun) {
    delete estado[nombre];
    await guardar(ruta, estado);
  }
  return true;
}
