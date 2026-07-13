import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/app/lib/firebaseAdmin';
import { notifyAdminOfCancellation } from '@/app/lib/notifyAdmin';
import {
  getClientIp,
  rateLimitOr429,
  userRateLimitOr429,
} from '@/app/lib/rateLimit';

// POST /api/cancel-delivery
// Header: Authorization: Bearer <Firebase ID token>
// Body: { deliveryId: string }
//
// Cliente-facing cancel — usado por /my-deliveries. El endpoint:
//   1. Verifica el ID token (phone-verified user).
//   2. Carga el delivery doc.
//   3. Valida que el userId del doc coincida con el uid del token
//      (no permite cancelar reservas de otros).
//   4. Valida que el status actual sea 'requested' o 'confirmed'.
//   5. Escribe status='cancelled' + cancelledAt via Admin SDK.
//   6. Fire-and-forget SMS al ADMIN_PHONE avisando la cancelación —
//      urgente sobre todo si estaba 'confirmed'.

const CANCELLABLE_STATUSES = new Set(['requested', 'confirmed']);

interface Body {
  deliveryId?: unknown;
}

export async function POST(request: NextRequest) {
  // IP + auth-first rate limit — un customer no cancela más de 10x/min
  // en la vida real; si lo hace, algo raro.
  const ip = getClientIp(request.headers);
  const ipRl = await rateLimitOr429(`rw-cancel-delivery-ip:${ip}`, {
    maxRequests: 10,
    windowMs: 60_000,
  });
  if (ipRl) return ipRl;

  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return NextResponse.json({ error: 'Missing auth token' }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token, true);
    uid = decoded.uid;
    // Phone verification requerida — no queremos que un user sin phone
    // verificado pueda cancelar (los deliveries se crean con phone
    // verificado, matcheamos el mismo requisito).
    const rawPhone = (decoded.phone_number || '').replace(/\D/g, '');
    if (rawPhone.length < 10) {
      return NextResponse.json(
        { error: 'Phone verification required' },
        { status: 403 }
      );
    }
  } catch (err) {
    console.error('[cancel-delivery] token verify failed:', err);
    return NextResponse.json({ error: 'Invalid auth token' }, { status: 401 });
  }

  // Per-uid: 5 cancels/hora. Un customer no cancela más que eso.
  const uidRl = await userRateLimitOr429('rw-cancel-delivery', uid, {
    maxRequests: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (uidRl) return uidRl;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const deliveryId =
    typeof body.deliveryId === 'string' && body.deliveryId.length > 0
      ? body.deliveryId
      : '';
  if (!deliveryId || deliveryId.length > 100) {
    return NextResponse.json({ error: 'Invalid deliveryId' }, { status: 400 });
  }

  const ref = adminDb.collection('rudewear_deliveries').doc(deliveryId);

  // Tx: leer, validar ownership + estado, escribir. Todo atómico para
  // evitar que dos clicks rápidos hagan doble notify.
  interface DeliveryDoc {
    userId: string;
    status: string;
    customerName: string;
    customerPhone: string;
    address: string;
    scheduledAt: string;
    scheduledDay: 'today' | 'tomorrow';
  }

  const result = await adminDb.runTransaction<
    | { error: string; status: number }
    | { ok: true; previousStatus: 'requested' | 'confirmed'; doc: DeliveryDoc }
  >(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { error: 'Delivery not found', status: 404 };
    const data = snap.data() as DeliveryDoc;
    if (data.userId !== uid) {
      return { error: 'Not your delivery', status: 403 };
    }
    if (!CANCELLABLE_STATUSES.has(data.status)) {
      return {
        error: `Cannot cancel a delivery in status "${data.status}"`,
        status: 400,
      };
    }
    tx.update(ref, {
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      ok: true,
      previousStatus: data.status as 'requested' | 'confirmed',
      doc: data,
    };
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Fire-and-forget SMS al admin — no bloquea la respuesta al cliente.
  notifyAdminOfCancellation({
    customerName: result.doc.customerName,
    customerPhone: result.doc.customerPhone,
    address: result.doc.address,
    scheduledAt: result.doc.scheduledAt,
    scheduledDay: result.doc.scheduledDay,
    previousStatus: result.previousStatus,
  }).catch((err) => {
    console.error('[cancel-delivery] notify (unhandled):', err);
  });

  return NextResponse.json({ ok: true });
}
