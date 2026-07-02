// Rudewear types — source of truth para admin + público.

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
export type Size = typeof SIZES[number];

// Firestore Timestamp toleramos como opcional / any porque a veces
// llega como `Timestamp`, otras como `{ seconds, nanoseconds }` según
// desde dónde se lee.
export type FirestoreTimestampish =
  | { seconds: number; nanoseconds: number }
  | { toDate: () => Date; toMillis: () => number }
  | string
  | Date
  | null
  | undefined;

export interface Product {
  id: string;                            // Firestore doc id
  name: string;
  description: string;
  images: string[];                      // URLs (por ahora manual, upload en fase 3+)
  categoryId: string;                    // ref a Category.id
  sizes: Size[];                         // subset de SIZES disponibles
  stockBySize: Partial<Record<Size, number>>;  // stock por talla
  sellPrice: number;                     // precio al público (USD)
  costPrice: number;                     // 🔒 solo admin — lo que te cuesta
  supplierUrl: string;                   // 🔒 solo admin — link para reordenar
  active: boolean;
  createdAt?: FirestoreTimestampish;
  updatedAt?: FirestoreTimestampish;
}

export interface Category {
  id: string;                            // Firestore doc id
  name: string;                          // "Shirts", "Hoodies"
  slug: string;                          // "shirts" (lowercase, sin espacios)
  order: number;                         // orden de display en el nav
  active: boolean;
  createdAt?: FirestoreTimestampish;
}

// ─── Helpers derivados ───────────────────────────────────────

/** Stock total sumando todas las tallas. */
export function totalStock(p: Product): number {
  return Object.values(p.stockBySize || {}).reduce(
    (sum, n) => sum + (typeof n === 'number' && n > 0 ? n : 0),
    0
  );
}

/** Profit por unidad. */
export function profitPerUnit(p: Product): number {
  return Math.round((p.sellPrice - p.costPrice) * 100) / 100;
}

/** Margin % sobre el sell price. */
export function marginPercent(p: Product): number {
  if (!p.sellPrice) return 0;
  return Math.round((profitPerUnit(p) / p.sellPrice) * 100);
}

/** Bandera visual de stock bajo (subjetivo, ajustable). */
export function isLowStock(p: Product): boolean {
  return totalStock(p) < 5;
}
