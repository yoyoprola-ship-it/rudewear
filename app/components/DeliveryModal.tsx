'use client';
import { useEffect, useRef, useState } from 'react';
import {
  confirmSmsCode,
  onAuthChange,
  sendSmsCode,
  setupRecaptcha,
} from '@/app/lib/auth';
import {
  getCustomerProfile,
  saveCustomerProfile,
} from '@/app/lib/customer';
import { formatSlot, getAvailableSlots, type TimeSlot } from '@/app/lib/timeSlots';
import AddressInput from './AddressInput';
import type { User } from 'firebase/auth';

// Modal multi-step para reservar el servicio de delivery.
// Steps:
//   1. phone    — cliente pone su phone
//   2. code     — verifica SMS code de Firebase
//   3. alias    — solo si es user nuevo, pide alias/name
//   4. details  — address + fecha/hora + notas + preview del fee
//   5. pay      — Stripe payment (delegado a página aparte en Fase 3c)
//   6. success  — reserva confirmada

interface DeliveryModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = 'phone' | 'code' | 'alias' | 'details' | 'success';

interface FeeBreakdown {
  miles: number;
  minutes: number;
  distanceFee: number;
  timeFee: number;
  baseFee: number;
  total: number;
}

export default function DeliveryModal({ open, onClose }: DeliveryModalProps) {
  const [step, setStep] = useState<Step>('phone');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Auth state
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [alias, setAlias] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [existingName, setExistingName] = useState('');

  // Details form
  const [address, setAddress] = useState('');
  const [addressCoords, setAddressCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [addressZip, setAddressZip] = useState<string | null>(null);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [feeBreakdown, setFeeBreakdown] = useState<FeeBreakdown | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);

  const recaptchaRef = useRef<HTMLDivElement>(null);

  // Generar slots al abrir el modal — cada vez que se abre re-checkea la hora.
  useEffect(() => {
    if (open) {
      setSlots(getAvailableSlots());
    }
  }, [open]);

  // Auth listener — si el user ya está logueado (venia de otra visita
  // o del /admin), saltamos directo a details.
  useEffect(() => {
    if (!open) return;
    const unsub = onAuthChange(async (u) => {
      if (u) {
        setUser(u);
        // Load profile — si tiene name, saltamos alias
        const profile = await getCustomerProfile(u.uid);
        if (profile?.name) {
          setExistingName(profile.name);
          setAlias(profile.name);
          setStep((s) => (s === 'phone' || s === 'code') ? 'details' : s);
        }
      } else {
        setUser(null);
      }
    });
    return () => unsub();
  }, [open]);

  // Cuando address se finaliza + hay coords → calcular fee
  useEffect(() => {
    if (!address || !addressCoords) {
      setFeeBreakdown(null);
      return;
    }
    let cancelled = false;
    setFeeLoading(true);
    setError('');
    (async () => {
      try {
        const res = await fetch('/api/calculate-fee', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || 'Could not calculate fee.');
          setFeeBreakdown(null);
        } else {
          setFeeBreakdown(data.breakdown);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Fee calc failed');
        setFeeBreakdown(null);
      } finally {
        if (!cancelled) setFeeLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [address, addressCoords]);

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
      setError('Enter a valid 10-digit US phone.');
      return;
    }
    setLoading(true);
    try {
      if (!recaptchaRef.current) throw new Error('reCAPTCHA missing');
      setupRecaptcha(recaptchaRef.current.id);
      await sendSmsCode(digits);
      setStep('code');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send code';
      if (msg.includes('too-many-requests')) setError('Too many attempts. Wait a bit.');
      else if (msg.includes('invalid-phone')) setError('Invalid phone.');
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
      const u = await confirmSmsCode(code);
      setUser(u);
      // Check profile
      const profile = await getCustomerProfile(u.uid);
      if (profile?.name) {
        setExistingName(profile.name);
        setAlias(profile.name);
        setStep('details');
      } else {
        setStep('alias');
      }
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

  const handleSaveAlias = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !user) return;
    setError('');
    const cleanAlias = alias.trim();
    if (cleanAlias.length < 2 || cleanAlias.length > 40) {
      setError('Alias must be 2–40 characters.');
      return;
    }
    setLoading(true);
    try {
      const digits = phone.replace(/\D/g, '');
      await saveCustomerProfile(user.uid, cleanAlias, digits);
      setStep('details');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setLoading(false);
    }
  };

  const handleContinueToPay = () => {
    if (!user || !feeBreakdown || !addressCoords || !selectedSlot) {
      setError('Complete all fields first.');
      return;
    }
    // En Fase 3c reemplazamos esto por el checkout de Stripe real.
    // Por ahora simulamos success para poder testear el flow.
    setStep('success');
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        className="bg-neutral-950 border border-neutral-800 w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-neutral-950 border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">
              {step === 'phone' && 'Step 1 of 4'}
              {step === 'code' && 'Step 2 of 4'}
              {step === 'alias' && 'Step 3 of 4'}
              {step === 'details' && (existingName ? 'Step 3 of 3' : 'Step 4 of 4')}
              {step === 'success' && 'Done'}
            </p>
            <h2 className="text-lg font-black uppercase tracking-tight text-white">
              Request delivery
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-white text-2xl"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-6">
          {/* STEP 1 — PHONE */}
          {step === 'phone' && (
            <form onSubmit={handleSendCode} className="flex flex-col gap-4">
              <p className="text-sm text-neutral-400 mb-2">
                We&apos;ll text you a code to verify your number.
              </p>
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
              <button type="submit" disabled={loading} className={btnPrimaryCls}>
                {loading ? 'Sending…' : 'Send code'}
              </button>
            </form>
          )}

          {/* STEP 2 — CODE */}
          {step === 'code' && (
            <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
              <p className="text-sm text-neutral-400 mb-2">
                Enter the 6-digit code sent to <strong className="text-white">{formatPhoneDisplay(phone)}</strong>.
              </p>
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
                className={btnPrimaryCls}
              >
                {loading ? 'Verifying…' : 'Verify'}
              </button>
              <button
                type="button"
                onClick={() => { setStep('phone'); setCode(''); setError(''); }}
                disabled={loading}
                className="text-xs text-neutral-500 hover:text-neutral-300"
              >
                ← Change number
              </button>
            </form>
          )}

          {/* STEP 3 — ALIAS (solo si es nuevo) */}
          {step === 'alias' && (
            <form onSubmit={handleSaveAlias} className="flex flex-col gap-4">
              <p className="text-sm text-neutral-400 mb-2">
                What should we call you?
              </p>
              <input
                type="text"
                autoComplete="nickname"
                placeholder="Your alias"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                disabled={loading}
                maxLength={40}
                required
                autoFocus
                className={inputCls}
              />
              {error && <p className="text-sm text-red-500">{error}</p>}
              <button type="submit" disabled={loading} className={btnPrimaryCls}>
                {loading ? 'Saving…' : 'Continue'}
              </button>
            </form>
          )}

          {/* STEP 4 — DETAILS */}
          {step === 'details' && (
            <div className="flex flex-col gap-5">
              {existingName && (
                <p className="text-xs text-neutral-500">
                  Signed in as <strong className="text-neutral-300">{existingName}</strong>
                </p>
              )}

              {/* Address */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                  Delivery address
                </label>
                <AddressInput
                  value={address}
                  onChange={setAddress}
                  onCoordsChange={setAddressCoords}
                  onZipChange={setAddressZip}
                  placeholder="Start typing your address…"
                />
              </div>

              {/* Time slot */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                  When
                </label>
                <select
                  value={selectedSlot}
                  onChange={(e) => setSelectedSlot(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Pick a time slot</option>
                  {slots.length === 0 && (
                    <option value="" disabled>
                      No slots available. Try tomorrow morning.
                    </option>
                  )}
                  {slots.map((s) => (
                    <option key={s.iso} value={s.iso}>
                      {formatSlot(s)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-neutral-500 mt-1">
                  Mobile store hours: 9 AM – 7 PM
                </p>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                  Notes for the driver (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={300}
                  placeholder="Gate code, apartment #, styles you're interested in…"
                  className={inputCls}
                />
              </div>

              {/* Fee preview */}
              {feeLoading && (
                <div className="p-3 border border-neutral-800 rounded bg-neutral-900 text-center text-neutral-500 text-sm">
                  Calculating fee…
                </div>
              )}
              {feeBreakdown && !feeLoading && (
                <div className="p-4 border border-red-800/40 bg-red-950/20 rounded space-y-1 text-sm">
                  <div className="flex justify-between text-neutral-400">
                    <span>Distance ({feeBreakdown.miles} mi × $1)</span>
                    <span>${feeBreakdown.distanceFee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Time ({feeBreakdown.minutes} min × $20/hr)</span>
                    <span>${feeBreakdown.timeFee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Base</span>
                    <span>${feeBreakdown.baseFee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-white font-black text-lg pt-2 border-t border-neutral-800 mt-2">
                    <span>Delivery fee</span>
                    <span>${feeBreakdown.total.toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-neutral-500 pt-1">
                    Products are paid separately at your door.
                  </p>
                </div>
              )}

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button
                type="button"
                onClick={handleContinueToPay}
                disabled={!feeBreakdown || !selectedSlot || feeLoading}
                className={btnPrimaryCls}
              >
                Continue to payment
              </button>
            </div>
          )}

          {/* STEP 5 — SUCCESS (placeholder until Fase 3c) */}
          {step === 'success' && (
            <div className="text-center py-4">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-600 flex items-center justify-center text-white text-3xl">
                ✓
              </div>
              <p className="text-lg font-black uppercase mb-2">Reservation received</p>
              <p className="text-sm text-neutral-400 mb-6">
                Payment integration coming in the next phase. This step is a placeholder.
              </p>
              <button onClick={onClose} className={btnPrimaryCls}>
                Close
              </button>
            </div>
          )}
        </div>

        {/* reCAPTCHA invisible */}
        <div id="rudewear-delivery-recaptcha" ref={recaptchaRef} />
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const inputCls =
  'w-full px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded text-white placeholder:text-neutral-600 focus:outline-none focus:border-red-600 transition-colors';

const btnPrimaryCls =
  'w-full px-4 py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold uppercase tracking-wide rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
