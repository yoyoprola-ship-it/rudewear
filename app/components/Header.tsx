'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/app/lib/firebase';
import type { Category } from '@/app/types';

// Header público — logo + nav de categorías.
// Se muestra en la home y en product detail.

export default function Header() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeCat = searchParams?.get('cat') || 'all';
  const [cats, setCats] = useState<Category[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'rudewear_categories'),
            where('active', '==', true),
            orderBy('order', 'asc')
          )
        );
        setCats(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Category));
      } catch (err) {
        console.error('[header] load cats failed:', err);
      }
    })();
  }, []);

  // Cerrar menu al cambiar de ruta.
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-40 bg-black/95 backdrop-blur border-b border-neutral-900">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
        {/* Logo */}
        <Link href="/" className="text-2xl font-black uppercase tracking-tighter text-white shrink-0">
          Rude<span className="text-red-600">wear</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          <CatLink href="/" active={activeCat === 'all'}>
            All
          </CatLink>
          {cats.map((c) => (
            <CatLink
              key={c.id}
              href={`/?cat=${c.id}`}
              active={activeCat === c.id}
            >
              {c.name}
            </CatLink>
          ))}
        </nav>

        {/* Mobile menu button */}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="md:hidden w-9 h-9 flex flex-col items-center justify-center gap-1.5 border border-neutral-800 rounded"
          aria-label="Menu"
        >
          <span className={`w-4 h-px bg-white transition-transform ${menuOpen ? 'translate-y-1.5 rotate-45' : ''}`} />
          <span className={`w-4 h-px bg-white transition-opacity ${menuOpen ? 'opacity-0' : ''}`} />
          <span className={`w-4 h-px bg-white transition-transform ${menuOpen ? '-translate-y-1.5 -rotate-45' : ''}`} />
        </button>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <nav className="md:hidden border-t border-neutral-900 px-6 py-3 flex flex-col gap-1 bg-black">
          <CatLink href="/" active={activeCat === 'all'}>
            All
          </CatLink>
          {cats.map((c) => (
            <CatLink
              key={c.id}
              href={`/?cat=${c.id}`}
              active={activeCat === c.id}
            >
              {c.name}
            </CatLink>
          ))}
        </nav>
      )}
    </header>
  );
}

function CatLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded text-sm font-bold uppercase tracking-wide transition-colors ${
        active
          ? 'bg-red-600 text-white'
          : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
      }`}
    >
      {children}
    </Link>
  );
}
