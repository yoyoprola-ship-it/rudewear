'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthChange, isAdmin, signOut } from '@/app/lib/auth';
import { db } from '@/app/lib/firebase';
import type { User } from 'firebase/auth';

// Layout que protege /admin/**. Verifica tres cosas:
//   1. Sesión Firebase activa
//   2. users/{uid}.role === 'admin'
//   3. users/{uid}.admin2faPassedAt existe y es < 30 min
// Si falla algo → /admin/login (respetando el step correcto).

const ADMIN_2FA_WINDOW_MS = 30 * 60 * 1000;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  // Login page tiene su propio flow → no aplicamos el guard.
  const isLoginPage = pathname === '/admin/login';

  useEffect(() => {
    if (isLoginPage) {
      setReady(true);
      return;
    }
    const unsub = onAuthChange(async (u) => {
      if (!u) {
        router.replace('/admin/login');
        return;
      }
      const admin = await isAdmin(u.uid);
      if (!admin) {
        await signOut();
        router.replace('/admin/login');
        return;
      }
      // 2FA freshness gate. Leemos admin2faPassedAt del user doc.
      // Si falta o es viejo, mandamos al login para re-verify (sin
      // deslogueuar — el login page dispara el email code y termina
      // volviendo acá cuando el flag esté fresco).
      try {
        const snap = await getDoc(doc(db, 'users', u.uid));
        const data = snap.data() as { admin2faPassedAt?: { toMillis: () => number } } | undefined;
        const passedAt = data?.admin2faPassedAt;
        const passedMs =
          passedAt && typeof passedAt.toMillis === 'function'
            ? passedAt.toMillis()
            : 0;
        if (!passedMs || Date.now() - passedMs > ADMIN_2FA_WINDOW_MS) {
          router.replace('/admin/login');
          return;
        }
      } catch (err) {
        console.error('[admin-layout] 2fa check failed:', err);
        router.replace('/admin/login');
        return;
      }
      setUser(u);
      setReady(true);
    });
    return () => unsub();
  }, [router, isLoginPage]);

  const handleSignOut = async () => {
    await signOut();
    router.replace('/admin/login');
  };

  if (isLoginPage) return <>{children}</>;

  if (!ready) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-neutral-500">
        Verifying access…
      </main>
    );
  }

  const navItems = [
    { href: '/admin', label: 'Dashboard' },
    { href: '/admin/products', label: 'Products' },
    { href: '/admin/categories', label: 'Categories' },
    { href: '/admin/deliveries', label: 'Deliveries' },
    { href: '/admin/messages', label: 'Messages' },
  ];

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col">
      {/* Top nav */}
      <header className="bg-black border-b border-neutral-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/admin" className="text-xl font-black uppercase tracking-tighter">
            Rudewear<span className="text-red-600">.</span>
            <span className="text-neutral-500 text-xs font-medium tracking-normal ml-2 uppercase">
              admin
            </span>
          </Link>
          <nav className="flex gap-1">
            {navItems.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== '/admin' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded text-sm font-bold uppercase tracking-wide transition-colors ${
                    active
                      ? 'bg-red-600 text-white'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-500 hidden sm:inline">
            {user?.email}
          </span>
          <button
            onClick={handleSignOut}
            className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-neutral-400 hover:text-white border border-neutral-800 hover:border-neutral-700 rounded transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex-1 p-6 max-w-6xl w-full mx-auto">{children}</div>
    </div>
  );
}
