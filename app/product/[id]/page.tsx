'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/app/lib/firebase';
import Header from '@/app/components/Header';
import ProductCard from '@/app/components/ProductCard';
import DeliveryModal from '@/app/components/DeliveryModal';
import { SIZES, type Category, type Product, totalStock } from '@/app/types';

// Detail card cuando el cliente hace click en un producto del grid.
// Muestra galería de imágenes, descripción, chips de tallas con
// disponibilidad, "how to buy" info (sin carrito — el user pidió
// que la compra va por otro sistema a domicilio).

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [related, setRelated] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [deliveryOpen, setDeliveryOpen] = useState(false);

  useEffect(() => {
    if (!params?.id) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'rudewear_products', params.id));
        if (!snap.exists() || snap.data()?.active === false) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const p = { id: snap.id, ...snap.data() } as Product;
        setProduct(p);

        // Fetch category + related in paralelo
        const [catSnap, relSnap] = await Promise.all([
          p.categoryId ? getDoc(doc(db, 'rudewear_categories', p.categoryId)) : Promise.resolve(null),
          getDocs(
            query(
              collection(db, 'rudewear_products'),
              where('active', '==', true),
              where('categoryId', '==', p.categoryId)
            )
          ),
        ]);
        if (catSnap?.exists()) {
          setCategory({ id: catSnap.id, ...catSnap.data() } as Category);
        }
        setRelated(
          relSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Product)
            .filter((r) => r.id !== p.id)
            .slice(0, 4)
        );
      } catch (err) {
        console.error('[product detail] load failed:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [params?.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-neutral-500 flex items-center justify-center">
        Loading…
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col">
        <Header />
        <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <p className="text-5xl mb-4">404</p>
          <p className="text-neutral-400 mb-6">Product not found or no longer available.</p>
          <Link
            href="/"
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded font-bold uppercase text-sm tracking-wide"
          >
            Back to store
          </Link>
        </main>
      </div>
    );
  }

  const images = product.images && product.images.length > 0 ? product.images : [];
  const cover = images[activeImage] || images[0];
  const stock = totalStock(product);
  const soldOut = stock === 0;

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <Header />

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <nav className="text-xs text-neutral-500 mb-6 flex gap-2 items-center">
          <Link href="/" className="hover:text-white">
            Store
          </Link>
          <span>/</span>
          {category && (
            <>
              <Link href={`/?cat=${category.id}`} className="hover:text-white">
                {category.name}
              </Link>
              <span>/</span>
            </>
          )}
          <span className="text-neutral-300">{product.name}</span>
        </nav>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
          {/* Image gallery — object-contain para NUNCA cropear.
              Ratio del contenedor 4:5 matchea 2000x2500. */}
          <div>
            <div className="aspect-[4/5] bg-neutral-900 rounded overflow-hidden border border-neutral-800 mb-3">
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cover}
                  alt={product.name}
                  className={`w-full h-full object-contain ${
                    soldOut ? 'grayscale opacity-70' : ''
                  }`}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-neutral-700 uppercase text-sm font-bold">
                  No image
                </div>
              )}
            </div>
            {images.length > 1 && (
              <div className="grid grid-cols-5 gap-2">
                {images.map((url, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveImage(idx)}
                    className={`aspect-square rounded overflow-hidden border-2 transition-colors bg-neutral-900 ${
                      activeImage === idx
                        ? 'border-red-600'
                        : 'border-neutral-800 hover:border-neutral-600'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="w-full h-full object-contain" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div>
            {category && (
              <p className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-2">
                {category.name}
              </p>
            )}
            <h1 className="text-3xl sm:text-4xl font-black tracking-tighter uppercase mb-3">
              {product.name}
            </h1>

            <p className="text-3xl font-black text-white mb-6">
              ${product.sellPrice.toFixed(2)}
            </p>

            {soldOut && (
              <div className="mb-6 border border-red-600/40 bg-red-600/10 rounded px-3 py-2">
                <p className="text-red-400 font-bold uppercase text-sm tracking-wider">
                  Sold out
                </p>
              </div>
            )}

            {/* Sizes */}
            <div className="mb-6">
              <p className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-2">
                Size
              </p>
              <div className="flex flex-wrap gap-2">
                {SIZES.filter((s) => product.sizes?.includes(s)).map((s) => {
                  const stockOfSize = product.stockBySize?.[s] ?? 0;
                  const out = stockOfSize <= 0;
                  const isSelected = selectedSize === s;
                  return (
                    <button
                      key={s}
                      onClick={() => !out && setSelectedSize(s)}
                      disabled={out}
                      className={`min-w-[3.5rem] px-3 py-2 rounded font-bold uppercase text-sm border transition-colors ${
                        out
                          ? 'border-neutral-800 text-neutral-700 line-through cursor-not-allowed'
                          : isSelected
                          ? 'border-red-600 bg-red-600 text-white'
                          : 'border-neutral-700 text-white hover:border-white'
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
              {selectedSize && (
                <p className="text-xs text-neutral-500 mt-2">
                  Size {selectedSize} — {product.stockBySize?.[selectedSize as keyof typeof product.stockBySize] ?? 0} available
                </p>
              )}
            </div>

            {/* Description */}
            {product.description && (
              <div className="mb-8">
                <p className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-2">
                  Details
                </p>
                <p className="text-neutral-300 whitespace-pre-line leading-relaxed">
                  {product.description}
                </p>
              </div>
            )}

            {/* How to buy */}
            <div className="border-t border-neutral-800 pt-6">
              <p className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-2">
                How to buy
              </p>
              <p className="text-neutral-300 leading-relaxed mb-4">
                Book a home visit — we bring a selection you can try on. Pay for products in person at your door.
              </p>
              <button
                onClick={() => setDeliveryOpen(true)}
                className="w-full px-6 py-3 bg-red-600 hover:bg-red-700 rounded font-bold uppercase tracking-wide"
              >
                Request delivery service
              </button>
            </div>
          </div>
        </div>

        {/* Related products */}
        {related.length > 0 && (
          <section className="border-t border-neutral-900 pt-10">
            <h2 className="text-xl font-black uppercase tracking-tight mb-6">
              More in {category?.name || 'this category'}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {related.map((r) => (
                <ProductCard key={r.id} product={r} />
              ))}
            </div>
          </section>
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
