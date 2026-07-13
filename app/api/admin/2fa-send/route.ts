import { NextRequest, NextResponse } from 'next/server';
import crypto, { randomInt } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/app/lib/firebaseAdmin';
import { requireAdminWithoutTwoFactor } from '@/app/lib/adminApiAuth';
import { maskEmail } from '@/app/lib/maskEmail';
import {
  getClientIp,
  rateLimitOr429,
  userRateLimitOr429,
} from '@/app/lib/rateLimit';

// POST /api/admin/2fa-send
// Header: Authorization: Bearer <Firebase ID token>
//
// Step 2 del flow admin login: después del SMS verify, el cliente
// llama acá para que el server mande un código 6-dígitos al email
// del admin. El email NUNCA viene del body — lo lee del user doc.
//
// Anti-spam:
//   - Si ya hay un código activo creado hace <60s, rechaza con 429.
//     El admin puede pedir uno nuevo pero no puede spamear resend.

const RESEND_COOLDOWN_MS = 60_000; // 1 minuto entre resends
const CODE_TTL_MS = 10 * 60 * 1000; // 10 min de validez del código

function hashCode(code: string): string | null {
  const secret =
    process.env.EMAIL_CODE_HASH_SECRET || process.env.INTERNAL_API_SECRET;
  if (!secret) return null;
  return crypto.createHash('sha256').update(code + secret).digest('hex');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function POST(request: NextRequest) {
  // IP rate limit ANTES de la auth — un atacante sin token puede
  // martillar el endpoint y consumir CPU verificando tokens inválidos.
  const ip = getClientIp(request.headers);
  const ipRl = await rateLimitOr429(`rw-admin-2fa-send-ip:${ip}`, {
    maxRequests: 10,
    windowMs: 60_000,
  });
  if (ipRl) return ipRl;

  const caller = await requireAdminWithoutTwoFactor(request);
  if (!caller.ok) return caller.response;

  // Per-uid: 5 requests cada 30 min. Un admin comprometido no puede
  // spamear emails al mail-box del admin (aunque el cooldown de 60s
  // ya lo limita, esto añade una capa acumulativa).
  const uidRl = await userRateLimitOr429('rw-admin-2fa-send', caller.uid, {
    maxRequests: 5,
    windowMs: 30 * 60 * 1000,
  });
  if (uidRl) return uidRl;

  const adminEmail =
    typeof caller.data.email === 'string'
      ? caller.data.email.trim().toLowerCase()
      : '';
  if (!adminEmail || !adminEmail.includes('@')) {
    return NextResponse.json(
      {
        error: 'No email configured for admin 2FA',
        hint:
          'Set the `email` field on your user doc (users/' +
          caller.uid +
          ') in Firebase console.',
      },
      { status: 400 }
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail =
    process.env.EMAIL_FROM || 'Rudewear <onboarding@resend.dev>';
  if (!apiKey) {
    console.error('[admin/2fa-send] RESEND_API_KEY not set');
    return NextResponse.json({ error: 'Email not configured' }, { status: 500 });
  }

  // Cooldown check — evita spam de resends.
  const docRef = adminDb.doc(`rudewear_adminTwoFactor/${caller.uid}`);
  try {
    const existing = await docRef.get();
    if (existing.exists) {
      const created = existing.data()?.createdAt;
      const createdMs =
        created && typeof created.toMillis === 'function'
          ? created.toMillis()
          : 0;
      if (createdMs > 0 && Date.now() - createdMs < RESEND_COOLDOWN_MS) {
        const secLeft = Math.ceil(
          (RESEND_COOLDOWN_MS - (Date.now() - createdMs)) / 1000
        );
        return NextResponse.json(
          { error: `Wait ${secLeft}s before requesting a new code.` },
          { status: 429 }
        );
      }
    }
  } catch (err) {
    console.warn('[admin/2fa-send] cooldown check failed (non-fatal):', err);
  }

  const verificationCode = randomInt(100000, 1000000).toString();
  const codeHash = hashCode(verificationCode);
  if (!codeHash) {
    console.error(
      '[admin/2fa-send] EMAIL_CODE_HASH_SECRET / INTERNAL_API_SECRET not set'
    );
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  // Guardamos el hash (nunca el código raw). Overwrite si ya había uno
  // — el cooldown ya prevención abuso; una vez pasado, el admin puede
  // regenerar.
  await docRef.set({
    codeHash,
    uid: caller.uid,
    sentToEmail: adminEmail,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
    attempts: 0,
  });

  try {
    const safeCode = escapeHtml(verificationCode);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [adminEmail],
        subject: `${safeCode} — Rudewear admin 2FA`,
        html: `
          <div style="font-family: 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #000; color: #fff;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h1 style="color: #fff; font-size: 28px; margin: 0; letter-spacing: -0.02em;">
                Rudewear<span style="color: #dc2626;">.</span>
              </h1>
              <p style="color: #737373; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; margin: 4px 0 0;">admin</p>
            </div>
            <p style="color: #fff; font-size: 18px; font-weight: 700; margin: 0 0 8px; text-align: center;">
              Your 2FA code
            </p>
            <p style="color: #a3a3a3; font-size: 13px; margin: 0 0 24px; text-align: center;">
              Expires in 10 minutes.
            </p>
            <div style="text-align: center; margin: 24px 0;">
              <span style="
                display: inline-block; padding: 16px 32px;
                background: #111; border: 2px solid #dc2626;
                border-radius: 8px; font-size: 32px; font-weight: 900;
                letter-spacing: 8px; color: #fff;
              ">${safeCode}</span>
            </div>
            <p style="color: #fca5a5; font-size: 12px; line-height: 1.5; margin-top: 24px; padding-top: 16px; border-top: 1px solid #262626;">
              <strong style="color: #ef4444;">If you didn't sign in</strong>, someone may
              have your phone. Do NOT share this code. Change your phone number in
              Firebase console.
            </p>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[admin/2fa-send] Resend error:', err);
      return NextResponse.json({ error: 'Failed to send code' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      maskedEmail: maskEmail(adminEmail),
    });
  } catch (e) {
    console.error('[admin/2fa-send] Error:', e);
    return NextResponse.json({ error: 'Failed to send code' }, { status: 500 });
  }
}
