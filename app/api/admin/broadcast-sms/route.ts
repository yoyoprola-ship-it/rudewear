import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/app/lib/firebaseAdmin';

// POST /api/admin/broadcast-sms
// Header: Authorization: Bearer <Firebase ID token>
// Body: { deliveryIds: string[], message: string }
//
// Manda un SMS via Twilio a los customerPhone de todas las deliveries
// indicadas. Dedupe por phone — si dos deliveries del mismo phone
// están seleccionadas, se manda UN sólo SMS. Devuelve el listado
// de éxitos y fallos.
//
// Guarda un audit log en `rudewear_broadcasts` para trackear qué
// mandó el admin y a quiénes — útil para eventuales disputas TCPA.

const MAX_RECIPIENTS = 100;
const MIN_MESSAGE_LEN = 3;
const MAX_MESSAGE_LEN = 1600;

interface Body {
  deliveryIds?: unknown;
  message?: unknown;
}

interface SendResult {
  phone: string;                 // masked
  deliveryIds: string[];
  sid?: string;
  error?: string;
}

export async function POST(request: NextRequest) {
  // ── Auth: admin only ──────────────────────────────────
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return NextResponse.json({ error: 'Missing auth token' }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token, true);
    uid = decoded.uid;
  } catch (err) {
    console.error('[broadcast-sms] token verify failed:', err);
    return NextResponse.json({ error: 'Invalid auth token' }, { status: 401 });
  }

  try {
    const userSnap = await adminDb.collection('users').doc(uid).get();
    if (userSnap.data()?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }
  } catch (err) {
    console.error('[broadcast-sms] role check failed:', err);
    return NextResponse.json({ error: 'Auth error' }, { status: 500 });
  }

  // ── Parse body ────────────────────────────────────────
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const deliveryIds = Array.isArray(body.deliveryIds)
    ? (body.deliveryIds as unknown[])
        .filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 100)
        .slice(0, MAX_RECIPIENTS)
    : [];
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  if (deliveryIds.length === 0) {
    return NextResponse.json(
      { error: 'Pick at least 1 recipient' },
      { status: 400 }
    );
  }
  if (message.length < MIN_MESSAGE_LEN || message.length > MAX_MESSAGE_LEN) {
    return NextResponse.json(
      { error: `Message must be ${MIN_MESSAGE_LEN}–${MAX_MESSAGE_LEN} chars` },
      { status: 400 }
    );
  }

  // ── Twilio config ─────────────────────────────────────
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    console.error('[broadcast-sms] Twilio env vars missing');
    return NextResponse.json({ error: 'SMS not configured' }, { status: 500 });
  }

  // ── Load deliveries + dedupe by phone ────────────────
  // Un customer puede tener varias reservas seleccionadas. Solo
  // mandamos UN SMS por phone único; devolvemos qué ids agrupó.
  const phoneToIds = new Map<string, string[]>();
  const results: SendResult[] = [];

  const loadResults = await Promise.all(
    deliveryIds.map(async (id) => {
      try {
        const snap = await adminDb
          .collection('rudewear_deliveries')
          .doc(id)
          .get();
        if (!snap.exists) return { id, phone: null as string | null, error: 'not_found' };
        const data = snap.data() || {};
        const phone = (data.customerPhone || '').toString().replace(/\D/g, '').slice(-10);
        if (phone.length !== 10) {
          return { id, phone: null, error: 'invalid_phone' };
        }
        return { id, phone, error: null as string | null };
      } catch (e) {
        return { id, phone: null, error: 'load_error' };
      }
    })
  );

  for (const r of loadResults) {
    if (!r.phone) {
      results.push({
        phone: '(unknown)',
        deliveryIds: [r.id],
        error: r.error || 'unknown',
      });
      continue;
    }
    const existing = phoneToIds.get(r.phone) || [];
    existing.push(r.id);
    phoneToIds.set(r.phone, existing);
  }

  // ── Send SMS per unique phone ─────────────────────────
  await Promise.all(
    Array.from(phoneToIds.entries()).map(async ([phone, ids]) => {
      const masked = `(${phone.slice(0, 3)}) ***-${phone.slice(-4)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
        const params = new URLSearchParams({
          To: `+1${phone}`,
          From: fromNumber,
          Body: message,
        });
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(
              `${accountSid}:${authToken}`
            ).toString('base64')}`,
          },
          body: params.toString(),
          signal: controller.signal,
        });
        const twResult = await res.json().catch(() => ({}));
        if (res.ok) {
          results.push({
            phone: masked,
            deliveryIds: ids,
            sid: twResult.sid,
          });
        } else {
          console.error('[broadcast-sms] Twilio error:', {
            code: twResult?.code,
            status: res.status,
          });
          results.push({
            phone: masked,
            deliveryIds: ids,
            error: `twilio_${twResult?.code || res.status}`,
          });
        }
      } catch (err) {
        console.error('[broadcast-sms] send failed:', err);
        results.push({
          phone: masked,
          deliveryIds: ids,
          error:
            err instanceof Error && err.name === 'AbortError'
              ? 'timeout'
              : 'send_error',
        });
      } finally {
        clearTimeout(timer);
      }
    })
  );

  const sent = results.filter((r) => r.sid);
  const failed = results.filter((r) => r.error);

  // ── Audit log ────────────────────────────────────────
  // No bloqueamos por esto — si falla, el log queda incompleto pero
  // los SMS ya se mandaron. Peor caso: revisamos Twilio console.
  try {
    await adminDb.collection('rudewear_broadcasts').add({
      sentBy: uid,
      message,
      recipientCount: sent.length,
      failedCount: failed.length,
      // Guardamos los IDs de deliveries objetivo, no los phones — el
      // log queda en Firestore que el admin puede leer.
      deliveryIds,
      phonesReached: sent.length,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('[broadcast-sms] audit log write failed:', err);
  }

  return NextResponse.json({
    sent,
    failed,
    uniquePhones: phoneToIds.size,
    totalDeliveries: deliveryIds.length,
  });
}
