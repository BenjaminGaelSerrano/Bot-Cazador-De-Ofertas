import { config } from '../config.mjs';

// Calidad en cada aviso de ropa y calzado (pedido del usuario, 2026-11-26): la composición de ESA prenda, tal como la
// publica la tienda (dato), y el nivel de la marca (config.calidad.marcas: una apreciación, no una medición).

const MATERIALES = 'algod[oó]n(?: (?:pima|org[aá]nico|peinado|reciclado))?|cotton|poli[eé]ster(?: reciclado)?|polyester|elastano|elastane|spandex|lycra|nylon|poliamida|lana(?: merino)?|merino|lino|viscosa|modal|lyocell|tencel|rayon|acr[ií]lico|cuero|poliuretano|cashmere|seda';
const PAR = new RegExp(`(\\d{1,3})\\s?%\\s?(?:de\\s)?(${MATERIALES})|(${MATERIALES})\\s?:?\\s?(\\d{1,3})\\s?%`, 'gi');
const NOMBRES = { cotton: 'algodón', algodon: 'algodón', polyester: 'poliéster', poliester: 'poliéster', elastane: 'elastano', spandex: 'elastano', lycra: 'elastano', acrilico: 'acrílico' };
const ENTIDADES = { oacute: 'ó', eacute: 'é', iacute: 'í', aacute: 'á', uacute: 'ú', nbsp: ' ' };

/** "74% algodón, 23% poliéster, 3% elastano" a partir del texto o JSON del producto; null si no publica porcentajes. */
export function composicionDe(texto) {
  const limpio = String(texto ?? '')
    .replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>')
    .replace(/&([a-z]+);/gi, (todo, n) => ENTIDADES[n.toLowerCase()] ?? todo)
    .replace(/<[^>]+>/g, ' ');
  const partes = [];
  const vistos = new Set();
  let total = 0;
  let fin = null;
  for (const m of limpio.matchAll(PAR)) {
    // Solo la primera tanda seguida: lo que viene lejos suele ser el forro, la suela u otro color.
    if (fin !== null && m.index - fin > 40) break;
    const porcentaje = Number(m[1] ?? m[4]);
    const crudo = (m[2] ?? m[3]).toLowerCase();
    const material = NOMBRES[crudo.normalize('NFD').replace(/[̀-ͯ]/g, '')] ?? crudo;
    if (!(porcentaje > 0 && porcentaje <= 100) || vistos.has(material) || total + porcentaje > 100) break;
    vistos.add(material);
    partes.push(`${porcentaje}% ${material}`);
    total += porcentaje;
    fin = m.index + m[0].length;
  }
  return partes.length ? partes.join(', ') : null;
}

const normal = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(originals|sportswear|performance)\b/g, ' ').replace(/[^a-z0-9&]+/g, ' ').trim();

/** Nivel de la marca según config.calidad.marcas, o null si no hay datos para opinar. */
export function nivelDeMarca(marca, tabla = config.calidad.marcas) {
  const m = normal(marca);
  if (!m) return null;
  for (const [nivel, marcas] of Object.entries(tabla)) {
    if (marcas.some((x) => ` ${m} `.includes(` ${normal(x)} `))) return nivel;
  }
  return null;
}

/** Línea de calidad de la tarjeta: "Marca: alta · 100% algodón". null si no hay nada que decir. */
export function lineaCalidad({ marca, composicion } = {}, tabla) {
  const nivel = nivelDeMarca(marca, tabla ?? config.calidad.marcas);
  return [nivel ? `Marca: ${nivel}` : null, composicion ?? 'composición no publicada'].filter(Boolean).join(' · ');
}
