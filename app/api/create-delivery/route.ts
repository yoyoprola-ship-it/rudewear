import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/app/lib/firebaseAdmin';

// POST /api/create-delivery
// Body: { address, scheduledAt, scheduledDay, notes, customerName }
// Header: Authorization: Bearer <Firebase ID token>
//
// Guarda una reserva de visita a domicilio en Firestore. El endpoint
// verifica el ID token, extrae uid + phone del token, y usa Admin SDK
// para escribir bypasseando las rules admin-only.
//
// No cobra plata — el customer paga las prendas en persona cuando el
// driver llega. El teléfono queda guardado en el doc para que el
// driver llame al arribar.

interface Body {
  address?: string;
  scheduledAt?: string;
  scheduledDay?: 'today' | 'tomorrow';
  notes?: string;
  customerName?: string;
}

export async function POST(request: NextRequest) {
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
    // phone_number viene en formato E.164 (+1XXXXXXXXXX). Extraemos
    // los últimos 10 dígitos.
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
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ ok: true, id: ref.id });
  } catch (err) {
    console.error('[create-delivery] write failed:', err);
    return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  }
}
