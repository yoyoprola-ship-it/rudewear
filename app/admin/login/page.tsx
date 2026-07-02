'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  confirmSmsCode,
  isAdmin,
  onAuthChange,
  sendSmsCode,
  setupRecaptcha,
} from '@/app/lib/auth';

// Login del admin — mismo flow que Lafayette Market (phone auth SMS).
// Como comparten Firebase project, si tu número YA es admin en
// Lafayette (users/{uid}.role='admin'), entrás directo acá sin
// crear cuenta nueva.

type Step = 'phone' | 'code';

export default function AdminLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkingAuth, setCheckingAuth] = useState(true);
  const recaptchaRef = useRef<HTMLDivElement>(null);

  // Si ya está logueado + es admin → dashboard.
  useEffect(() => {
    const unsub = onAuthChange(async (user) => {
      if (user && (await isAdmin(user.uid))) {
        router.replace('/admin');
      } else {
        setCheckingAuth(false);
      }
    });
    return () => unsub();
  }, [router]);

  // Formateo del phone: acepta cualquier input y muestra (XXX) XXX-XXXX.
  const formatPhoneDisplay = (value: string): string => {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
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
      if (!recaptchaRef.current) {
        throw new Error('reCAPTCHA container missing.');
      }
      setupRecaptcha(recaptchaRef.current.id);
      await sendSmsCode(digits);
      setStep('code');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send code';
      if (msg.includes('too-many-requests')) {
        setError('Too many attempts. Wait a few minutes.');
      } else if (msg.includes('invalid-phone')) {
        setError('Invalid phone number.');
      } else if (msg.includes('quota')) {
        setError('SMS quota exceeded for today. Try tomorrow.');
      } else {
        setError(msg);
      }
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
      const admin = await isAdmin(user.uid);
      if (!admin) {
        setError('This account is not authorized as admin.');
        setLoading(false);
        return;
      }
      router.replace('/admin');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      if (msg.includes('invalid-verification-code') || msg.includes('code-expired')) {
        setError('Wrong or expired code.');
      } else {
        setError(msg);
      }
      setLoading(false);
    }
  };

  const handleGoBack = () => {
    setStep('phone');
    setCode('');
    setError('');
  };

  if (checkingAuth) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-neutral-500">
        Loading…
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-black text-white px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-black uppercase tracking-tighter mb-1">
          Rudewear
        </h1>
        <div className="w-12 h-1 bg-red-600 mb-8" />

        <h2 className="text-lg font-bold mb-1 text-neutral-400">Admin sign in</h2>
        <p className="text-xs text-neutral-500 mb-6">
          {step === 'phone'
            ? 'We\'ll text you a code to your phone.'
            : `Enter the 6-digit code sent to ${phone}.`}
        </p>

        {step === 'phone' ? (
          <form onSubmit={handleSendCode} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                Phone number
              </label>
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
                  className="flex-1 px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-md text-white placeholder:text-neutral-600 focus:outline-none focus:border-red-600 transition-colors"
                />
              </div>
            </div>

            {error && <p className="text-sm text-red-500 -mt-1">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold uppercase tracking-wide rounded-md transition-colors disabled:opacity-50 mt-2"
            >
              {loading ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                Verification code
              </label>
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
                className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-md text-white text-center text-2xl font-black tracking-[0.5em] placeholder:text-neutral-600 focus:outline-none focus:border-red-600 transition-colors"
              />
            </div>

            {error && <p className="text-sm text-red-500 -mt-1">{error}</p>}

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold uppercase tracking-wide rounded-md transition-colors disabled:opacity-50 mt-2"
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>

            <button
              type="button"
              onClick={handleGoBack}
              disabled={loading}
              className="text-xs text-neutral-500 hover:text-neutral-300 mt-1"
            >
              ← Change phone number
            </button>
          </form>
        )}

        <p className="mt-8 text-xs text-neutral-600 text-center">
          Only authorized admins can access this panel.
        </p>

        {/* reCAPTCHA invisible — atado por setupRecaptcha().
            Firebase renderiza dentro de este div sin UI visible. */}
        <div id="rudewear-admin-recaptcha" ref={recaptchaRef} />
      </div>
    </main>
  );
}
