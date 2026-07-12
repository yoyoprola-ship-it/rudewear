import { NextRequest, NextResponse } from 'next/server';
import { getDrivingDistanceFromOrigin } from '@/app/lib/drivingDistance';
import {
  deliveryFeeBreakdown,
  MAX_DELIVERY_RADIUS_MILES,
} from '@/app/lib/pricing';

// POST /api/calculate-fee
// Body: { address: string }
// Returns: { miles, breakdown, total, free } o { error }
//
// Se usa desde el DeliveryModal al finalizar la selección de address
// vía Google Places autocomplete. Server-side para no exponer el
// key de Distance Matrix.
//
// El fee que devuelve este endpoint es SOLO PREVIEW. La validación
// autoritativa vive en /api/create-delivery, que recalcula al
// persistir para que el cliente no pueda mandar un fee=0 falseado.

export async function POST(request: NextRequest) {
  let address: string;
  try {
    const body = await request.json();
    address = body.address;
    if (!address || typeof address !== 'string' || address.length > 500) {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const dist = await getDrivingDistanceFromOrigin(address);
  if (!dist) {
    return NextResponse.json(
      {
        error:
          'Could not calculate distance. Try a more specific address.',
      },
      { status: 400 }
    );
  }

  if (dist.miles > MAX_DELIVERY_RADIUS_MILES) {
    return NextResponse.json(
      {
        error: `Sorry, that address is ${dist.miles} mi away — outside our ${MAX_DELIVERY_RADIUS_MILES}-mile service radius.`,
        outOfRange: true,
        miles: dist.miles,
      },
      { status: 400 }
    );
  }

  const breakdown = deliveryFeeBreakdown(dist.miles);
  return NextResponse.json({
    miles: dist.miles,
    breakdown,
    total: breakdown.total,
    free: breakdown.free,
  });
}
