// ─── Rate Limiter (Serverless-compatible) ────────────────────
// Token bucket con backend en Firestore (colección `rateLimits`).
// Fallback a memoria local cuando Firestore no responde. Ambos
// backends usan la MISMA key sanitizada para que un flip no resetee
// buckets involuntariamente.
//
// La colección `rateLimits` está compartida con Lafayette Market —
// ambas apps escriben ahí (mismo Firebase project). Como el
// identificador incluye scope prefix (`sms-send`, `2fa-verify`, …),
// no hay colisión entre apps mientras cada scope sea único.
//
// Firestore TTL policy (una vez, manual): Collection `rateLimits`,
// field `expiresAt`. Los docs se autoborran después de 1h.

import { adminDb } from './firebaseAdmin';
import { NextResponse } from 'next/server';

interface MemEntry {
  tokens: number;
  lastRefill: number;
}
const MEM_STORE_MAX_ENTRIES = 10_000;
const memStore = new Map<string, MemEntry>();

function evictOldestIfFull() {
  if (memStore.size < MEM_STORE_MAX_ENTRIES) return;
  const toRemove = Math.max(1, Math.floor(MEM_STORE_MAX_ENTRIES * 0.1));
  let removed = 0;
  for (const key of memStore.keys()) {
    memStore.delete(key);
    if (++removed >= toRemove) break;
  }
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

const FALLBACK: RateLimitConfig = { maxRequests: 30, windowMs: 60_000 };

// Firestore no permite algunos chars en doc IDs.
function safeKey(key: string): string {
  return key.replace(/[/.#$[\]]/g, '_').slice(0, 1400);
}

export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig = FALLBACK
): Promise<RateLimitResult> {
  const key = safeKey(identifier);
  const now = Date.now();

  try {
    const ref = adminDb.collection('rateLimits').doc(key);
    const result = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const refillRate = config.maxRequests / config.windowMs;

      let tokens: number;
      let lastRefill: number;

      if (!snap.exists) {
        tokens = config.maxRequests - 1;
        lastRefill = now;
      } else {
        const data = snap.data()!;
        const elapsed = now - (data.lastRefill || now);
        const toAdd = elapsed * refillRate;
        tokens = Math.min(config.maxRequests, (data.tokens || 0) + toAdd);
        lastRefill = now;
      }

      if (tokens < 1) {
        const waitMs = Math.ceil((1 - tokens) / refillRate);
        tx.set(
          ref,
          {
            tokens,
            lastRefill,
            expiresAt: new Date(now + 60 * 60 * 1000),
          },
          { merge: true }
        );
        return { allowed: false, remaining: 0, retryAfterMs: waitMs };
      }

      tokens -= 1;
      tx.set(
        ref,
        {
          tokens,
          lastRefill,
          expiresAt: new Date(now + 60 * 60 * 1000),
        },
        { merge: true }
      );
      return { allowed: true, remaining: Math.floor(tokens), retryAfterMs: 0 };
    });

    return result;
  } catch {
    return checkRateLimitMem(key, config);
  }
}

function checkRateLimitMem(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  let entry = memStore.get(identifier);
  const refillRate = config.maxRequests / config.windowMs;

  if (!entry) {
    evictOldestIfFull();
    entry = { tokens: config.maxRequests - 1, lastRefill: now };
    memStore.set(identifier, entry);
    return { allowed: true, remaining: entry.tokens, retryAfterMs: 0 };
  }

  const elapsed = now - entry.lastRefill;
  entry.tokens = Math.min(
    config.maxRequests,
    entry.tokens + elapsed * refillRate
  );
  entry.lastRefill = now;

  if (entry.tokens < 1) {
    const waitMs = Math.ceil((1 - entry.tokens) / refillRate);
    return { allowed: false, remaining: 0, retryAfterMs: waitMs };
  }

  entry.tokens -= 1;
  return { allowed: true, remaining: Math.floor(entry.tokens), retryAfterMs: 0 };
}

export function getClientIp(headers: Headers): string {
  // Behind Cloud Run / App Hosting, X-Forwarded-For es appendeado por
  // proxies confiables — el LAST hop es el IP real del cliente. Leer
  // el first hop deja spoofear con `X-Forwarded-For: 1.2.3.4`.
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }
  return headers.get('x-real-ip') || 'unknown';
}

/** Si allowed, devuelve null. Si no, un NextResponse 429 listo para
 *  return. Ejemplo:
 *    const rl = await rateLimitOr429(`sms-send:${ip}`, {...});
 *    if (rl) return rl;
 */
export async function rateLimitOr429(
  identifier: string,
  config?: RateLimitConfig
): Promise<NextResponse | null> {
  const { allowed, retryAfterMs } = await checkRateLimit(identifier, config);
  if (allowed) return null;
  return NextResponse.json(
    { error: 'Too many requests. Please wait before trying again.' },
    {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
    }
  );
}

/** Rate limit por uid (para endpoints autenticados). El uid es la
 *  cubeta — dos users detrás del mismo NAT no se pisan. */
export async function userRateLimitOr429(
  scope: string,
  uid: string,
  config?: RateLimitConfig
): Promise<NextResponse | null> {
  return rateLimitOr429(`${scope}:uid:${uid}`, config);
}
