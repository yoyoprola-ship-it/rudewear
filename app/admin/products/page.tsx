'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, deleteDoc, doc, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/app/lib/firebase';
import {
  type Category,
  type Product,
  totalStock,
  profitPerUnit,
  isLowStock,
} from '@/app/types';

export default function ProductListPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState<string>('all');
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [prodSnap, catSnap] = await Promise.all([
        getDocs(collection(db, 'rudewear_products')),
        getDocs(query(collection(db, 'rudewear_categories'), orderBy('order', 'asc'))),
      ]);
      setProducts(
        prodSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Product)
      );
      setCategories(
        catSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Category)
      );
    } catch (err) {
      console.error('[products] load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const catById = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return products
      .filter((p) => filterCat === 'all' || p.categoryId === filterCat)
      .filter((p) => !s || p.name.toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, filterCat, search]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'rudewear_products', id));
      setProducts((prev) => prev.filter((p) => p.id !== id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter mb-1">
            Products
          </h1>
          <p className="text-sm text-neutral-500">
            {products.length} total · {products.filter((p) => p.active).length} active
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-bold uppercase tracking-wide"
        >
          + New product
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="search"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-4 py-2 bg-neutral-900 border border-neutral-800 rounded text-white placeholder:text-neutral-600 focus:outline-none focus:border-red-600"
        />
        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className="px-4 py-2 bg-neutral-900 border border-neutral-800 rounded text-white focus:outline-none focus:border-red-600"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-neutral-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="border border-neutral-800 rounded p-8 text-center">
          <p className="text-neutral-400 mb-4">
            {products.length === 0
              ? 'No products yet.'
              : 'No products match your filter.'}
          </p>
          {products.length === 0 && (
            <Link
              href="/admin/products/new"
              className="inline-block px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-bold uppercase tracking-wide"
            >
              + Add your first product
            </Link>
          )}
        </div>
      ) : (
        <div className="border border-neutral-800 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-500 uppercase tracking-wider text-xs">
              <tr>
                <th className="text-left px-4 py-2 font-bold">Product</th>
                <th className="text-left px-4 py-2 font-bold">Category</th>
                <th className="text-right px-4 py-2 font-bold">Stock</th>
                <th className="text-right px-4 py-2 font-bold">Cost</th>
                <th className="text-right px-4 py-2 font-bold">Sell</th>
                <th className="text-right px-4 py-2 font-bold">Profit/u</th>
                <th className="text-center px-4 py-2 font-bold">Status</th>
                <th className="text-right px-4 py-2 font-bold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const cat = catById.get(p.categoryId);
                const stock = totalStock(p);
                const profit = profitPerUnit(p);
                return (
                  <tr
                    key={p.id}
                    className={`border-t border-neutral-800 ${
                      p.active ? '' : 'opacity-50'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {p.images?.[0] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.images[0]}
                            alt=""
                            className="w-10 h-10 object-cover rounded border border-neutral-800"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-700 text-xs">
                            —
                          </div>
                        )}
                        <div>
                          <p className="font-bold">{p.name}</p>
                          <p className="text-xs text-neutral-500">
                            {(p.sizes || []).join(' · ')}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-400">
                      {cat?.name || <span className="text-neutral-600 italic">missing</span>}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-bold ${
                        isLowStock(p) ? 'text-amber-500' : 'text-neutral-300'
                      }`}
                    >
                      {stock}
                    </td>
                    <td className="px-4 py-3 text-right text-neutral-400">
                      ${p.costPrice.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold">
                      ${p.sellPrice.toFixed(2)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-bold ${
                        profit > 0 ? 'text-green-400' : profit < 0 ? 'text-red-500' : 'text-neutral-500'
                      }`}
                    >
                      ${profit.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          p.active
                            ? 'bg-green-950/50 text-green-400 border border-green-900'
                            : 'bg-neutral-900 text-neutral-500 border border-neutral-800'
                        }`}
                      >
                        {p.active ? 'Live' : 'Off'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <Link
                          href={`/admin/products/${p.id}`}
                          className="px-3 py-1 border border-neutral-700 hover:border-neutral-500 rounded text-xs font-bold uppercase text-neutral-300"
                        >
                          Edit
                        </Link>
                        <button
                          onClick={() => handleDelete(p.id, p.name)}
                          className="px-3 py-1 border border-red-900 text-red-500 hover:bg-red-950 rounded text-xs font-bold uppercase"
                        >
                          Del
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
