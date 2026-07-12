// Rudewear delivery pricing — source of truth.
//
// Fórmula actual:
//   miles < FREE_RADIUS   → $0 (free)
//   miles ≥ FREE_RADIUS   → miles × PER_MILE_RATE
//
// El cliente NUNCA paga online — el driver cobra en efectivo cuando
// llega. Este helper sirve para (a) mostrar preview en el modal,
// (b) recomputar server-side al persistir (nunca confiar en el
// número del cliente).

/** Dirección desde donde sale el driver. Reusa el mismo origin que
 *  Lafayette Market (var pública, ya está en Secret Manager).
 *  Si algún día rudewear sale de otra dirección, cambiás acá el
 *  fallback o creás rudewear-specific env var. */
export const DELIVERY_ORIGIN =
  process.env.NEXT_PUBLIC_DELIVERY_ORIGIN ||
  '104 Westwood Dr Apt 359, Lafayette, LA 70506';

/** Coordenadas del origin — usadas para bias de Google Places. */
export const DELIVERY_ORIGIN_COORDS = { lat: 30.2241, lng: -92.0198 };

/** Radio máximo de servicio (millas). Fuera de esto rechazamos la
 *  reserva. Mismo valor que Lafayette Market. */
export const MAX_DELIVERY_RADIUS_MILES = 40;

/** Umbral bajo el cual la visita es gratis. */
export const FREE_DELIVERY_RADIUS_MILES = 5;

/** Precio por milla driving cuando NO cae en el free tier. */
export const DELIVERY_PER_MILE_RATE = 0.89;

/** Calcula el fee del delivery en dólares.
 *  @param miles distancia driving one-way (Google Distance Matrix)
 */
export function calculateDeliveryFee(miles: number): number {
  if (!Number.isFinite(miles) || miles < 0) return 0;
  if (miles < FREE_DELIVERY_RADIUS_MILES) return 0;
  const total = miles * DELIVERY_PER_MILE_RATE;
  return Math.round(total * 100) / 100;
}

/** Breakdown que la UI muestra al cliente al ver el fee.
 *  `free = true` cuando la address cae bajo el free tier. */
export interface DeliveryFeeBreakdown {
  miles: number;
  free: boolean;
  perMileRate: number;      // 1.5
  freeRadius: number;       // 5
  total: number;            // 0 o miles × 1.5
}

export function deliveryFeeBreakdown(miles: number): DeliveryFeeBreakdown {
  const free = miles < FREE_DELIVERY_RADIUS_MILES;
  const total = calculateDeliveryFee(miles);
  return {
    miles,
    free,
    perMileRate: DELIVERY_PER_MILE_RATE,
    freeRadius: FREE_DELIVERY_RADIUS_MILES,
    total,
  };
}
