'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import {
  confirmSmsCode,
  isAdmin,
  onAuthChange,
  sendSmsCode,
  setupRecaptcha,
} from '@/app/lib/auth';
import { auth, db } from '@/app/lib/firebase';

const ADMIN_2FA_WINDOW_MS = 30 * 60 * 1000;

// Login del admin — TRES factores:
//   1. phone      → pedir número
//   2. code       → verificar SMS (Firebase Phone Auth)
//   3. email2fa   → verificar código enviado al email del admin doc
//
// El 3er factor previene que alguien que roba el phone SIM-swap entre
// al panel: además del SMS necesita acceso al mail box del admin.
// El código dura 10 min y el admin puede quedar "trusted" por 30 min
// desde el pass — pasado eso, re-verify.

type Step = 'phone' | 'code' | 'email2fa';

export default function AdminLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [resendCooldown, setResendCooldown] = useState(0);
  const recaptchaRef = useRef<HTMLDivElement>(null);

  // Si ya está logueado:
  //   - admin + 2FA fresco → dashboard
  //   - admin + 2FA stale/missing → saltar a email2fa (re-verify sin
  //     pedir el phone otra vez, para evitar loops con el layout)
  //   - no admin → dejar el login normal
  useEffect(() => {
    const unsub = onAuthChange(async (user) => {
      if (!user) {
        setCheckingAuth(false);
        return;
      }
      const admin = await isAdmin(user.uid);
      if (!admin) {
        setCheckingAuth(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const data = snap.data() as
          | { admin2faPassedAt?: { toMillis: () => number } }
          | undefined;
        const passedAt = data?.admin2faPassedAt;
        const passedMs =
          passedAt && typeof passedAt.toMillis === 'function'
            ? passedAt.toMillis()
            : 0;
        if (passedMs && Date.now() - passedMs < ADMIN_2FA_WINDOW_MS) {
          router.replace('/admin');
          return;
        }
        // Stale/missing → re-verify por email sin pedir phone again.
        setCheckingAuth(false);
        await requestEmailCode();
      } catch (err) {
        console.error('[login] init check failed:', err);
        setCheckingAuth(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Cooldown ticker para el resend en email2fa.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const formatPhoneDisplay = (v: string): string => {
    const d = v.replace(/\D/g, '').slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  };

  const handleSendSms = async (e: React.FormEvent) => {
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
      // Pre-flight: chequear que el phone SEA de un admin antes de
      // que Firebase mande el SMS (que cuesta plata). Si no, cortamos
      // acá con un error claro y sin gastar SMS.
      const preRes = await fetch('/api/admin/check-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: digits }),
      });
      const preData = await preRes.json().catch(() => ({}));
      if (!preRes.ok) {
        if (preRes.status === 429) {
          setError('Too many attempts from your network. Wait a minute.');
        } else {
          setError(preData.error || 'Could not verify phone. Try again.');
        }
        setLoading(false);
        return;
      }
      if (!preData.canLogin) {
        setError('This phone is not registered as admin.');
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

  const handleVerifySms = async (e: React.FormEvent) => {
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
        // Cerramos la sesión Firebase que confirmSmsCode dejó abierta
        // — no queremos un no-admin con sesión activa mirando por acá.
        try {
          const { signOut } = await import('@/app/lib/auth');
          await signOut();
        } catch {}
        setLoading(false);
        return;
      }
      // SMS OK + admin → disparar 2FA por email.
      await requestEmailCode();
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

  // Llamada al server que envía el código de 2FA al email del admin.
  // Reusable para el "Resend" en el step email2fa.
  const requestEmailCode = async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Session expired. Sign in again.');
      const res = await fetch('/api/admin/2fa-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) {
          setError(data.error || 'Slow down. Wait a moment before requesting again.');
        } else {
          setError(data.error || `Failed to send email code (status ${res.status})`);
        }
        // Si venís del SMS verify sin poder entrar → no dejar la sesión
        // colgada; deslogueá.
        if (step !== 'email2fa') {
          try {
            const { signOut } = await import('@/app/lib/auth');
            await signOut();
          } catch {}
        }
        return;
      }
      if (data.maskedEmail) setMaskedEmail(data.maskedEmail);
      setStep('email2fa');
      setResendCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyEmailCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (emailCode.length !== 6) {
      setError('Code must be 6 digits.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Session expired. Sign in again.');
      const res = await fetch('/api/admin/2fa-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ code: emailCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Verification failed (status ${res.status})`);
        setLoading(false);
        return;
      }
      // 2FA pasado — el layout va a ver el flag fresco en el próximo mount.
      router.replace('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
      setLoading(false);
    }
  };

  const handleGoBackFromSms = () => {
    setStep('phone');
    setCode('');
    setError('');
  };

  const handleCancelEmail2fa = async () => {
    // Si el admin cancela el 2FA, deslogueamos completo — no queremos
    // dejar sesión activa sin el 2do factor.
    try {
      const { signOut } = await import('@/app/lib/auth');
      await signOut();
    } catch {}
    setStep('phone');
    setEmailCode('');
    setError('');
    setMaskedEmail('');
  };

  if (checkingAuth) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-neutral-500">
        Loading…
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-black text-white px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-black uppercase tracking-tighter mb-1">
          Rudewear
        </h1>
        <div className="w-12 h-1 bg-red-600 mb-8" />

        <h2 className="text-lg font-bold mb-1 text-neutral-400">Admin sign in</h2>

        {/* Progress dots */}
        <div className="flex gap-1.5 mb-5">
          {[0, 1, 2].map((i) => {
            const stepIdx = step === 'phone' ? 0 : step === 'code' ? 1 : 2;
            return (
              <div
                key={i}
                className={`h-1 flex-1 rounded ${
                  i <= stepIdx ? 'bg-red-600' : 'bg-neutral-800'
                }`}
              />
            );
          })}
        </div>

        <p className="text-xs text-neutral-500 mb-6">
          {step === 'phone' && "Step 1 of 3 — We'll text you a code."}
          {step === 'code' &&
            `Step 2 of 3 — Enter the 6-digit code sent to ${phone}.`}
          {step === 'email2fa' &&
            `Step 3 of 3 — Extra check. Code sent to ${maskedEmail || 'your email'}.`}
        </p>

        {step === 'phone' && (
          <form onSubmit={handleSendSms} className="flex flex-col gap-4">
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
                  className={inputCls}
                />
              </div>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button type="submit" disabled={loading} className={btnCls}>
              {loading ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleVerifySms} className="flex flex-col gap-4">
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
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                disabled={loading}
                required
                autoFocus
                className={`${inputCls} text-center text-2xl font-black tracking-[0.5em]`}
              />
            </div>
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
              onClick={handleGoBackFromSms}
              disabled={loading}
              className="text-xs text-neutral-500 hover:text-neutral-300"
            >
              ← Change phone number
            </button>
          </form>
        )}

        {step === 'email2fa' && (
          <form onSubmit={handleVerifyEmailCode} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                Email code
              </label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                placeholder="123456"
                value={emailCode}
                onChange={(e) =>
                  setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                disabled={loading}
                required
                autoFocus
                className={`${inputCls} text-center text-2xl font-black tracking-[0.5em]`}
              />
              <p className="text-xs text-neutral-500 mt-1">
                Check your inbox (and spam). Code expires in 10 min.
              </p>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={loading || emailCode.length !== 6}
              className={btnCls}
            >
              {loading ? 'Verifying…' : 'Enter admin panel'}
            </button>
            <div className="flex justify-between items-center">
              <button
                type="button"
                onClick={handleCancelEmail2fa}
                disabled={loading}
                className="text-xs text-neutral-500 hover:text-neutral-300"
              >
                ← Cancel & sign out
              </button>
              <button
                type="button"
                onClick={() => requestEmailCode()}
                disabled={loading || resendCooldown > 0}
                className="text-xs text-neutral-500 hover:text-neutral-300 disabled:opacity-40"
              >
                {resendCooldown > 0
                  ? `Resend in ${resendCooldown}s`
                  : 'Resend code'}
              </button>
            </div>
          </form>
        )}

        <p className="mt-8 text-xs text-neutral-600 text-center">
          Only authorized admins with a verified email can access this panel.
        </p>

        <div id="rudewear-admin-recaptcha" ref={recaptchaRef} />
      </div>
    </main>
  );
}

const inputCls =
  'w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-md text-white placeholder:text-neutral-600 focus:outline-none focus:border-red-600 transition-colors';

const btnCls =
  'w-full px-4 py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold uppercase tracking-wide rounded-md transition-colors disabled:opacity-50';
