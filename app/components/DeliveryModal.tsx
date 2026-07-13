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
import { auth } from '@/app/lib/firebase';
import type { User } from 'firebase/auth';

// Modal multi-step para reservar el servicio de delivery.
// Bajo 5 millas es gratis. Sobre 5 millas cobra millas × $1.50, que
// el driver COLECTA EN CASH al llegar — no se cobra online. El
// cliente debe checkear que acepta pagar al arribo.
//
// Steps:
//   1. phone    — cliente pone su phone
//   2. code     — SMS code (Firebase Phone Auth)
//   3. alias    — solo si es user nuevo, pide alias/name
//   4. details  — address + hora + notas + submit
//   5. success  — reserva confirmada

interface DeliveryModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = 'phone' | 'code' | 'alias' | 'details' | 'success';

interface FeePreview {
  miles: number;
  total: number;
  free: boolean;
  freeRadius: number;
  perMileRate: number;
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
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [notes, setNotes] = useState('');
  // Fee preview — recalculado cada vez que la address cambia.
  // Autoritativo lo re-computa el server al persistir.
  const [feeInfo, setFeeInfo] = useState<FeePreview | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const [feeError, setFeeError] = useState<string>('');
  const [agreed, setAgreed] = useState(false);

  const recaptchaRef = useRef<HTMLDivElement>(null);

  // Regenerar slots al abrir (para no mostrar horas pasadas si el
  // modal quedó abierto mucho rato).
  useEffect(() => {
    if (open) setSlots(getAvailableSlots());
  }, [open]);

  // Si el user ya está logueado, saltamos al step correcto y
  // pre-cargamos address si tiene guardada.
  useEffect(() => {
    if (!open) return;
    const unsub = onAuthChange(async (u) => {
      if (u) {
        setUser(u);
        const profile = await getCustomerProfile(u.uid);
        if (profile?.name) {
          setExistingName(profile.name);
          setAlias(profile.name);
          if (profile.address) setAddress(profile.address);
          setStep((s) => (s === 'phone' || s === 'code') ? 'details' : s);
        }
      } else {
        setUser(null);
      }
    });
    return () => unsub();
  }, [open]);

