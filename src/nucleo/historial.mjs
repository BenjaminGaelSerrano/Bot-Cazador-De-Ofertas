import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { diasEntre, sumarDias } from './fechas.mjs';

// Guarda solo los cambios de precio: cada producto tiene `obs` = [[fecha, precio, precioLista], ...].
// El precio de un día es el de la última observación anterior o igual a esa fecha.

export const crearHistorial = () => ({ schema: 1, productos: {} });

/**
 * Guarda la cantidad de stock solo cuando cambia: `stk` = [[fecha, cantidad], ...]. Sirve para estimar cuán
 * rápido se vende un producto (lo que baja es lo que se vendió). Productos guardados antes de que existiera
 * este campo lo empiezan a llevar desde hoy. Una segunda lectura el mismo día reemplaza la primera.
 */
function anotarStock(registro, fecha, cantidad) {
  if (!registro.stk) {
    registro.stk = [[fecha, cantidad]];
    return;
  }
  const ultima = registro.stk.at(-1);
  if (ultima[0] === fecha) ultima[1] = cantidad;
  else if (ultima[1] !== cantidad) registro.stk.push([fecha, cantidad]);
}

/**
 * Registra el precio de hoy. Devuelve 'nuevo' | 'cambio' | 'igual'.
 * Si ya había una observación de hoy se queda con el precio más bajo del día.
 */
export function registrar(historial, producto, fecha) {
  const { id, precioActual, precioLista } = producto;
  const datos = {
    ean: producto.ean ?? null,
    marca: producto.marca,
    nombre: producto.nombre,
    ml: producto.ml ?? null,
    cat: producto.categoria,
    url: producto.url,
    stock: producto.stock > 0 ? 1 : 0,
    visto: fecha,
    // Marca de que los atributos pesados (EAN, marca) ya se pidieron, aunque el producto no tenga EAN: así no se
    // vuelven a pedir en cada corrida. Una vez puesta, no se borra.
    ...(producto.attrs ? { attrs: 1 } : {}),
    // Clave de modelo y género (ropa y calzado): sirven para emparejar con otras tiendas sin código de barras.
    ...(producto.modelo ? { km: producto.modelo, gen: producto.genero ?? null } : {}),
    // Código de estilo (modelo + color) para buscar en eBay el color exacto (Grid, 2026-11-05).
    ...(producto.codigo ? { cod: producto.codigo } : {}),
  };

  const cantidad = Number.isFinite(producto.stock) ? producto.stock : 0;

  const existente = historial.productos[id];
  if (!existente) {
    historial.productos[id] = { ...datos, obs: [[fecha, precioActual, precioLista]], stk: [[fecha, cantidad]] };
    return 'nuevo';
  }

  Object.assign(existente, datos);
  anotarStock(existente, fecha, cantidad);
  const ultima = existente.obs.at(-1);

  if (ultima[0] === fecha) {
    if (precioActual < ultima[1]) {
      existente.obs[existente.obs.length - 1] = [fecha, precioActual, precioLista];
      return 'cambio';
    }
    return 'igual';
  }
  if (ultima[1] !== precioActual || ultima[2] !== precioLista) {
    existente.obs.push([fecha, precioActual, precioLista]);
    return 'cambio';
  }
  return 'igual';
}

/** Observación vigente en una fecha, o null si el producto todavía no se había visto. */
export function observacionEn(producto, fecha) {
  for (let i = producto.obs.length - 1; i >= 0; i--) {
    if (producto.obs[i][0] <= fecha) return producto.obs[i];
  }
  return null;
}

/**
 * Precio mínimo de los `dias` días anteriores a `hoy` (hoy no cuenta: si no, una baja de hoy se
 * compararía consigo misma). Devuelve null si no hay datos en esa ventana.
 */
export function minimoPrevio(producto, hoy, dias) {
  const inicio = sumarDias(hoy, -dias);
  const fin = sumarDias(hoy, -1);

  const precios = producto.obs.filter(([fecha]) => fecha >= inicio && fecha <= fin).map(([, precio]) => precio);
  const alInicio = observacionEn(producto, inicio);
  if (alInicio) precios.push(alInicio[1]);

  return precios.length ? Math.min(...precios) : null;
}

/** Días transcurridos desde la primera observación del producto. */
export function diasObservado(producto, hoy) {
  return diasEntre(producto.obs[0][0], hoy);
}

/** Un producto por línea, para que los diffs de git sean legibles. */
export function serializar(historial) {
  const lineas = Object.entries(historial.productos).map(([id, p]) => `${JSON.stringify(id)}:${JSON.stringify(p)}`);
  return `{"schema":${historial.schema},"productos":{\n${lineas.join(',\n')}\n}}\n`;
}

/** Carga el historial; si el archivo no existe empieza uno vacío. Un archivo roto NO se reemplaza: falla. */
export async function cargar(ruta) {
  let texto;
  try {
    texto = await readFile(ruta, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return crearHistorial();
    throw error;
  }
  const historial = JSON.parse(texto);
  if (historial.schema !== 1) throw new Error(`Versión de historial desconocida: ${historial.schema}`);
  return historial;
}

/** Escribe en un temporal y renombra, para no dejar el archivo a medias. */
export async function guardar(ruta, historial) {
  await mkdir(dirname(ruta), { recursive: true });
  const temporal = `${ruta}.tmp`;
  await writeFile(temporal, serializar(historial), 'utf8');
  await rename(temporal, ruta);
}
