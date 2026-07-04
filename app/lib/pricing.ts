// Rudewear delivery pricing — source of truth.
// Fórmula: (miles × $1) + (hours × $20) + $3.30 fixed.
//
// El $3.30 es un base que absorbe el fee de Stripe (~2.9% + $0.30)
// para pagos chicos + una micro contribución de operación. Ajustable
// desde acá — todo el resto del código consume estos helpers.

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

/** Constantes de la fórmula. */
export const DELIVERY_PER_MILE = 1;         // $ por milla driving
export const DELIVERY_PER_HOUR = 20;        // $ por hora driving
export const DELIVERY_BASE_FEE = 3.30;      // $ fijo (Stripe fee + micro base)

/** Calcula el fee del delivery en dólares.
 *  @param miles distancia driving one-way (Google Distance Matrix)
 *  @param minutes driving time one-way en minutos
 */
export function calculateDeliveryFee(miles: number, minutes: number): number {
  if (!Number.isFinite(miles) || miles < 0) return 0;
  if (!Number.isFinite(minutes) || minutes < 0) return 0;
  const hours = minutes / 60;
  const total =
    miles * DELIVERY_PER_MILE +
    hours * DELIVERY_PER_HOUR +
    DELIVERY_BASE_FEE;
  return Math.round(total * 100) / 100;
}

/** Breakdown que la UI muestra al cliente al ver el fee.
 *  Cada componente redondeado a 2 decimales para display consistente. */
export interface DeliveryFeeBreakdown {
  miles: number;
  minutes: number;
  distanceFee: number;   // miles × 1
  timeFee: number;       // hours × 20
  baseFee: number;       // 3.30
  total: number;         // suma
}

export function deliveryFeeBreakdown(
  miles: number,
  minutes: number
): DeliveryFeeBreakdown {
  const distanceFee = Math.round(miles * DELIVERY_PER_MILE * 100) / 100;
  const timeFee = Math.round((minutes / 60) * DELIVERY_PER_HOUR * 100) / 100;
  const baseFee = DELIVERY_BASE_FEE;
  const total = Math.round((distanceFee + timeFee + baseFee) * 100) / 100;
  return { miles, minutes, distanceFee, timeFee, baseFee, total };
}
