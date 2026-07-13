import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/app/lib/firebaseAdmin';
import { getClientIp, rateLimitOr429 } from '@/app/lib/rateLimit';

// POST /api/check-customer-phone
// Body: { phone: string (10 digits US) }
// Returns: { hasActive: boolean }
//
// Pre-flight que /my-deliveries llama ANTES de disparar Firebase
// Phone Auth. Sin esto, cualquiera puede meter un phone random y
// Firebase manda un SMS pagado (~$0.05) para descubrir después que
// no tenía nada que cancelar.
//
// Consulta directa: rudewear_deliveries where customerPhone == digits
// AND status in ['requested', 'confirmed']. Si hay alguna activa,
// devolvemos true y el cliente sigue con el SMS. Si no, avisamos
// sin gastar.
//
// Info-leak: confirma "este phone tiene una reserva activa". Bajo
// valor — no revela alias, address ni cuánto. Rate limit 10/min
// contra enumeración.

interface Body {
  phone?: unknown;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const ipRl = await rateLimitOr429(`rw-check-customer-phone-ip:${ip}`, {
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

  try {
    const snap = await adminDb
      .collection('rudewear_deliveries')
      .where('customerPhone', '==', digits)
      .where('status', 'in', ['requested', 'confirmed'])
      .limit(1)
      .get();
    return NextResponse.json({ hasActive: !snap.empty });
  } catch (err) {
    console.error('[check-customer-phone] query failed:', err);
    return NextResponse.json({ error: 'Check failed' }, { status: 500 });
  }
}
