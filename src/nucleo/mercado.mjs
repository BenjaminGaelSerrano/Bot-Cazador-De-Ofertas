import { readFile } from 'node:fs/promises';
import { config } from '../config.mjs';
import { diasEntre } from './fechas.mjs';
import { compatibles } from './modelo.mjs';

// Mercado local: a cuánto vende OTRA tienda el mismo producto. Usa los historiales que el bot ya guardó
// (último precio visto de cada tienda), sin hacer pedidos nuevos a los sitios.

/** EAN utilizable: solo dígitos (8 a 14), y no un relleno (ceros o un mismo dígito repetido). */
export function eanValido(ean) {
  return typeof ean === 'string' && /^\d{8,14}$/.test(ean) && !/^(\d)\1+$/.test(ean);
}

const sinAcentos = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const limpiar = (s) => sinAcentos(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Clave para emparejar cuando no hay EAN: marca + tamaño + nombre normalizado. Solo existe si hay tamaño en ml
 * (sin tamaño dos productos distintos se confunden con facilidad). Se conservan EDP/EDT/Parfum: son productos
 * distintos aunque se llamen igual.
 */
export function claveNombre(p) {
  if (!p.ml || !p.marca || !p.nombre) return null;
  const marca = limpiar(p.marca);
  const nombre = limpiar(p.nombre)
    .replace(new RegExp(`\\b${marca.split(' ').join('\\s+')}\\b`), ' ')
    .replace(/\b\d+(?:\s?ml)?\b/g, (m) => (/ml/.test(m) ? ' ' : m)) // saca "100 ml"; deja números que son del nombre
    .replace(/\s+/g, ' ')
    .trim();
  return nombre.length >= 3 ? `${marca}|${p.ml}|${nombre}` : null;
}

/**
 * Claves por las que se puede encontrar un producto en el índice, de la más a la menos segura: EAN, nombre (marca +
 * tamaño + nombre, perfumería) y modelo (marca + palabras del nombre, ropa y calzado; se compara además el género).
 * Las ofertas traen el modelo en `modelo`/`genero`; los productos guardados en el historial, en `km`/`gen`.
 */
function claves(p) {
  const resultado = [];
  if (eanValido(p.ean)) resultado.push({ clave: `ean:${p.ean}`, via: 'ean' });
  const nombre = claveNombre(p);
  if (nombre) resultado.push({ clave: `nom:${nombre}`, via: 'nombre' });
  const modelo = p.km ?? p.modelo;
  if (modelo) resultado.push({ clave: `mod:${modelo}`, via: 'modelo' });
  return resultado;
}

/**
 * Índice de lo que hay hoy en cada tienda: clave -> [{ fuente, precio, url }]. Solo productos con stock y vistos
 * dentro de `vigenciaDias` (un precio de hace una semana no sirve como referencia). Un EAN que aparece en más de
 * `maxRepetidos` productos de una misma tienda es un relleno y se descarta.
 */
export function construirIndice(historiales, hoy, { vigenciaDias = config.reventa.vigenciaDias, maxRepetidos = 5 } = {}) {
  const indice = new Map();
  for (const [fuente, historial] of Object.entries(historiales)) {
    const repetidos = new Map();
    for (const p of Object.values(historial.productos)) {
      if (eanValido(p.ean)) repetidos.set(p.ean, (repetidos.get(p.ean) ?? 0) + 1);
    }
    for (const p of Object.values(historial.productos)) {
      if (!p.stock || diasEntre(p.visto, hoy) > vigenciaDias) continue;
      const precio = p.obs.at(-1)[1];
      for (const { clave, via } of claves(p)) {
        if (via === 'ean' && repetidos.get(p.ean) > maxRepetidos) continue;
        if (!indice.has(clave)) indice.set(clave, []);
        indice.get(clave).push({ fuente, precio, url: p.url, genero: p.gen ?? null });
      }
    }
  }
  return indice;
}

/**
 * Precio de mercado local de una oferta: el menor precio, con stock, en OTRAS tiendas. Se prefiere el
 * emparejado por EAN; el de nombre solo se usa si no hay ninguno por EAN. Descarta precios ajenos menores a
 * `precioAjenoMinimo` veces el propio (probablemente otro formato del producto). Devuelve null si no hay
 * referencia; nunca inventa una.
 */
export function precioMercado(indice, oferta, fuenteActual, { precioAjenoMinimo = config.reventa.precioAjenoMinimo } = {}) {
  let mejor = null;
  const generoOferta = oferta.genero ?? oferta.gen ?? null;
  for (const via of ['ean', 'nombre', 'modelo']) {
    for (const { clave, via: v } of claves(oferta)) {
      if (v !== via) continue;
      for (const c of indice.get(clave) ?? []) {
        if (c.fuente === fuenteActual) continue;
        if (via === 'modelo' && !compatibles(c.genero, generoOferta)) continue; // zapatilla de mujer vs. de hombre: no
        if (c.precio < oferta.precioActual * precioAjenoMinimo) continue;
        if (!mejor || c.precio < mejor.precio) mejor = { precio: c.precio, fuente: c.fuente, url: c.url, via };
      }
    }
    if (mejor) return mejor; // si hubo coincidencia por un nivel más seguro, no se miran los siguientes
  }
  return null;
}

/** Carga los historiales de las demás tiendas. Una que todavía no tiene archivo simplemente no aporta. */
export async function cargarOtros(directorioDatos, nombreActual, fuentes = Object.keys(config.fuentes)) {
  const otros = {};
  for (const fuente of fuentes) {
    if (fuente === nombreActual) continue;
    try {
      otros[fuente] = JSON.parse(await readFile(`${directorioDatos}/${fuente}/historial.json`, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error; // un archivo roto no se ignora en silencio
    }
  }
  return otros;
}
