import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/app/lib/firebaseAdmin';
import { getClientIp, rateLimitOr429 } from '@/app/lib/rateLimit';

// POST /api/admin/check-phone
// Body: { phone: string (10 digits US) }
// Returns: { canLogin: boolean }
//
// Pre-flight que el login page llama ANTES de disparar Firebase
// Phone Auth. Sin esto, cualquiera puede meter un phone random y
// Firebase manda un SMS pagado (~$0.05 c/u) que se descubre inválido
// recién al verificar el código.
//
// Info-leak awareness: técnicamente esto confirma si un phone es
// admin o no. Mitigamos con:
//   - IP rate limit 10/min (a ese ritmo, enumerar 10K phones tarda
//     >16h desde una sola IP; los admin phones son un set pequeño y
//     conocido, no vale la pena defenderse con opacidad).
//   - Sin auth (no queremos que un attacker tenga que loguearse
//     como user regular para probar).

interface Body {
  phone?: unknown;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const ipRl = await rateLimitOr429(`rw-check-phone-ip:${ip}`, {
    maxRequests: 10,
    windowMs: 60_000,
  });
  if (ipRl) return ipRl;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const raw = typeof body.phone === 'string' ? body.phone : '';
  const digits = raw.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) {
    return NextResponse.json({ error: 'Invalid phone' }, { status: 400 });
  }

  // Los user docs pueden guardar el phone como 10 dígitos (canonical)
  // o E.164 ('+1XXXXXXXXXX') según legacy. Chequeamos ambos.
  try {
    let snap = await adminDb
      .collection('users')
      .where('phone', '==', digits)
      .limit(1)
      .get();
    if (snap.empty) {
      snap = await adminDb
        .collection('users')
        .where('phone', '==', `+1${digits}`)
        .limit(1)
        .get();
    }
    if (snap.empty) {
      return NextResponse.json({ canLogin: false });
    }
    const data = snap.docs[0].data();
    const canLogin = data?.role === 'admin';
    return NextResponse.json({ canLogin });
  } catch (err) {
    console.error('[check-phone] query failed:', err);
    // Fail-CLOSED: si Firestore falla no dejamos pasar (mejor
    // usuario molesto que SMS gastado + rol privilegiado abierto).
    return NextResponse.json({ error: 'Auth check failed' }, { status: 500 });
  }
}
