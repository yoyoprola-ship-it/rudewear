'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/app/lib/firebase';
import type { Product } from '@/app/types';
import ProductForm from '../ProductForm';

export default function EditProductPage() {
  const params = useParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!params?.id) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'rudewear_products', params.id));
        if (!snap.exists()) {
          setNotFound(true);
          return;
        }
        setProduct({ id: snap.id, ...snap.data() } as Product);
      } catch (err) {
        console.error('[edit product] load failed:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [params?.id]);

  if (loading) return <p className="text-neutral-500">Loading…</p>;
  if (notFound) return <p className="text-red-500">Product not found.</p>;
  if (!product) return null;

  return <ProductForm initial={product} />;
}
