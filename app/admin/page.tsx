'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/app/lib/firebase';
import {
  type Product,
  totalStock,
  profitPerUnit,
  isLowStock,
} from '@/app/types';

// Dashboard con KPIs — cuántos productos, total inventario, cuánto
// valdría vender todo el stock, cuánto ganás si vendés todo el stock.

export default function AdminDashboard() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'rudewear_products'));
        const list = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as Product
        );
        setProducts(list);
      } catch (err) {
        console.error('[admin] load products failed:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const activeProducts = products.filter((p) => p.active);
  const inactiveProducts = products.filter((p) => !p.active);
  const lowStock = products.filter((p) => p.active && isLowStock(p));

  const totalInventory = products.reduce((sum, p) => sum + totalStock(p), 0);

  const potentialRevenue = products.reduce(
    (sum, p) => sum + totalStock(p) * p.sellPrice,
    0
  );
  const potentialProfit = products.reduce(
    (sum, p) => sum + totalStock(p) * profitPerUnit(p),
    0
  );

  if (loading) {
    return <p className="text-neutral-500">Loading…</p>;
  }

  return (
    <div>
      <h1 className="text-3xl font-black uppercase tracking-tighter mb-1">
        Dashboard
      </h1>
      <p className="text-sm text-neutral-500 mb-8">
        Snapshot of your catalog and inventory.
      </p>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard
          label="Active products"
          value={activeProducts.length.toString()}
          hint={
            inactiveProducts.length > 0
              ? `+ ${inactiveProducts.length} inactive`
              : undefined
          }
        />
        <StatCard
          label="Total units in stock"
          value={totalInventory.toString()}
          hint={lowStock.length > 0 ? `${lowStock.length} low stock` : undefined}
          warn={lowStock.length > 0}
        />
        <StatCard
          label="Potential revenue"
          value={`$${potentialRevenue.toFixed(2)}`}
          hint="if all stock sells at retail"
        />
        <StatCard
          label="Potential profit"
          value={`$${potentialProfit.toFixed(2)}`}
          hint="revenue minus cost"
          accent
        />
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3 mb-10">
        <Link
          href="/admin/products/new"
          className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-bold uppercase tracking-wide"
        >
          + New product
        </Link>
        <Link
          href="/admin/products"
          className="px-4 py-2 border border-neutral-700 hover:border-neutral-500 rounded text-sm font-bold uppercase tracking-wide"
        >
          Manage products
        </Link>
        <Link
          href="/admin/categories"
          className="px-4 py-2 border border-neutral-700 hover:border-neutral-500 rounded text-sm font-bold uppercase tracking-wide"
        >
          Manage categories
        </Link>
      </div>

      {/* Low stock alert */}
      {lowStock.length > 0 && (
        <div className="border border-amber-800/60 bg-amber-950/30 rounded p-4 mb-6">
          <p className="font-bold text-amber-400 mb-2">
            ⚠️ Low stock — {lowStock.length} product{lowStock.length === 1 ? '' : 's'}
          </p>
          <ul className="text-sm text-neutral-300 space-y-1">
            {lowStock.map((p) => (
              <li key={p.id} className="flex justify-between">
                <Link
                  href={`/admin/products/${p.id}`}
                  className="hover:text-white transition-colors"
                >
                  {p.name}
                </Link>
                <span className="text-neutral-500">
                  {totalStock(p)} left
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {products.length === 0 && (
        <div className="border border-neutral-800 rounded p-8 text-center">
          <p className="text-neutral-400 mb-4">No products yet.</p>
          <Link
            href="/admin/products/new"
            className="inline-block px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-bold uppercase tracking-wide"
          >
            + Add your first product
          </Link>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  warn,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={`p-4 rounded border ${
        accent
          ? 'border-red-800/50 bg-red-950/20'
          : 'border-neutral-800 bg-neutral-900'
      }`}
    >
      <p className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
        {label}
      </p>
      <p
        className={`text-2xl font-black ${
          accent ? 'text-red-400' : 'text-white'
        }`}
      >
        {value}
      </p>
      {hint && (
        <p
          className={`text-xs mt-1 ${
            warn ? 'text-amber-500' : 'text-neutral-500'
          }`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
