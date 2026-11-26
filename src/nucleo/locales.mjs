import { lineaCalidad } from './calidad.mjs';
import { diasEntre } from './fechas.mjs';

// Locales propios (spec 009): sin referencia internacional, cada marca se compara contra sí misma y contra un precio
// máximo por tipo de prenda. Solo funciones puras; la lectura y el envío están en src/locales.mjs.

const normal = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// El orden importa: lo más específico primero ("campera" antes que "remera", "short de baño" es short).
const TIPOS = [
  ['calzado', /\b(zapatillas?|zapatos?|botas?|botitas?|botines?|mocasin(es)?|nauticos?|sneakers?|borcegos?)\b/],
  ['campera', /\b(camperas?|parkas?|rompevientos|anorak|puffer|jackets?|tapados?)\b/],
  ['saco', /\b(sacos?|blazers?)\b/],
  ['chaleco', /\bchalecos?\b/],
  ['sweater', /\b(sweaters?|pulloveres?|pullover|cardigan)\b/],
  ['buzo', /\b(buzos?|hoodies?|canguros?|sudaderas?)\b/],
  ['jogging', /\b(jogging|joggers?)\b/],
  ['jean', /\b(jeans?|denim pants?)\b/],
  ['pantalon', /\b(pantalon(es)?|pants?|chinos?|cargos?)\b/],
  ['short', /\b(shorts?|bermudas?|mallas?)\b/],
  ['camisa', /\bcamisas?\b/],
  ['chomba', /\b(chombas?|polos?)\b/],
  ['musculosa', /\bmusculosas?\b/],
  ['remera', /\b(remeras?|t-?shirts?|tees?|camisetas?)\b/],
  ['gorra', /\b(gorras?|caps?|pilusos?|gorros?)\b/],
];

/** Tipo de prenda según el nombre, o null (accesorios y todo lo que no tiene precio máximo definido). */
export function tipoDePrenda(nombre) {
  const n = normal(nombre);
  return TIPOS.find(([, re]) => re.test(n))?.[0] ?? null;
}

const NO_ES_PARA_EL = /\b(mujer(es)?|damas?|women|womens|femenin[oa]s?|ninos?|ninas?|kids?|junior|boys?|girls?|bebes?|blusas?|vestidos?|polleras?|faldas?|corpino|bikini|tops?)\b/;

/** Solo hombre o sin género declarado: nada de mujer ni de niños (nombre, categorías, etiquetas y género). */
export function esParaHombre({ nombre, categorias = [], genero = null, url = '' }) {
  if (genero === 'm' || genero === 'n') return false;
  // Tommy codifica el género en la dirección del producto: DW y WW son de mujer; KN, KB y KG, de chicos.
  if (/tommy\.com\/.*-(dw|ww|kn|kb|kg)0[a-z0-9]+\/p/i.test(url)) return false;
  return !NO_ES_PARA_EL.test(normal([nombre, ...categorias].join(' ')));
}

const LETRAS = /^(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl)$/;

/**
 * Talles que le sirven al usuario entre los que hay en stock. Con talles en letras: L o XL (config). En calzado: 44,5 a 46.
 * Con otra numeración (jeans 40-48, Delaostia 1-2-3, talle único) no se puede saber: se devuelven todos.
 * Devuelve null si hay talles comparables y ninguno es el suyo, o si no hay stock.
 */
export function tallesUtiles(talles, tipo, { ropa = ['l', 'xl'], calzado = [44.5, 46], cintura = [42, 44], pulgadas = [32, 34] } = {}) {
  const hay = [...new Set((talles ?? []).map((t) => String(t).replace(/^.*(talle|talla):\s*/i, '').trim()).filter(Boolean))];
  if (hay.length === 0) return null;
  // Talles de bebé o de chicos ("0-3 meses", "8 años"): no es para él.
  if (hay.some((t) => /mes(es)?\b|a[ñn]os?\b/i.test(t))) return null;
  if (tipo === 'calzado') {
    const numeros = hay.map((t) => [t, Number(t.replace(',', '.'))]).filter(([, n]) => n >= 30 && n <= 50);
    if (numeros.length === 0) return hay;
    const suyos = numeros.filter(([, n]) => n >= calzado[0] && n <= calzado[1]).map(([t]) => t);
    return suyos.length ? suyos : null;
  }
  // Pantalones y jeans con número: cintura argentina (38-56) o en pulgadas (hasta 38). Fuera de rango = no es su talle.
  if (['jean', 'pantalon', 'jogging', 'short'].includes(tipo) && hay.every((t) => /^\d{1,2}$/.test(t))) {
    const numeros = hay.map(Number);
    if (Math.max(...numeros) >= 4) {
      const [desde, hasta] = Math.max(...numeros) <= 38 ? pulgadas : cintura;
      const suyos = numeros.filter((n) => n >= desde && n <= hasta).map(String);
      return suyos.length ? suyos : null;
    }
  }
  // Prendas de arriba con talles 4 a 20 solamente (Tommy): numeración de chicos o de mujer.
  if (!['jean', 'pantalon', 'jogging', 'short'].includes(tipo) && hay.every((t) => /^[0-9]{1,2}$/.test(t)) && Math.max(...hay.map(Number)) >= 4 && Math.max(...hay.map(Number)) <= 20) return null;
  // "S-M" o "L/XL" son talles dobles: cuentan si alguna de las dos letras es la suya.
  const partes = (t) => t.toLowerCase().split(/[-/]/).map((p) => p.trim());
  const enLetras = hay.filter((t) => partes(t).every((p) => LETRAS.test(p)));
  if (enLetras.length === 0) return hay;
  const suyos = enLetras.filter((t) => partes(t).some((p) => ropa.includes(p)));
  return suyos.length ? suyos : null;
}

