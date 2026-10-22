import { config } from '../config.mjs';

/** Error de lectura de una fuente. `tipo`: bloqueo | servidor | cliente | red | respuesta_invalida. */
export class ErrorFuente extends Error {
  constructor(tipo, mensaje, { status, url } = {}) {
    super(mensaje);
    this.name = 'ErrorFuente';
    this.tipo = tipo;
    this.status = status;
    this.url = url;
  }
}

/** Errores pasajeros del sitio (5xx o corte de red que sigue tras los reintentos): la lectura puede quedar parcial en vez de caerse. */
export const esRecuperable = (error) => error instanceof ErrorFuente && (error.tipo === 'servidor' || error.tipo === 'red');

const dormirReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cliente HTTP "buen ciudadano": User-Agent propio, pausa entre pedidos, corta ante 403/429
 * (sin reintentar ni insistir) y ante errores 5xx o cortes de red reintenta con espera creciente
 * (`esperasReintento`: una espera por cada reintento). Cada pedido tiene un tope de tiempo.
 * `fetchFn`, `dormir` y `ahora` se inyectan para poder probarlo sin red ni esperas.
 */
export function crearCliente({
  fetchFn = fetch,
  pausaMs = config.pausaMs,
  userAgent = config.userAgent,
  esperasReintento = config.esperasReintentoMs,
  timeoutMs = config.timeoutPedidoMs,
  dormir = dormirReal,
  ahora = Date.now,
} = {}) {
  let ultimoPedido = -Infinity;

  async function esperarTurno() {
    const falta = ultimoPedido + pausaMs - ahora();
    if (falta > 0) await dormir(falta);
    ultimoPedido = ahora();
  }

  async function pedir(url, intento) {
    await esperarTurno();

    let res;
    try {
      res = await fetchFn(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      // Un corte de red o un timeout suele ser pasajero: se reintenta con la misma espera creciente que un 5xx.
      if (intento < esperasReintento.length) {
        await dormir(esperasReintento[intento]);
        return pedir(url, intento + 1);
      }
      throw new ErrorFuente('red', `Sin respuesta de ${url}: ${error.message}`, { url });
    }

    if (res.status === 403 || res.status === 429) {
      throw new ErrorFuente('bloqueo', `El sitio bloqueó el pedido (${res.status}): ${url}`, { status: res.status, url });
    }
    if (res.status >= 500) {
      if (intento < esperasReintento.length) {
        await dormir(esperasReintento[intento]);
        return pedir(url, intento + 1);
      }
      throw new ErrorFuente('servidor', `Error ${res.status} del sitio: ${url}`, { status: res.status, url });
    }
    if (!res.ok) {
      throw new ErrorFuente('cliente', `Pedido rechazado (${res.status}): ${url}`, { status: res.status, url });
    }

    try {
      return { datos: await res.json(), headers: res.headers };
    } catch {
      throw new ErrorFuente('respuesta_invalida', `La respuesta no es JSON: ${url}`, { status: res.status, url });
    }
  }

  return { obtenerJson: (url) => pedir(url, 0) };
}
