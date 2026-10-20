// Las fechas son cadenas "AAAA-MM-DD" en hora de Argentina; se hace la aritmética en UTC para evitar saltos.

/** Fecha de hoy en Buenos Aires (el servidor de Actions corre en UTC). */
export function hoyArgentina(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(ahora);
}

export function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function diasEntre(desde, hasta) {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}
