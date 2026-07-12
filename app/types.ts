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
  // Analytics — incrementado por /api/track-view cuando un browser
  // visita el detail card por primera vez (dedup via localStorage).
  // Admin-only display: contador de usuarios únicos aproximado.
  viewCount?: number;
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
// La tienda móvil visita el domicilio del cliente. Rudewear NO
// cobra por el traslado — el cliente solo paga las prendas en
// persona cuando el driver llega. La reserva captura: address,
// hora preferida, notas y el phone del cliente para llamar al
// llegar.
// Horario: 9 AM a 7 PM. El cliente elige slot de 2 horas entre
// hoy y mañana.

export type DeliveryStatus =
  | 'requested'        // cliente hizo la reserva
  | 'confirmed'        // admin confirmó, va camino
  | 'delivered'        // completó la visita
  | 'cancelled';

export interface Delivery {
  id: string;
  userId: string;                  // uid de Firebase Auth del cliente
  customerName: string;            // alias del user doc
  customerPhone: string;           // 10 dígitos US (verificado por SMS)
  address: string;                 // string completa (Google formatted)
  notes: string;                   // instrucciones libres del cliente
  // Fecha/hora seleccionada por el cliente. ISO local (LA tz).
  scheduledAt: string;             // e.g., '2026-05-28T15:00:00'
  scheduledDay: 'today' | 'tomorrow';
  status: DeliveryStatus;
  // Delivery fee — recomputado server-side al persistir. Es informativo:
  // el driver cobra en efectivo cuando llega. Free = 0.
  distanceMiles: number;           // driving one-way desde DELIVERY_ORIGIN
  deliveryFee: number;             // 0 si <5mi; miles×$1.50 si ≥5mi
  // Cliente marcó el checkbox aceptando pagar el fee en cash al llegar.
  // Solo se pide/valida si deliveryFee > 0. Guardamos siempre para
  // auditoría (una eventual disputa "yo no acepté esto").
  agreedToPayOnArrival: boolean;
  createdAt?: FirestoreTimestampish;
  updatedAt?: FirestoreTimestampish;
  confirmedAt?: FirestoreTimestampish;
  deliveredAt?: FirestoreTimestampish;
  cancelledAt?: FirestoreTimestampish;
}

