import { DELIVERY_ORIGIN } from './pricing';

// Server-only helper — llama Google Distance Matrix para obtener
// millas + minutos desde DELIVERY_ORIGIN hasta una address arbitraria.
// Mismo patrón que Lafayette Market (comparten el mismo Google Maps
// server key en Secret Manager).

export interface DrivingDistanceResult {
  miles: number;
  minutes: number;
}

// Redacta key= del query string por si sale en logs de errores.
function redactKey(s: unknown): string {
  return String(s).replace(/([?&])key=[^&]+/g, '$1key=REDACTED');
}

export async function getDrivingDistanceFromOrigin(
  destinationAddress: string
): Promise<DrivingDistanceResult | null> {
  const MAPS_KEY = process.env.GOOGLE_MAPS_SERVER_KEY || '';
  if (!MAPS_KEY) {
    console.error('[drivingDistance] GOOGLE_MAPS_SERVER_KEY not set');
    return null;
  }
  if (!destinationAddress || typeof destinationAddress !== 'string') return null;
  const trimmed = destinationAddress.trim();
  if (trimmed.length === 0 || trimmed.length > 500) return null;

  try {
    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${encodeURIComponent(DELIVERY_ORIGIN)}` +
      `&destinations=${encodeURIComponent(trimmed)}` +
      `&units=imperial&key=${MAPS_KEY}`;

    // Timeout 5s para no colgar Cloud Run worker si Google no responde.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal }).finally(() =>
      clearTimeout(timer)
    );
    const data = await res.json();
    if (data.status !== 'OK') {
      console.error('[drivingDistance] status:', data.status);
      return null;
    }
    const el = data.rows?.[0]?.elements?.[0];
    if (!el || el.status !== 'OK') {
      console.error('[drivingDistance] element status:', el?.status);
      return null;
    }
    return {
      miles: Math.round((el.distance.value / 1609.34) * 10) / 10,
      minutes: Math.round(el.duration.value / 60),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Error && e.name === 'AbortError') {
      console.error('[drivingDistance] timed out after 5s');
    } else {
      console.error('[drivingDistance] fetch failed:', redactKey(msg));
    }
    return null;
  }
}