  // Recalcular fee cuando cambia la address (debounced 500ms).
  // El endpoint /api/calculate-fee llama Google Distance Matrix
  // server-side. Ignoramos races via un flag `cancelled`.
  useEffect(() => {
    if (step !== 'details') return;
    const trimmed = address.trim();
    if (trimmed.length < 5) {
      setFeeInfo(null);
      setFeeError('');
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setFeeLoading(true);
      setFeeError('');
      try {
        const res = await fetch('/api/calculate-fee', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: trimmed }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setFeeInfo(null);
          setFeeError(data.error || 'Could not check distance.');
          return;
        }
        setFeeInfo({
          miles: data.miles,
          total: data.total,
          free: data.free,
          freeRadius: data.breakdown?.freeRadius ?? 5,
          perMileRate: data.breakdown?.perMileRate ?? 1.5,
        });
        // Si la address cambia y ya no requiere fee, reseteamos el
        // acuerdo — el checkbox tiene que ser explícito para el nuevo
        // monto.
        setAgreed(false);
      } catch (err) {
        if (cancelled) return;
        setFeeInfo(null);
        setFeeError(err instanceof Error ? err.message : 'Distance check failed');
      } finally {
        if (!cancelled) setFeeLoading(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [address, step]);

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
      const profile = await getCustomerProfile(u.uid);
      if (profile?.name) {
        setExistingName(profile.name);
        setAlias(profile.name);
        if (profile.address) setAddress(profile.address);
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
      await saveCustomerProfile(user.uid, {
        name: cleanAlias,
        phone: digits,
      });
      setStep('details');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitDelivery = async () => {
    if (!user || !selectedSlot || !address) {
      setError('Complete all fields first.');
      return;
    }
    if (!feeInfo) {
      setError('Wait for the distance check to finish.');
      return;
    }
    if (!feeInfo.free && !agreed) {
      setError('Please check the box agreeing to pay the delivery fee on arrival.');
      return;
    }
    setError('');
    setLoading(true);

    // Guardá también la address en el perfil para la próxima visita.
    try {
      if (existingName) {
        await saveCustomerProfile(user.uid, {
          name: existingName,
          phone: '',
          address,
        });
      } else {
        await saveCustomerProfile(user.uid, {
          name: alias,
          phone: phone.replace(/\D/g, ''),
          address,
        });
      }
    } catch (err) {
      console.warn('[delivery] save profile failed (non-fatal):', err);
    }

    // POST /api/create-delivery
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Session expired. Sign in again.');
      const slotObj = slots.find((s) => s.iso === selectedSlot);
      const scheduledDay = slotObj?.day || 'today';
      const res = await fetch('/api/create-delivery', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          address,
          scheduledAt: selectedSlot,
          scheduledDay,
          notes,
          customerName: existingName || alias,
          agreedToPayOnArrival: feeInfo.free ? true : agreed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Save failed (status ${res.status})`);
      }
      setStep('success');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setLoading(false);
    }
  };

  const resetAndClose = () => {
    // Al cerrar después del success, limpiamos el form por si el
    // customer quiere hacer OTRA reserva en la misma sesión.
    setStep(existingName ? 'details' : 'phone');
    setError('');
    setCode('');
    setNotes('');
    setSelectedSlot('');
    setAgreed(false);
    // NO limpio feeInfo — el useEffect lo va a re-computar apenas
    // la address se re-renderea.
    onClose();
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
              {step === 'details' && (existingName ? 'Details' : 'Step 4 of 4')}
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
          {step === 'phone' && (
            <form onSubmit={handleSendCode} className="flex flex-col gap-4">
              <p className="text-sm text-neutral-400 mb-2">
                We&apos;ll text you a code to verify your number. We use it to
                call you when the driver arrives at your door.
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

          {step === 'code' && (
            <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
              <p className="text-sm text-neutral-400 mb-2">
                Enter the 6-digit code sent to{' '}
                <strong className="text-white">{formatPhoneDisplay(phone)}</strong>.
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

          {step === 'details' && (
            <div className="flex flex-col gap-5">
              {existingName && (
                <p className="text-xs text-neutral-500">
                  Signed in as{' '}
                  <strong className="text-neutral-300">{existingName}</strong>
                </p>
              )}

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                  Delivery address
                </label>
                <AddressInput
                  value={address}
                  onChange={setAddress}
                  placeholder="Start typing your address…"
                />
              </div>

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
                  Mobile store hours: 9 AM – 7 PM · 2-hour windows.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                  Notes for the driver (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Gate code, apartment #, styles you're interested in…"
                  className={inputCls}
                />
              </div>

              {/* Fee preview — depende del resultado de /api/calculate-fee */}
              {address.trim().length >= 5 && (
                <div className="border border-neutral-800 bg-neutral-900/50 rounded p-4 text-sm">
                  {feeLoading && (
                    <p className="text-neutral-400 text-xs">
                      Checking distance…
                    </p>
                  )}
                  {!feeLoading && feeError && (
                    <p className="text-red-500 text-xs">{feeError}</p>
                  )}
                  {!feeLoading && !feeError && feeInfo && feeInfo.free && (
                    <>
                      <p className="font-bold text-green-400 mb-1">
                        Free delivery
                      </p>
                      <p className="text-neutral-400 text-xs">
                        {feeInfo.miles} mi from us — under our{' '}
                        {feeInfo.freeRadius}-mile free radius. Just pay for the
                        clothes in person when the driver arrives.
                      </p>
                    </>
                  )}
                  {!feeLoading && !feeError && feeInfo && !feeInfo.free && (
                    <>
                      <div className="flex items-baseline justify-between mb-1">
                        <p className="font-bold text-white">Delivery fee</p>
                        <p className="text-2xl font-black text-red-400 tabular-nums">
                          ${feeInfo.total.toFixed(2)}
                        </p>
                      </div>
                      <p className="text-neutral-400 text-xs mb-3">
                        {feeInfo.miles} mi from us. First {feeInfo.freeRadius} mi
                        are normally free, but your address is outside that zone.
                      </p>
                      <label className="flex items-start gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={agreed}
                          onChange={(e) => setAgreed(e.target.checked)}
                          className="mt-0.5 w-4 h-4 accent-red-600 cursor-pointer"
                        />
                        <span className="text-xs text-neutral-300 group-hover:text-white transition-colors">
                          I agree to pay{' '}
                          <strong className="text-white">
                            ${feeInfo.total.toFixed(2)}
                          </strong>{' '}
                          by card or cash to the driver when they arrive.
                        </span>
                      </label>
                    </>
                  )}
                </div>
              )}

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button
                type="button"
                onClick={handleSubmitDelivery}
                disabled={
                  loading ||
                  !address ||
                  !selectedSlot ||
                  feeLoading ||
                  !feeInfo ||
                  (!feeInfo.free && !agreed)
                }
                className={btnPrimaryCls}
              >
                {loading ? 'Submitting…' : 'Confirm request'}
              </button>
            </div>
          )}

          {step === 'success' && (
            <div className="text-center py-4">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-600 flex items-center justify-center text-white text-3xl">
                ✓
              </div>
              <p className="text-lg font-black uppercase mb-2">Reservation received</p>
              <p className="text-sm text-neutral-400 mb-6">
                We&apos;ll call you at{' '}
                <strong className="text-white">
                  {formatPhoneDisplay(phone || existingName ? phone : phone)}
                </strong>{' '}
                when the driver is near your door.
              </p>
              <button onClick={resetAndClose} className={btnPrimaryCls}>
                Close
              </button>
            </div>
          )}
        </div>

        <div id="rudewear-delivery-recaptcha" ref={recaptchaRef} />
      </div>
    </div>
  );
}

const inputCls =
  'w-full px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded text-white placeholder:text-neutral-600 focus:outline-none focus:border-red-600 transition-colors';

const btnPrimaryCls =
  'w-full px-4 py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold uppercase tracking-wide rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
