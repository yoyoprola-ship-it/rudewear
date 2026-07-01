'use client';
import { useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './lib/firebase';

// Coming Soon con email capture.
// Guarda en Firestore collection `rudewear_signups` (prefijada para
// no chocar con nada del proyecto Lafayette Market que comparte
// infraestructura).

export default function Home() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;
    const trimmed = email.trim().toLowerCase();
    // Validación minimalista — email debe tener @ y algo antes/después.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setStatus('err');
      setErrorMsg('Enter a valid email.');
      return;
    }
    setStatus('sending');
    setErrorMsg('');
    try {
      await addDoc(collection(db, 'rudewear_signups'), {
        email: trimmed,
        createdAt: serverTimestamp(),
        source: 'coming-soon',
        userAgent:
          typeof navigator !== 'undefined' ? navigator.userAgent : '',
      });
      setStatus('ok');
      setEmail('');
    } catch (err: unknown) {
      console.error('[rudewear] signup failed:', err);
      setStatus('err');
      setErrorMsg('Something went wrong. Try again.');
    }
  };

  return (
    <main className="flex flex-1 min-h-screen items-center justify-center px-6 bg-black text-white">
      <div className="w-full max-w-md flex flex-col items-center text-center">
        {/* Wordmark */}
        <h1 className="text-5xl sm:text-7xl font-black tracking-tighter mb-3 uppercase">
          Rudewear
        </h1>

        {/* Accent bar */}
        <div className="w-16 h-1 bg-red-600 mb-6" />

        {/* Tagline */}
        <p className="text-lg sm:text-xl font-medium text-neutral-300 mb-1">
          Strong style. No apologies.
        </p>
        <p className="text-sm text-neutral-500 mb-10">
          Menswear for men who own the room. Dropping soon.
        </p>

        {/* Email capture */}
        {status === 'ok' ? (
          <div className="w-full border border-red-600/40 bg-red-600/10 rounded-md py-4 px-5 text-center">
            <p className="font-bold text-white mb-1">You&apos;re on the list.</p>
            <p className="text-sm text-neutral-400">
              We&apos;ll email you when the first drop hits.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (status === 'err') setStatus('idle');
              }}
              disabled={status === 'sending'}
              className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-md text-white placeholder:text-neutral-600 focus:outline-none focus:border-red-600 transition-colors disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold uppercase tracking-wide rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === 'sending' ? 'Sending…' : 'Notify me'}
            </button>
            {status === 'err' && (
              <p className="text-sm text-red-500 mt-1">{errorMsg}</p>
            )}
          </form>
        )}

        {/* Footer */}
        <p className="mt-16 text-xs text-neutral-600">
          A brand from{' '}
          <a
            href="https://lafayettelamarket.com"
            className="underline hover:text-neutral-400 transition-colors"
          >
            Lafayette Market
          </a>
          {' · '}
          Lafayette, LA
        </p>
      </div>
    </main>
  );
}
