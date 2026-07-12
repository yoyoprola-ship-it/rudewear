import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/app/lib/firebaseAdmin';

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
