// Clave de modelo para ropa y calzado, donde las tiendas no comparten código de barras: se empareja por marca y por las
// palabras distintivas del nombre. Es deliberadamente conservador: dos productos emparejan solo si la marca y TODAS las
// palabras distintivas coinciden. Prefiere no emparejar a emparejar mal ("Superstar II" y "Superstar II Cuero" son
// productos distintos).

// alias en el texto -> [clave de marca, nombre para mostrar]
const MARCAS = {
  'nike sportswear': ['nike', 'Nike'],
  nike: ['nike', 'Nike'],
  jordan: ['jordan', 'Jordan'],
  'adidas originals': ['adidas', 'Adidas'],
  'adidas performance': ['adidas', 'Adidas'],
  adidas: ['adidas', 'Adidas'],
  puma: ['puma', 'Puma'],
  'new balance': ['newbalance', 'New Balance'],
  fila: ['fila', 'Fila'],
  converse: ['converse', 'Converse'],
  vans: ['vans', 'Vans'],
  reebok: ['reebok', 'Reebok'],
  topper: ['topper', 'Topper'],
  skechers: ['skechers', 'Skechers'],
  asics: ['asics', 'Asics'],
  saucony: ['saucony', 'Saucony'],
  hoka: ['hoka', 'Hoka'],
  umbro: ['umbro', 'Umbro'],
  kappa: ['kappa', 'Kappa'],
  'under armour': ['underarmour', 'Under Armour'],
  'mitchell ness': ['mitchellness', 'Mitchell & Ness'],
  'new era': ['newera', 'New Era'],
};
const ALIAS = Object.keys(MARCAS).sort((a, b) => b.length - a.length); // el más largo primero ("nike sportswear" antes que "nike")

// Palabras que no distinguen un modelo de otro.
const GENERICAS = new Set([
  'zapatillas', 'zapatilla', 'calzado', 'de', 'del', 'para', 'la', 'el', 'y', 'con', 'en',
  'hombre', 'mujer', 'unisex', 'ninos', 'nino', 'ninas', 'nina', 'kids', 'infantil',
  'running', 'training', 'moda', 'urbana', 'urbanas', 'urbano',
]);

const limpiar = (s) => s
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/['’´`]/g, '')
  .replace(/&/g, ' ')
  .replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Género a partir del texto: 'h' hombre, 'm' mujer, 'u' unisex, 'n' niños; null si no lo dice. */
function generoDe(texto) {
  if (/\bhombre\b/.test(texto)) return 'h';
  if (/\bmujer\b/.test(texto)) return 'm';
  if (/\bunisex\b/.test(texto)) return 'u';
  if (/\b(ninos?|ninas?|kids|infantil)\b/.test(texto)) return 'n';
  return null;
}

/**
 * Marca, género y clave de modelo de un producto. `marca` es el campo de marca de la tienda (puede ser vacío) y
 * `generoCategoria` el género que da la categoría cuando el nombre no lo dice.
 * Devuelve `{ marca, nombreMarca, genero, clave }`; `clave` es null si no hay marca conocida o no quedan palabras.
 */
export function claveModelo(marca, nombre, generoCategoria = null) {
  const textoNombre = limpiar(nombre ?? '');
  const textoMarca = limpiar(marca ?? '');

  // La marca se busca primero en el campo marca y después en el nombre.
  let encontrada = null;
  for (const texto of [textoMarca, textoNombre]) {
    encontrada = ALIAS.find((a) => new RegExp(`\\b${escapar(a)}\\b`).test(texto));
    if (encontrada) break;
  }
  if (!encontrada) return { marca: null, nombreMarca: null, genero: generoDe(textoNombre) ?? generoCategoria, clave: null };

  const [claveMarca, nombreMarca] = MARCAS[encontrada];
  let resto = textoNombre;
  for (const a of ALIAS) resto = resto.replace(new RegExp(`\\b${escapar(a)}\\b`, 'g'), ' ');
  const genero = generoDe(textoNombre) ?? generoCategoria;
  const palabras = resto.split(' ').filter((p) => p && !GENERICAS.has(p)).sort();
  return { marca: claveMarca, nombreMarca, genero, clave: palabras.length ? `${claveMarca}|${palabras.join(' ')}` : null };
}

/**
 * Dos géneros son compatibles si alguno es unisex o si son iguales. Un género desconocido NO es un comodín: solo
 * empareja con otro desconocido. (Probado con datos reales: tratarlo como comodín comparaba un modelo sin género de
 * Grid con la versión de mujer de Moov, más barata, y daba un veredicto equivocado.)
 */
export function compatibles(a, b) {
  if (a === 'u' || b === 'u') return true;
  return (a ?? null) === (b ?? null);
}
