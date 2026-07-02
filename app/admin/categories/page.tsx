'use client';
import { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/app/lib/firebase';
import type { Category } from '@/app/types';

// Página de categorías. Reorder simple con up/down (no drag & drop
// para no meter deps extra). Slug se derive automático del nombre.

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
}

export default function CategoriesPage() {
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'rudewear_categories'), orderBy('order', 'asc'));
      const snap = await getDocs(q);
      setCats(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Category));
    } catch (err) {
      console.error('[categories] load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await addDoc(collection(db, 'rudewear_categories'), {
        name,
        slug: slugify(name),
        order: cats.length,  // al final
        active: true,
        createdAt: serverTimestamp(),
      });
      setNewName('');
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create category');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this category? Products currently assigned to it will keep the id but the category will be gone.')) return;
    try {
      await deleteDoc(doc(db, 'rudewear_categories', id));
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleToggleActive = async (c: Category) => {
    try {
      await updateDoc(doc(db, 'rudewear_categories', c.id), {
        active: !c.active,
      });
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Toggle failed');
    }
  };

  const handleSaveEdit = async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    try {
      await updateDoc(doc(db, 'rudewear_categories', id), {
        name,
        slug: slugify(name),
      });
      setEditingId(null);
      setEditName('');
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleMove = async (id: string, direction: 'up' | 'down') => {
    const idx = cats.findIndex((c) => c.id === id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || swapIdx < 0 || swapIdx >= cats.length) return;
    const a = cats[idx];
    const b = cats[swapIdx];
    try {
      await Promise.all([
        updateDoc(doc(db, 'rudewear_categories', a.id), { order: swapIdx }),
        updateDoc(doc(db, 'rudewear_categories', b.id), { order: idx }),
      ]);
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Reorder failed');
    }
  };

  return (
    <div>
      <h1 className="text-3xl font-black uppercase tracking-tighter mb-1">
        Categories
      </h1>
      <p className="text-sm text-neutral-500 mb-8">
        Categories are used to group products in the store.
      </p>

      {/* New category form */}
      <form onSubmit={handleAdd} className="flex gap-2 mb-8 max-w-md">
        <input
          type="text"
          placeholder="Category name (e.g. Hoodies)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={busy}
          className="flex-1 px-4 py-2 bg-neutral-900 border border-neutral-800 rounded text-white placeholder:text-neutral-600 focus:outline-none focus:border-red-600 transition-colors"
        />
        <button
          type="submit"
          disabled={busy || !newName.trim()}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded text-sm font-bold uppercase tracking-wide"
        >
          + Add
        </button>
      </form>

      {/* Categories list */}
      {loading ? (
        <p className="text-neutral-500">Loading…</p>
      ) : cats.length === 0 ? (
        <p className="text-neutral-500 text-sm">
          No categories yet. Create your first one above.
        </p>
      ) : (
        <div className="border border-neutral-800 rounded overflow-hidden">
          {cats.map((c, idx) => (
            <div
              key={c.id}
              className={`flex items-center justify-between gap-4 px-4 py-3 border-b border-neutral-800 last:border-b-0 ${
                c.active ? '' : 'opacity-50'
              }`}
            >
              {editingId === c.id ? (
                <>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit(c.id);
                      if (e.key === 'Escape') { setEditingId(null); setEditName(''); }
                    }}
                    autoFocus
                    className="flex-1 px-3 py-1 bg-neutral-900 border border-red-600 rounded text-white focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveEdit(c.id)}
                      className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs font-bold uppercase"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setEditingId(null); setEditName(''); }}
                      className="px-3 py-1 border border-neutral-700 hover:border-neutral-500 rounded text-xs font-bold uppercase text-neutral-400"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex-1">
                    <p className="font-bold">{c.name}</p>
                    <p className="text-xs text-neutral-500 font-mono">{c.slug}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleMove(c.id, 'up')}
                      disabled={idx === 0}
                      className="w-8 h-8 flex items-center justify-center border border-neutral-700 hover:border-neutral-500 rounded text-neutral-400 disabled:opacity-30"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => handleMove(c.id, 'down')}
                      disabled={idx === cats.length - 1}
                      className="w-8 h-8 flex items-center justify-center border border-neutral-700 hover:border-neutral-500 rounded text-neutral-400 disabled:opacity-30"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => handleToggleActive(c)}
                      className={`px-3 py-1 text-xs font-bold uppercase rounded transition-colors ${
                        c.active
                          ? 'bg-green-950/50 text-green-400 border border-green-900'
                          : 'bg-neutral-900 text-neutral-500 border border-neutral-800'
                      }`}
                    >
                      {c.active ? 'Active' : 'Inactive'}
                    </button>
                    <button
                      onClick={() => { setEditingId(c.id); setEditName(c.name); }}
                      className="px-3 py-1 border border-neutral-700 hover:border-neutral-500 rounded text-xs font-bold uppercase text-neutral-400"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="px-3 py-1 border border-red-900 text-red-500 hover:bg-red-950 rounded text-xs font-bold uppercase"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
