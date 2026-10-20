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

const dormirReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cliente HTTP "buen ciudadano": User-Agent propio, pausa entre pedidos, corta ante 403/429
 * (sin reintentar ni insistir) y reintenta una sola vez ante errores 5xx.
 * `fetchFn`, `dormir` y `ahora` se inyectan para poder probarlo sin red ni esperas.
 */
export function crearCliente({
  fetchFn = fetch,
  pausaMs = config.pausaMs,
  userAgent = config.userAgent,
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
      res = await fetchFn(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } });
    } catch (error) {
      throw new ErrorFuente('red', `Sin respuesta de ${url}: ${error.message}`, { url });
    }

    if (res.status === 403 || res.status === 429) {
      throw new ErrorFuente('bloqueo', `El sitio bloqueó el pedido (${res.status}): ${url}`, { status: res.status, url });
    }
    if (res.status >= 500) {
      if (intento < 1) return pedir(url, intento + 1);
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