export const descuentoDe = (o) => (o.precioLista > o.precioActual ? 1 - o.precioActual / o.precioLista : 0);

/** Percentil `p` de los descuentos declarados de una tienda (solo lo que tiene descuento). */
export function pisoDeTienda(ofertas, p = 0.75) {
  const d = ofertas.map(descuentoDe).filter((x) => x > 0).sort((a, b) => a - b);
  if (d.length === 0) return 0;
  return d[Math.floor((d.length - 1) * p)];
}

/** Precio habitual: mediana del precio de cada día observado antes de hoy. null con menos de `dias` días de historial. */
export function precioHabitual(registro, fecha, dias = 14) {
  const obs = (registro?.obs ?? []).filter(([f]) => f < fecha);
  if (obs.length === 0 || diasEntre(obs[0][0], fecha) < dias) return null;
  const porDia = [];
  for (let i = 0; i < obs.length; i++) {
    const hasta = obs[i + 1]?.[0] ?? fecha;
    for (let d = 0; d < Math.max(1, diasEntre(obs[i][0], hasta)); d++) porDia.push(obs[i][1]);
  }
  porDia.sort((a, b) => a - b);
  return porDia[Math.floor(porDia.length / 2)];
}

/** ¿Es una oferta para avisar? Devuelve `{ tipo, talles, descuento, baja }` o null. */
export function evaluarLocal(oferta, { registro, fecha, piso = 0, cfg }) {
  if (!(oferta.precioActual > 0) || !(oferta.stock > 0)) return null;
  const tipo = tipoDePrenda(oferta.nombre);
  const tope = tipo ? cfg.topes[tipo] : undefined;
  if (!tope || oferta.precioActual > tope) return null;
  if (!esParaHombre(oferta)) return null;
  const talles = tallesUtiles(oferta.talles, tipo, cfg.talles);
  if (!talles) return null;
  const descuento = descuentoDe(oferta);
  if (descuento < Math.max(cfg.descuentoMinimo, piso)) return null;
  const habitual = precioHabitual(registro, fecha, cfg.diasHistorial);
  const baja = habitual === null ? null : 1 - oferta.precioActual / habitual;
  if (baja !== null && baja < cfg.bajaMinima) return null;
  return { tipo, talles, descuento, baja };
}

/** Lo nuevo o lo que volvió a bajar desde que se avisó, de mayor a menor descuento, hasta `maximo`. */
export function elegirParaAvisar(candidatas, avisadas, maximo) {
  const vistos = new Set(); // un color por modelo: el mismo nombre repetido no ocupa los lugares
  return candidatas
    .filter(({ oferta }) => avisadas[oferta.url] === undefined || oferta.precioActual < avisadas[oferta.url])
    .sort((a, b) => (b.evaluacion.baja ?? b.evaluacion.descuento) - (a.evaluacion.baja ?? a.evaluacion.descuento))
    .filter(({ oferta }) => {
      const nombre = normal(oferta.nombre);
      if (vistos.has(nombre)) return false;
      vistos.add(nombre);
      return true;
    })
    .slice(0, maximo);
}

const pesos = (n) => `$${Math.round(n).toLocaleString('es-AR')}`;
const limpio = (s) => String(s ?? '').replace(/[[\]*]/g, '').replace(/\s+/g, ' ').trim();

/** Tarjeta de una oferta de local propio. */
export function tarjetaLocal(numero, { tienda, oferta, evaluacion }) {
  const baja = evaluacion.baja !== null ? ` · bajó ${Math.round(evaluacion.baja * 100)}% de lo habitual` : '';
  return [
    `*${numero}. [${limpio(oferta.nombre).slice(0, 60)}](${oferta.url})*`,
    `${pesos(oferta.precioActual)} (lista ${pesos(oferta.precioLista)}) · *-${Math.round(evaluacion.descuento * 100)}%*${baja}`,
    `${tienda} · talle ${evaluacion.talles.slice(0, 6).join(', ')}`,
    lineaCalidad({ marca: oferta.marca, composicion: oferta.composicion }),
  ].join('\n');
}

/** Mensajes de Telegram (de a `porMensaje` tarjetas). */
export function mensajesLocales(elegidas, porMensaje = 8) {
  const mensajes = [];
  for (let i = 0; i < elegidas.length; i += porMensaje) {
    const cabecera = i === 0 ? '*Locales propios* · sin referencia internacional (descuento de la propia tienda)' : '*Locales propios* (cont.)';
    mensajes.push([cabecera, '', elegidas.slice(i, i + porMensaje).map((e, j) => tarjetaLocal(i + j + 1, e)).join('\n\n')].join('\n'));
  }
  return mensajes;
}
