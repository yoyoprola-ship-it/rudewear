import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from './firebaseAdmin';

// Helpers para autenticar los endpoints admin de rudewear.
//
// Dos variantes:
//   - requireAdminWithoutTwoFactor(): usada por los endpoints DEL flow
//     2FA (send/verify). Válida token + role='admin', punto.
//   - requireAdmin(): usada por los endpoints protegidos POST-2FA.
//     Además exige que admin2faPassedAt sea < ADMIN_2FA_WINDOW_MS.
//
// Ambas devuelven { ok: true, uid, data } o { ok: false, response }
// para que el caller haga `if (!auth.ok) return auth.response`.

/** Ventana de validez del 2FA. Después de esto, exigimos re-verify. */
export const ADMIN_2FA_WINDOW_MS = 30 * 60 * 1000;

interface UserDocData {
  role?: string;
  email?: string;
  admin2faPassedAt?: {
    toMillis: () => number;
  } | null;
  [k: string]: unknown;
}

export type AuthOk = {
  ok: true;
  uid: string;
  data: UserDocData;
};

export type AuthFail = { ok: false; response: NextResponse };
export type AuthResult = AuthOk | AuthFail;

async function verifyAndLoad(request: NextRequest): Promise<AuthResult> {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Missing auth token' }, { status: 401 }),
    };
  }
  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token, true);
    uid = decoded.uid;
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid auth token' }, { status: 401 }),
    };
  }
  let data: UserDocData;
  try {
    const snap = await adminDb.collection('users').doc(uid).get();
    if (!snap.exists) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'User not found' }, { status: 403 }),
      };
    }
    data = snap.data() as UserDocData;
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Auth error' }, { status: 500 }),
    };
  }
  if (data.role !== 'admin') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Admin only' }, { status: 403 }),
    };
  }
  return { ok: true, uid, data };
}

/**
 * Auth para endpoints del propio flow 2FA (send/verify del código de
 * email). Válida token + role='admin' pero NO exige que el 2FA ya
 * esté pasado — sería una gallina-huevo.
 */
export async function requireAdminWithoutTwoFactor(
  request: NextRequest
): Promise<AuthResult> {
  return verifyAndLoad(request);
}

/**
 * Auth para endpoints protegidos. Válida token + role='admin' +
 * `admin2faPassedAt` fresco (< 30 min). Si el 2FA es viejo o falta,
 * devuelve 403 con `need2fa: true` para que el cliente muestre el
 * prompt de re-verify.
 */
export async function requireAdmin(request: NextRequest): Promise<AuthResult> {
  const base = await verifyAndLoad(request);
  if (!base.ok) return base;
  const passedAt = base.data.admin2faPassedAt;
  const passedMs =
    passedAt && typeof passedAt.toMillis === 'function' ? passedAt.toMillis() : 0;
  const age = Date.now() - passedMs;
  if (!passedMs || age > ADMIN_2FA_WINDOW_MS) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: '2FA required', need2fa: true },
        { status: 403 }
      ),
    };
  }
  return base;
}
