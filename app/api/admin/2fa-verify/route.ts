import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/app/lib/firebaseAdmin';
import { requireAdminWithoutTwoFactor } from '@/app/lib/adminApiAuth';

// POST /api/admin/2fa-verify
// Body: { code: string (6 digits) }
// Header: Authorization: Bearer <Firebase ID token>
//
// Step 3 del flow admin login. Compara el code que el admin recibió
// por email contra el hash guardado en rudewear_adminTwoFactor/{uid}.
// Si matchea, escribe admin2faPassedAt en users/{uid} — el layout de
// admin lee ese flag y compara vs ADMIN_2FA_WINDOW_MS para dejar
// entrar al panel.
//
// Protecciones:
//   - Max 3 attempts por código (atómico via runTransaction)
//   - Timing-safe comparison del hash
//   - Código es single-use: se borra al matchear
//   - Expira automáticamente después de 10 min

function hashCode(code: string): string | null {
  const secret =
    process.env.EMAIL_CODE_HASH_SECRET || process.env.INTERNAL_API_SECRET;
  if (!secret) return null;
  return crypto.createHash('sha256').update(code + secret).digest('hex');
}

interface Body {
  code?: string;
}

export async function POST(request: NextRequest) {
  const caller = await requireAdminWithoutTwoFactor(request);
  if (!caller.ok) return caller.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Invalid code format' }, { status: 400 });
  }

  const expectedHash = hashCode(code);
  if (!expectedHash) {
    console.error(
      '[admin/2fa-verify] EMAIL_CODE_HASH_SECRET / INTERNAL_API_SECRET not set'
    );
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const codeDocRef = adminDb.doc(`rudewear_adminTwoFactor/${caller.uid}`);
  const userDocRef = adminDb.doc(`users/${caller.uid}`);

  const result = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(codeDocRef);
    if (!snap.exists) {
      return { error: 'No active 2FA code. Request a new one.', status: 400 };
    }
    const data = snap.data()!;
    const now = new Date();
    const expiresAt = data.expiresAt?.toDate
      ? data.expiresAt.toDate()
      : new Date(data.expiresAt);
    if (now > expiresAt) {
      tx.delete(codeDocRef);
      return { error: 'Code expired. Request a new one.', status: 400 };
    }
    const attempts = data.attempts || 0;
    if (attempts >= 3) {
      tx.delete(codeDocRef);
      return {
        error: 'Too many attempts. Request a new code.',
        status: 400,
      };
    }

    // Timing-safe compare — ambos son hex-encoded SHA-256, mismo length.
    const a = Buffer.from(String(data.codeHash || ''), 'hex');
    const b = Buffer.from(expectedHash, 'hex');
    const matches =
      a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!matches) {
      tx.update(codeDocRef, { attempts: attempts + 1 });
      return { error: 'Invalid code', status: 400 };
    }

    tx.delete(codeDocRef);
    tx.update(userDocRef, {
      admin2faPassedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true as const };
  });

  if ('error' in result && result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status || 400 }
    );
  }
  return NextResponse.json({ success: true, verified: true });
}
