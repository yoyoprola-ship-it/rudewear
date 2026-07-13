'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { auth, db } from '@/app/lib/firebase';
import {
  confirmSmsCode,
  sendSmsCode,
  setupRecaptcha,
  signOut,
} from '@/app/lib/auth';
import type { Delivery, DeliveryStatus } from '@/app/types';

// Página pública para que el cliente vea sus reservas activas y las
// cancele. Flow:
//   1. Phone      → pre-flight /check-customer-phone + enviar SMS
//   2. Code       → verificar SMS
//   3. List       → mostrar las reservas cancelables + botón Cancel
//
// El cancel corre por /api/cancel-delivery (Admin SDK bypass) para que
// el server valide ownership + transición y dispare SMS al admin.
// La rule Firestore permite al owner LEER sus reservas (para la lista)
// pero no updatear — cancel debe pasar por el endpoint server.

type Step = 'phone' | 'code' | 'list';

export default function MyDeliveriesPage() {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const recaptchaRef = useRef<HTMLDivElement>(null);

  const formatPhoneDisplay = (v: string): string => {
    const d = v.replace(/\D/g, '').slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    const digits = phone.replace(/\D/g, '');
    if (digits.length !== 10) {
      setError('Enter a valid 10-digit US phone number.');
      return;
    }
    setLoading(true);
    try {
      // Pre-flight: no gastar SMS si el phone no tiene reservas activas.
      const preRes = await fetch('/api/check-customer-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: digits }),
      });
      const preData = await preRes.json().catch(() => ({}));
      if (!preRes.ok) {
        if (preRes.status === 429) {
          setError('Too many attempts from your network. Wait a minute.');
        } else {
          setError(preData.error || 'Could not check your number. Try again.');
        }
        setLoading(false);
        return;
      }
      if (!preData.hasActive) {
        setError('No active reservations found for this number.');
        setLoading(false);
        return;
      }

      if (!recaptchaRef.current) throw new Error('reCAPTCHA container missing.');
      setupRecaptcha(recaptchaRef.current.id);
      await sendSmsCode(digits);
      setStep('code');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send code';
      if (msg.includes('too-many-requests')) setError('Too many attempts. Wait a few minutes.');
      else if (msg.includes('invalid-phone')) setError('Invalid phone number.');
      else if (msg.includes('quota')) setError('SMS quota exceeded for today.');
      else setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    if (code.length !== 6) {
      setError('Code must be 6 digits.');
      return;
    }
    setLoading(true);
    try {
      const user = await confirmSmsCode(code);
      // Buscar las reservas del user por uid. La rule permite al owner
      // leer las suyas (userId == request.auth.uid).
      const snap = await getDocs(
        query(
          collection(db, 'rudewear_deliveries'),
          where('userId', '==', user.uid),
          where('status', 'in', ['requested', 'confirmed'])
        )
      );
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Delivery)
        // Upcoming primero — scheduledAt es ISO local, comparación lex.
        .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
      setDeliveries(list);
      setStep('list');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      if (msg.includes('invalid-verification-code') || msg.includes('code-expired')) {
        setError('Wrong or expired code.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (d: Delivery) => {
    if (cancellingId) return;
    const when = formatWhen(d.scheduledAt, d.scheduledDay);
    if (!confirm(`Cancel your reservation for ${when}?`)) return;
    setCancellingId(d.id);
    setError('');
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Session expired. Verify your phone again.');
      const res = await fetch('/api/cancel-delivery', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ deliveryId: d.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Cancel failed (status ${res.status})`);
        return;
      }
      setDeliveries((prev) => prev.filter((x) => x.id !== d.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setCancellingId(null);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {}
    setStep('phone');
    setCode('');
    setError('');
    setDeliveries([]);
  };

  return (
    <main className="min-h-screen bg-black text-white px-6 py-12">
      <div className="w-full max-w-lg mx-auto">
        <Link
          href="/"
          className="text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider"
        >
          ← Home
        </Link>

        <h1 className="text-3xl font-black uppercase tracking-tighter mt-6 mb-1">
          Manage delivery<span className="text-red-600">.</span>
        </h1>

        {step !== 'list' && (
          <>
            <div className="w-12 h-1 bg-red-600 mb-6" />
            <p className="text-sm text-neutral-500 mb-6">
              {step === 'phone'
                ? 'Verify your phone to see and cancel your reservations.'
                : `Enter the 6-digit code sent to ${phone}.`}
            </p>
          </>
        )}

        {step === 'phone' && (
          <form onSubmit={handleSendCode} className="flex flex-col gap-4">
            <label className="block">
              <span className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                Phone number
              </span>
              <div className="flex items-center gap-2">
                <span className="text-neutral-500 text-sm">+1</span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(337) 123-4567"
                  value={formatPhoneDisplay(phone)}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={loading}
                  required
                  className={inputCls}
                />
              </div>
            </label>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button type="submit" disabled={loading} className={btnCls}>
              {loading ? 'Checking…' : 'Send code'}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={loading}
              required
              autoFocus
              className={`${inputCls} text-center text-2xl font-black tracking-[0.5em]`}
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className={btnCls}
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('phone'); setCode(''); setError(''); }}
              disabled={loading}
              className="text-xs text-neutral-500 hover:text-neutral-300"
            >
              ← Change phone number
            </button>
          </form>
        )}

        {step === 'list' && (
          <div className="mt-6">
            <div className="flex items-baseline justify-between mb-4">
              <p className="text-sm text-neutral-400">
                {deliveries.length === 0
                  ? 'No active reservations.'
                  : `${deliveries.length} active reservation${deliveries.length === 1 ? '' : 's'}`}
              </p>
              <button
                onClick={handleSignOut}
                className="text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider"
              >
                Sign out
              </button>
            </div>

            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

            {deliveries.length === 0 ? (
              <div className="border border-neutral-800 rounded p-6 text-center">
                <p className="text-neutral-500 mb-4">
                  You have no active reservations to cancel.
                </p>
                <Link
                  href="/"
                  className="inline-block px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-bold uppercase tracking-wide"
                >
                  Back home
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {deliveries.map((d) => (
                  <ReservationCard
                    key={d.id}
                    d={d}
                    busy={cancellingId === d.id}
                    onCancel={() => handleCancel(d)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div id="rudewear-my-deliveries-recaptcha" ref={recaptchaRef} />
      </div>
    </main>
  );
}

function ReservationCard({
  d,
  busy,
  onCancel,
}: {
  d: Delivery;
  busy: boolean;
  onCancel: () => void;
}) {
  const when = formatWhen(d.scheduledAt, d.scheduledDay);
  return (
    <div
      className={`border rounded p-4 ${
        busy ? 'opacity-50' : ''
      } ${
        d.status === 'confirmed'
          ? 'border-amber-900/60 bg-amber-950/10'
          : 'border-red-900/60 bg-red-950/10'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <StatusBadge status={d.status} />
        <p className="font-bold text-white">{when}</p>
      </div>
      <p className="text-sm text-neutral-300 mb-1 break-words">
        <span className="text-neutral-500 uppercase tracking-wider text-[10px] font-bold mr-1">
          Address
        </span>
        {d.address}
      </p>
      {typeof d.deliveryFee === 'number' && d.deliveryFee > 0 && (
        <p className="text-sm text-neutral-300 mb-3">
          <span className="text-neutral-500 uppercase tracking-wider text-[10px] font-bold mr-1">
            Fee
          </span>
          ${d.deliveryFee.toFixed(2)} card or cash on arrival
        </p>
      )}
      {typeof d.deliveryFee === 'number' && d.deliveryFee === 0 && (
        <p className="text-sm text-green-400 mb-3">Free delivery</p>
      )}
      <button
        onClick={onCancel}
        disabled={busy}
        className="w-full px-3 py-2 border border-red-800 text-red-400 hover:bg-red-950 disabled:opacity-40 rounded text-xs font-bold uppercase tracking-wide"
      >
        {busy ? 'Cancelling…' : 'Cancel reservation'}
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: DeliveryStatus }) {
  const styles: Record<DeliveryStatus, string> = {
    requested: 'bg-red-950/50 text-red-300 border border-red-900',
    confirmed: 'bg-amber-950/50 text-amber-300 border border-amber-900',
    delivered: 'bg-green-950/50 text-green-300 border border-green-900',
    cancelled: 'bg-neutral-900 text-neutral-500 border border-neutral-800',
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function formatWhen(iso: string, day: 'today' | 'tomorrow'): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):/);
  if (!m) return `${day} ${iso}`;
  const [, y, mo, dNum, hh] = m;
  const hourStart = parseInt(hh, 10);
  const hourEnd = hourStart + 2;
  const timeLabel = `${to12h(hourStart)}–${to12h(hourEnd)}`;

  const laToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const isoDate = `${y}-${mo}-${dNum}`;

  if (isoDate === laToday) return `Today · ${timeLabel}`;
  const tmr = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const laTmr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(tmr);
  if (isoDate === laTmr) return `Tomorrow · ${timeLabel}`;

  const monthName = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(
    new Date(`${y}-${mo}-${dNum}T12:00:00`)
  );
  return `${monthName} ${parseInt(dNum, 10)} · ${timeLabel} (${day})`;
}

function to12h(h: number): string {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
}

const inputCls =
  'w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded text-white placeholder:text-neutral-600 focus:outline-none focus:border-red-600 transition-colors';

const btnCls =
  'w-full px-4 py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold uppercase tracking-wide rounded transition-colors disabled:opacity-50';
