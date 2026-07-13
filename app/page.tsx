'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './lib/firebase';
import Header from './components/Header';
import ProductCard from './components/ProductCard';
import DeliveryModal from './components/DeliveryModal';
import type { Category, Product } from './types';

export default function Home() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const activeCat = searchParams?.get('cat') || 'all';
  const [products, setProducts] = useState<Product[]>([]);
  const [categoryNames, setCategoryNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [deliveryOpen, setDeliveryOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Cargamos productos + categorías en paralelo. El Map de
        // categorías se pasa a cada ProductCard para mostrar el nombre
        // sin un fetch por card.
        const [prodSnap, catSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, 'rudewear_products'),
              where('active', '==', true)
            )
          ),
          getDocs(collection(db, 'rudewear_categories')),
        ]);
        // Fisher-Yates shuffle — orden aleatorio cada refresh para que
        // ningún producto quede "enterrado" al final. La filter por
        // categoría preserva este orden (filter no re-ordena).
        const shuffled = prodSnap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as Product
        );
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        setProducts(shuffled);
        const catMap = new Map<string, string>();
        catSnap.docs.forEach((d) => {
          const data = d.data() as Category;
          if (typeof data.name === 'string') catMap.set(d.id, data.name);
        });
        setCategoryNames(catMap);
      } catch (err) {
        console.error('[home] load products failed:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (activeCat === 'all') return products;
    return products.filter((p) => p.categoryId === activeCat);
  }, [products, activeCat]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <Header />

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        {loading ? (
          <p className="text-neutral-500 text-center py-20">Loading…</p>
        ) : products.length === 0 ? (
          <ComingSoon />
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-neutral-400">
              No products in this category yet.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {filtered.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  categoryName={categoryNames.get(p.categoryId)}
                />
              ))}
            </div>

            {/* CTA — Request delivery */}
            <div className="mt-16 border border-red-800/40 bg-red-950/20 rounded p-6 sm:p-8 text-center">
              <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tight mb-2">
                We bring the store to you
              </h2>
              <p className="text-neutral-400 max-w-md mx-auto mb-6 text-sm">
                Book a home visit and we&apos;ll roll up with a selection you can try on. Pay for products in person at your door.
              </p>
              <button
                onClick={() => setDeliveryOpen(true)}
                className="px-8 py-3 bg-red-600 hover:bg-red-700 rounded font-bold uppercase tracking-wide"
              >
                Request delivery service
              </button>
              <p className="mt-4 text-xs text-neutral-500">
                Already booked?{' '}
                <a
                  href="/my-deliveries"
                  className="underline decoration-neutral-700 hover:text-neutral-300 hover:decoration-neutral-500"
                >
                  Manage or cancel your reservation
                </a>
              </p>
            </div>
          </>
        )}
      </main>

      <DeliveryModal open={deliveryOpen} onClose={() => setDeliveryOpen(false)} />

      <footer className="border-t border-neutral-900 py-6 text-center">
        <p className="text-xs text-neutral-600">
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
      </footer>
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-black text-neutral-500">
      Loading…
    </main>
  );
}

// ─── Coming Soon fallback ────────────────────────────────────
// Se muestra cuando el catálogo aún está vacío. Captura emails.

function ComingSoon() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;
    const trimmed = email.trim().toLowerCase();
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
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      });
      setStatus('ok');
      setEmail('');
    } catch (err) {
      console.error('[rudewear] signup failed:', err);
      setStatus('err');
      setErrorMsg('Something went wrong. Try again.');
    }
  };

  return (
    <div className="w-full max-w-md mx-auto text-center py-20">
      <h1 className="text-5xl sm:text-7xl font-black tracking-tighter mb-3 uppercase">
        Rudewear
      </h1>
      <div className="w-16 h-1 bg-red-600 mx-auto mb-6" />
      <p className="text-lg sm:text-xl font-medium text-neutral-300 mb-1">
        Strong style. No apologies.
      </p>
      <p className="text-sm text-neutral-500 mb-10">
        Menswear for men who own the room. Dropping soon.
      </p>

      {status === 'ok' ? (
        <div className="w-full border border-red-600/40 bg-red-600/10 rounded py-4 px-5">
          <p className="font-bold text-white mb-1">You&apos;re on the list.</p>
          <p className="text-sm text-neutral-400">
            We&apos;ll email you when the first drop hits.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
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
            className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded text-white placeholder:text-neutral-600 focus:outline-none focus:border-red-600 transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={status === 'sending'}
            className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold uppercase tracking-wide rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'sending' ? 'Sending…' : 'Notify me'}
          </button>
          {status === 'err' && (
            <p className="text-sm text-red-500 mt-1">{errorMsg}</p>
          )}
        </form>
      )}
    </div>
  );
}
