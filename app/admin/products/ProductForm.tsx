'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  deleteProductImage,
  uploadProductImage,
} from '@/app/lib/imageUpload';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/app/lib/firebase';
import {
  SIZES,
  type Category,
  type Product,
  type Size,
  profitPerUnit,
  marginPercent,
} from '@/app/types';

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 40);
}

export interface ProductFormProps {
  initial?: Product;                     // undefined = new; presente = edit
  onSaved?: () => void;
}

interface FormState {
  name: string;
  description: string;
  categoryId: string;
  sizes: Size[];
  stockBySize: Partial<Record<Size, number>>;
  sellPrice: string;                     // strings porque input types="text"
  costPrice: string;                     // + parseamos al submit
  supplierUrl: string;
  images: string[];                      // URLs (por ahora simple lista)
  active: boolean;
}

const empty: FormState = {
  name: '',
  description: '',
  categoryId: '',
  sizes: [],
  stockBySize: {},
  sellPrice: '',
  costPrice: '',
  supplierUrl: '',
  images: [],
  active: true,
};

export default function ProductForm({ initial, onSaved }: ProductFormProps) {
  const router = useRouter();
  const [cats, setCats] = useState<Category[]>([]);
  const [creatingCat, setCreatingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<Array<{
    id: string;
    name: string;
    progress: number;
    error?: string;
  }>>([]);
  const [dragging, setDragging] = useState(false);

  const [f, setF] = useState<FormState>(() => {
    if (!initial) return empty;
    return {
      name: initial.name || '',
      description: initial.description || '',
      categoryId: initial.categoryId || '',
      sizes: initial.sizes || [],
      stockBySize: initial.stockBySize || {},
      sellPrice: String(initial.sellPrice ?? ''),
      costPrice: String(initial.costPrice ?? ''),
      supplierUrl: initial.supplierUrl || '',
      images: initial.images || [],
      active: initial.active !== false,
    };
  });

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'rudewear_categories'), orderBy('order', 'asc'))
        );
        setCats(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Category));
      } catch (err) {
        console.error('[form] load cats failed:', err);
      }
    })();
  }, []);

  const sellNum = parseFloat(f.sellPrice) || 0;
  const costNum = parseFloat(f.costPrice) || 0;
  const profit = Math.round((sellNum - costNum) * 100) / 100;
  const margin = sellNum > 0 ? Math.round((profit / sellNum) * 100) : 0;

  const totalStockPreview = useMemo(
    () =>
      f.sizes.reduce((sum, s) => sum + (Number(f.stockBySize[s]) || 0), 0),
    [f.sizes, f.stockBySize]
  );

  const toggleSize = (s: Size) => {
    setF((prev) => {
      const has = prev.sizes.includes(s);
      const sizes = has ? prev.sizes.filter((x) => x !== s) : [...prev.sizes, s];
      const stockBySize = { ...prev.stockBySize };
      if (has) delete stockBySize[s];
      else stockBySize[s] = 0;
      return { ...prev, sizes, stockBySize };
    });
  };

  const setSizeStock = (s: Size, val: string) => {
    const n = Math.max(0, parseInt(val, 10) || 0);
    setF((prev) => ({
      ...prev,
      stockBySize: { ...prev.stockBySize, [s]: n },
    }));
  };

  const handleFilesSelected = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    for (const file of list) {
      const uploadId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setUploading((prev) => [
        ...prev,
        { id: uploadId, name: file.name, progress: 0 },
      ]);
      try {
        const url = await uploadProductImage(file, (percent) => {
          setUploading((prev) =>
            prev.map((u) => (u.id === uploadId ? { ...u, progress: percent } : u))
          );
        });
        setF((prev) => ({ ...prev, images: [...prev.images, url] }));
        setUploading((prev) => prev.filter((u) => u.id !== uploadId));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setUploading((prev) =>
          prev.map((u) => (u.id === uploadId ? { ...u, error: msg } : u))
        );
      }
    }
  };

  const removeImage = async (idx: number) => {
    const url = f.images[idx];
    setF((prev) => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== idx),
    }));
    // Best-effort cleanup del storage — no bloquea la UI.
    if (url) deleteProductImage(url);
  };

  /** Mueve la imagen idx en direction (-1 izquierda, +1 derecha).
   *  Al llegar a idx=0 la imagen se vuelve la Cover automáticamente. */
  const moveImage = (idx: number, direction: -1 | 1) => {
    setF((prev) => {
      const nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= prev.images.length) return prev;
      const images = [...prev.images];
      [images[idx], images[nextIdx]] = [images[nextIdx], images[idx]];
      return { ...prev, images };
    });
  };

  const dismissUploadError = (id: string) => {
    setUploading((prev) => prev.filter((u) => u.id !== id));
  };

  const handleFilePickerClick = () => {
    fileInputRef.current?.click();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const handleDragLeave = () => setDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) handleFilesSelected(files);
  };

  const handleCreateCategory = async () => {
    const name = newCatName.trim();
    if (!name) return;
    try {
      const ref = await addDoc(collection(db, 'rudewear_categories'), {
        name,
        slug: slugify(name),
        order: cats.length,
        active: true,
        createdAt: serverTimestamp(),
      });
      const created: Category = {
        id: ref.id,
        name,
        slug: slugify(name),
        order: cats.length,
        active: true,
      };
      setCats((prev) => [...prev, created]);
      setF((prev) => ({ ...prev, categoryId: ref.id }));
      setNewCatName('');
      setCreatingCat(false);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create category');
    }
  };

  const validate = (): string | null => {
    if (!f.name.trim()) return 'Name is required.';
    if (!f.categoryId) return 'Pick a category (or create one).';
    if (f.sizes.length === 0) return 'Select at least one size.';
    if (!(sellNum > 0)) return 'Sell price must be > 0.';
    if (costNum < 0) return 'Cost price cannot be negative.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setSaving(true);
    try {
      // Filtramos stock solo para tallas seleccionadas (evita leak).
      const cleanStock: Partial<Record<Size, number>> = {};
      for (const s of f.sizes) {
        cleanStock[s] = Math.max(0, Number(f.stockBySize[s]) || 0);
      }
      const payload = {
        name: f.name.trim(),
        description: f.description.trim(),
        categoryId: f.categoryId,
        sizes: f.sizes,
        stockBySize: cleanStock,
        sellPrice: Math.round(sellNum * 100) / 100,
        costPrice: Math.round(costNum * 100) / 100,
        supplierUrl: f.supplierUrl.trim(),
        images: f.images.filter(Boolean),
        active: f.active,
        updatedAt: serverTimestamp(),
      };

      if (initial) {
        await updateDoc(doc(db, 'rudewear_products', initial.id), payload);
      } else {
        await addDoc(collection(db, 'rudewear_products'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      if (onSaved) onSaved();
      router.push('/admin/products');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter mb-1">
            {initial ? 'Edit product' : 'New product'}
          </h1>
          <p className="text-sm text-neutral-500">
            {initial ? initial.name : 'Fill in the fields to add to the catalog.'}
          </p>
        </div>
      </div>

      {/* ─── BASIC ─── */}
      <Section title="Basics">
        <Field label="Name">
          <input
            type="text"
            value={f.name}
            onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))}
            className={inputCls}
            required
          />
        </Field>

        <Field label="Description" hint="Shown on the product detail card.">
          <textarea
            value={f.description}
            onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))}
            rows={4}
            className={inputCls}
          />
        </Field>

        <Field label="Category">
          {creatingCat ? (
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="New category name"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                className={inputCls}
                autoFocus
              />
              <button
                type="button"
                onClick={handleCreateCategory}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-bold uppercase"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => { setCreatingCat(false); setNewCatName(''); }}
                className="px-4 py-2 border border-neutral-700 hover:border-neutral-500 rounded text-sm font-bold uppercase text-neutral-400"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <select
                value={f.categoryId}
                onChange={(e) => setF((p) => ({ ...p, categoryId: e.target.value }))}
                className={`${inputCls} flex-1`}
                required
              >
                <option value="">— Pick one —</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setCreatingCat(true)}
                className="px-4 py-2 border border-neutral-700 hover:border-neutral-500 rounded text-sm font-bold uppercase text-neutral-300 whitespace-nowrap"
              >
                + New
              </button>
            </div>
          )}
        </Field>
      </Section>

      {/* ─── SIZES + STOCK ─── */}
      <Section title="Sizes & stock">
        <p className="text-xs text-neutral-500 mb-3">
          Pick the sizes this product comes in, then enter stock per size.
        </p>

        {/* Size chips */}
        <div className="flex flex-wrap gap-2 mb-4">
          {SIZES.map((s) => {
            const selected = f.sizes.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleSize(s)}
                className={`px-4 py-2 rounded font-bold uppercase text-sm border transition-colors ${
                  selected
                    ? 'bg-red-600 border-red-600 text-white'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-500 hover:border-neutral-600'
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>

        {/* Stock inputs — solo tallas seleccionadas */}
        {f.sizes.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mb-2">
            {f.sizes
              .slice()
              .sort((a, b) => SIZES.indexOf(a) - SIZES.indexOf(b))
              .map((s) => (
                <div key={s}>
                  <label className="block text-xs font-bold uppercase text-neutral-500 mb-1">
                    {s}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="0"
                    value={f.stockBySize[s] ?? ''}
                    onChange={(e) => setSizeStock(s, e.target.value)}
                    className={inputCls}
                  />
                </div>
              ))}
          </div>
        )}

        {f.sizes.length > 0 && (
          <p className="text-xs text-neutral-500 mt-2">
            Total in stock: <strong className="text-neutral-300">{totalStockPreview}</strong>
          </p>
        )}
      </Section>

      {/* ─── PRICING ─── */}
      <Section title="Pricing">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Cost price (what you pay)" hint="🔒 Admin only.">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={f.costPrice}
                onChange={(e) => setF((p) => ({ ...p, costPrice: e.target.value }))}
                className={`${inputCls} pl-7`}
              />
            </div>
          </Field>

          <Field label="Sell price (public)">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={f.sellPrice}
                onChange={(e) => setF((p) => ({ ...p, sellPrice: e.target.value }))}
                className={`${inputCls} pl-7`}
                required
              />
            </div>
          </Field>
        </div>

        {/* Profit preview */}
        <div className="mt-4 p-3 border border-neutral-800 rounded bg-neutral-900/50 flex justify-between items-baseline">
          <div>
            <p className="text-xs uppercase text-neutral-500 font-bold tracking-wider">
              Profit per unit
            </p>
            <p
              className={`text-2xl font-black ${
                profit > 0 ? 'text-green-400' : profit < 0 ? 'text-red-500' : 'text-neutral-500'
              }`}
            >
              ${profit.toFixed(2)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase text-neutral-500 font-bold tracking-wider">
              Margin
            </p>
            <p
              className={`text-2xl font-black ${
                margin > 0 ? 'text-green-400' : 'text-neutral-500'
              }`}
            >
              {margin}%
            </p>
          </div>
        </div>
      </Section>

      {/* ─── IMAGES ─── */}
      <Section title="Images" hint="Upload from your device. First image is the cover.">
        {/* Hidden file input triggered by button/drop zone. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFilesSelected(e.target.files);
            // reset para que el mismo file pueda re-seleccionarse.
            e.target.value = '';
          }}
        />

        {/* Drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleFilePickerClick}
          className={`cursor-pointer border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragging
              ? 'border-red-600 bg-red-950/20'
              : 'border-neutral-800 hover:border-neutral-600 bg-neutral-900/50'
          }`}
        >
          <div className="text-3xl mb-2">📸</div>
          <p className="text-sm text-neutral-300 font-bold mb-1">
            Click to select or drag images here
          </p>
          <p className="text-xs text-neutral-500">
            JPG · PNG · WebP · HEIC — up to 10 MB each
          </p>
        </div>

        {/* Progress indicators — uploads en curso */}
        {uploading.length > 0 && (
          <div className="mt-3 space-y-2">
            {uploading.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-3 px-3 py-2 bg-neutral-900 border border-neutral-800 rounded text-sm"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-neutral-300 truncate">{u.name}</p>
                  {u.error ? (
                    <p className="text-xs text-red-500">{u.error}</p>
                  ) : (
                    <div className="mt-1 w-full h-1 bg-neutral-800 rounded overflow-hidden">
                      <div
                        className="h-full bg-red-600 transition-all"
                        style={{ width: `${u.progress}%` }}
                      />
                    </div>
                  )}
                </div>
                <span className="text-xs text-neutral-500 flex-shrink-0">
                  {u.error ? 'Failed' : `${u.progress}%`}
                </span>
                {u.error && (
                  <button
                    type="button"
                    onClick={() => dismissUploadError(u.id)}
                    className="text-neutral-500 hover:text-white"
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Grid de imágenes subidas.
            - object-contain: el thumbnail muestra la imagen completa
              sin cropear (matchea el comportamiento de la tienda).
            - Cover badge en la 1ª: es la que aparece en el grid.
            - Arrows ← → para reordenar. Poner una imagen en pos 0
              la vuelve la Cover automáticamente.  */}
        {f.images.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-neutral-500 mb-2">
              Use ← → to reorder. The first image is the cover shown in the store.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {f.images.map((url, idx) => (
                <div
                  key={idx}
                  className="relative aspect-square rounded border border-neutral-800 overflow-hidden bg-black"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    className="w-full h-full object-contain"
                  />
                  {idx === 0 && (
                    <span className="absolute top-1 left-1 bg-red-600 text-white text-[10px] font-bold uppercase px-1.5 py-0.5 rounded z-10">
                      Cover
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeImage(idx)}
                    className="absolute top-1 right-1 bg-black/70 hover:bg-red-600 text-white w-6 h-6 rounded flex items-center justify-center text-xs z-10"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                  {/* Reorder controls al pie */}
                  <div className="absolute bottom-1 left-1 right-1 flex justify-between gap-1 z-10">
                    <button
                      type="button"
                      onClick={() => moveImage(idx, -1)}
                      disabled={idx === 0}
                      className="w-7 h-7 bg-black/70 hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded flex items-center justify-center text-sm font-bold transition-colors"
                      aria-label="Move earlier"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => moveImage(idx, 1)}
                      disabled={idx === f.images.length - 1}
                      className="w-7 h-7 bg-black/70 hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded flex items-center justify-center text-sm font-bold transition-colors"
                      aria-label="Move later"
                    >
                      →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* ─── SUPPLIER (admin only) ─── */}
      <Section title="Supplier" hint="🔒 Admin only — where you re-order this product.">
        <Field label="Supplier URL">
          <input
            type="url"
            placeholder="https://…"
            value={f.supplierUrl}
            onChange={(e) => setF((p) => ({ ...p, supplierUrl: e.target.value }))}
            className={inputCls}
          />
        </Field>
      </Section>

      {/* ─── STATUS ─── */}
      <Section title="Visibility">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={f.active}
            onChange={(e) => setF((p) => ({ ...p, active: e.target.checked }))}
            className="w-5 h-5 accent-red-600"
          />
          <div>
            <p className="font-bold">Active</p>
            <p className="text-xs text-neutral-500">
              Uncheck to hide from the public store while keeping the record.
            </p>
          </div>
        </label>
      </Section>

      {/* Error + submit */}
      {error && (
        <p className="text-sm text-red-500 mb-4">{error}</p>
      )}
      <div className="flex gap-3 pb-8">
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded font-bold uppercase tracking-wide"
        >
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Create product'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/admin/products')}
          disabled={saving}
          className="px-6 py-3 border border-neutral-700 hover:border-neutral-500 rounded font-bold uppercase tracking-wide text-neutral-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Bits UI ─────────────────────────────────────────────────

const inputCls =
  'w-full px-4 py-2 bg-neutral-900 border border-neutral-800 rounded text-white placeholder:text-neutral-600 focus:outline-none focus:border-red-600 transition-colors';

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 border-b border-neutral-800 pb-8 last:border-b-0">
      <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-1">
        {title}
      </h2>
      {hint && <p className="text-xs text-neutral-500 mb-4">{hint}</p>}
      {!hint && <div className="mb-4" />}
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-neutral-600 mt-1">{hint}</p>}
    </div>
  );
}
