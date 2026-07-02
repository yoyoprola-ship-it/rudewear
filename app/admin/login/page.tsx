'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInAdmin, onAuthChange, isAdmin } from '@/app/lib/auth';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Si ya está logueado + es admin, saltar directo al panel.
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const user = await signInAdmin(email, password);
      const admin = await isAdmin(user.uid);
      if (!admin) {
        setError('This account is not authorized as admin.');
        setLoading(false);
        return;
      }
      router.replace('/admin');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign in failed';
      // Firebase Auth devuelve códigos verbosos — los limpiamos.
      if (msg.includes('user-not-found') || msg.includes('wrong-password') || msg.includes('invalid-credential')) {
        setError('Wrong email or password.');
      } else if (msg.includes('too-many-requests')) {
        setError('Too many attempts. Wait a few minutes.');
      } else {
        setError(msg);
      }
      setLoading(false);
    }
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

        <h2 className="text-lg font-bold mb-6 text-neutral-400">Admin sign in</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
              Email
            </label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
              className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-md text-white placeholder:text-neutral-600 focus:outline-none focus:border-red-600 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
              className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-md text-white placeholder:text-neutral-600 focus:outline-none focus:border-red-600 transition-colors"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 -mt-1">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold uppercase tracking-wide rounded-md transition-colors disabled:opacity-50 mt-2"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-8 text-xs text-neutral-600 text-center">
          Only authorized admins can access this panel.
        </p>
      </div>
    </main>
  );
}
