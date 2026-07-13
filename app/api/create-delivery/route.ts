import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/app/lib/firebaseAdmin';
import { notifyAdminOfNewDelivery } from '@/app/lib/notifyAdmin';
import { getDrivingDistanceFromOrigin } from '@/app/lib/drivingDistance';
import {
  calculateDeliveryFee,
  MAX_DELIVERY_RADIUS_MILES,
} from '@/app/lib/pricing';
import {
  getClientIp,
  rateLimitOr429,
  userRateLimitOr429,
} from '@/app/lib/rateLimit';

// POST /api/create-delivery
// Body: {
//   address, scheduledAt, scheduledDay, notes, customerName,
//   agreedToPayOnArrival: boolean
// }
// Header: Authorization: Bearer <Firebase ID token>
//
// Guarda una reserva de visita a domicilio en Firestore. El endpoint
// verifica el ID token, extrae uid + phone del token, RECOMPUTA el
// fee server-side (no confía en el cliente), y usa Admin SDK para
// escribir bypasseando las rules admin-only.
//
// Pagos: el driver cobra al arribar (tarjeta o efectivo). Si el fee
// > 0 el cliente debió marcar el checkbox de acuerdo en el modal —
// validamos que la flag venga en true, sino rechazamos.

interface Body {
  address?: string;
  scheduledAt?: string;
  scheduledDay?: 'today' | 'tomorrow';
  notes?: string;
  customerName?: string;
  agreedToPayOnArrival?: boolean;
}

export async function POST(request: NextRequest) {
  // IP rate limit. Endpoint público — 10/min tolera un customer que
  // pruebe pero corta un script que quiera reventar Distance Matrix
  // (cada create llama Google + Twilio, cuesta plata).
  const ip = getClientIp(request.headers);
  const ipRl = await rateLimitOr429(`rw-create-delivery-ip:${ip}`, {
    maxRequests: 10,
    windowMs: 60_000,
  });
  if (ipRl) return ipRl;

  // Verify auth
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : '';
  if (!token) {
    return NextResponse.json({ error: 'Missing auth token' }, { status: 401 });
  }

  let uid: string;
  let phoneFromToken: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token, true);
    uid = decoded.uid;
    const rawPhone = (decoded.phone_number || '').replace(/\D/g, '');
    phoneFromToken = rawPhone.slice(-10);
    if (phoneFromToken.length !== 10) {
      return NextResponse.json(
        { error: 'Phone verification required' },
        { status: 403 }
      );
    }
  } catch (err) {
    console.error('[create-delivery] token verify failed:', err);
    return NextResponse.json({ error: 'Invalid auth token' }, { status: 401 });
  }

  // Per-uid: 5 reservas por hora. Un customer legítimo no debería
  // pasar de esto (ni siquiera con visits repetidas). Cap concreto
  // que evita abuse via cuenta comprometida sin bloquear uso real.
  const uidRl = await userRateLimitOr429('rw-create-delivery', uid, {
    maxRequests: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (uidRl) return uidRl;

  // Parse + validate body
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const address = (body.address || '').trim();
  const scheduledAt = (body.scheduledAt || '').trim();
  const scheduledDay = body.scheduledDay;
  const notes = (body.notes || '').trim().slice(0, 500);
  const customerName = (body.customerName || '').trim().slice(0, 60);
  const agreedRaw = body.agreedToPayOnArrival === true;

  if (address.length < 5 || address.length > 300) {
    return NextResponse.json(
      { error: 'Invalid address' },
      { status: 400 }
    );
  }
  if (
    !scheduledAt ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(scheduledAt)
  ) {
    return NextResponse.json(
      { error: 'Invalid scheduledAt (must be ISO local YYYY-MM-DDTHH:mm:ss)' },
      { status: 400 }
    );
  }
  if (scheduledDay !== 'today' && scheduledDay !== 'tomorrow') {
    return NextResponse.json(
      { error: 'Invalid scheduledDay' },
      { status: 400 }
    );
  }
  if (customerName.length === 0) {
    return NextResponse.json(
      { error: 'Missing customerName' },
      { status: 400 }
    );
  }

  // Recomputar la distancia server-side. NO confiamos en el fee que
  // manda el cliente — un browser modificado podría enviar $0 con
  // agreedToPayOnArrival=false y saltar el pago.
  const dist = await getDrivingDistanceFromOrigin(address);
  if (!dist) {
    return NextResponse.json(
      { error: 'Could not verify address. Try a more specific one.' },
      { status: 400 }
    );
  }
  if (dist.miles > MAX_DELIVERY_RADIUS_MILES) {
    return NextResponse.json(
      {
        error: `Address is ${dist.miles} mi away — outside our ${MAX_DELIVERY_RADIUS_MILES}-mile service radius.`,
      },
      { status: 400 }
    );
  }
  const deliveryFee = calculateDeliveryFee(dist.miles);

  // Si el fee > 0, el checkbox del cliente tiene que estar marcado.
  // Si es free, ignoramos lo que mandó — no hay nada que aceptar.
  if (deliveryFee > 0 && !agreedRaw) {
    return NextResponse.json(
      {
        error:
          'You must agree to pay the delivery fee by card or cash when the driver arrives.',
      },
      { status: 400 }
    );
  }

  // Persist
  try {
    const ref = adminDb.collection('rudewear_deliveries').doc();
    await ref.set({
      userId: uid,
      customerName,
      customerPhone: phoneFromToken,
      address,
      notes,
      scheduledAt,
      scheduledDay,
      status: 'requested',
      distanceMiles: dist.miles,
      deliveryFee,
      // Persistimos siempre — free reserva queda con true implícito
      // (no había nada que aceptar, pero para consistencia).
      agreedToPayOnArrival: deliveryFee > 0 ? agreedRaw : true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Fire-and-forget SMS al admin.
    notifyAdminOfNewDelivery({
      customerName,
      customerPhone: phoneFromToken,
      address,
      scheduledAt,
      scheduledDay,
      deliveryFee,
      distanceMiles: dist.miles,
    }).catch((err) => {
      console.error('[create-delivery] notify (unhandled):', err);
    });

    return NextResponse.json({
      ok: true,
      id: ref.id,
      deliveryFee,
      distanceMiles: dist.miles,
    });
  } catch (err) {
    console.error('[create-delivery] write failed:', err);
    return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  }
}
