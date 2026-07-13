import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/app/lib/firebaseAdmin';
import { getClientIp, rateLimitOr429 } from '@/app/lib/rateLimit';

// POST /api/track-view
// Body: { productId: string }
//
// Incrementa rudewear_products/{productId}.viewCount +1 con Admin SDK
// (bypassea las rules admin-only). El cliente dedupea via localStorage
// para que un mismo browser no infle el contador — así el número
// aproxima "usuarios únicos que abrieron el detail card".
//
// No requiere auth — cualquier visitante suma views. Best-effort:
// si el producto no existe, devolvemos 404 pero no rompemos la UI.

export async function POST(request: NextRequest) {
  // Sin auth — cualquier browser suma views. El dedupe es client-side
  // (localStorage), pero un actor malicioso puede saltarse eso. IP cap:
  // 30/min tolera navegación normal pero corta un script que quiera
  // inflar el viewCount de un producto.
  const ip = getClientIp(request.headers);
  const ipRl = await rateLimitOr429(`rw-track-view-ip:${ip}`, {
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (ipRl) return ipRl;

  let productId: string;
  try {
    const body = await request.json();
    productId = body.productId;
    if (!productId || typeof productId !== 'string' || productId.length > 100) {
      return NextResponse.json({ error: 'Invalid productId' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  try {
    const ref = adminDb.collection('rudewear_products').doc(productId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    await ref.update({
      viewCount: FieldValue.increment(1),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[track-view] update failed:', err);
    return NextResponse.json({ error: 'Track failed' }, { status: 500 });
  }
}
