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

// ─── Delivery service ────────────────────────────────────────
// Rudewear NO vende productos online. El cliente reserva una
// VISITA a domicilio y solo paga por ese servicio (miles + time).
// Los productos se pagan en persona al momento de la visita.
// La tienda móvil abre 9 AM a 7 PM; el cliente elige hora entre
// hoy y mañana en slots horarios de 9-18 (18 = última entrega,
// alcanza para completar antes del cierre a las 19).

export type DeliveryStatus =
  | 'requested'        // creado, hold en Stripe autorizado
  | 'confirmed'        // admin confirmó, va camino
  | 'delivered'        // completó la visita, hold capturado
  | 'cancelled';       // cancelada, hold liberado

export interface Delivery {
  id: string;
  userId: string;                  // uid de Firebase Auth del cliente
  customerName: string;            // alias del user doc
  customerPhone: string;           // 10 dígitos US (verificado por SMS)
  address: string;                 // string completa (Google formatted)
  addressLat: number;
  addressLng: number;
  addressZip?: string;
  distanceMiles: number;           // desde DELIVERY_ORIGIN
  distanceMinutes: number;         // driving time one-way
  notes: string;                   // instrucciones libres del cliente
  // Fecha/hora seleccionada por el cliente. ISO string en LA tz.
  scheduledAt: string;             // e.g., '2026-05-28T15:00:00-05:00'
  scheduledDay: 'today' | 'tomorrow'; // etiqueta legible
  // Money
  deliveryFee: number;             // = miles*1 + (minutes/60)*20 + 3.30
  paymentIntentId: string;
  paymentStatus: 'authorized' | 'captured' | 'canceled' | 'failed';
  status: DeliveryStatus;
  createdAt?: FirestoreTimestampish;
  updatedAt?: FirestoreTimestampish;
  confirmedAt?: FirestoreTimestampish;
  deliveredAt?: FirestoreTimestampish;
  cancelledAt?: FirestoreTimestampish;
}

