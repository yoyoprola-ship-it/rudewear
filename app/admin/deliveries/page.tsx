'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/app/lib/firebase';
import type { Delivery, DeliveryStatus } from '@/app/types';

// Panel del admin para gestionar las reservas del delivery service.
//
// - Lista todos los `rudewear_deliveries` de Firestore.
// - Filtro por status.
// - Acciones inline: Confirm, Mark delivered, Cancel.
// - Ordena por scheduledAt (upcoming primero).

type FilterKey = 'active' | 'all' | DeliveryStatus;

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'requested', label: 'Requested' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

export default function AdminDeliveriesPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('active');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'rudewear_deliveries'));
      setDeliveries(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Delivery)
      );
    } catch (err) {
      console.error('[deliveries] load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Counts por status para los tabs.
  const counts = useMemo(() => {
    const c = { active: 0, requested: 0, confirmed: 0, delivered: 0, cancelled: 0, all: deliveries.length };
    for (const d of deliveries) {
      c[d.status] = (c[d.status] || 0) + 1;
      if (d.status === 'requested' || d.status === 'confirmed') c.active += 1;
    }
    return c;
  }, [deliveries]);

  const filtered = useMemo(() => {
    let list: Delivery[];
    if (filter === 'all') list = [...deliveries];
    else if (filter === 'active')
      list = deliveries.filter(
        (d) => d.status === 'requested' || d.status === 'confirmed'
      );
    else list = deliveries.filter((d) => d.status === filter);
    // Upcoming primero. scheduledAt es ISO local — comparación
    // lexicográfica funciona.
    list.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    return list;
  }, [deliveries, filter]);

  const patch = async (
    id: string,
    status: DeliveryStatus,
    extraField?: 'confirmedAt' | 'deliveredAt' | 'cancelledAt'
  ) => {
    setBusyId(id);
    try {
      const payload: Record<string, unknown> = {
        status,
        updatedAt: serverTimestamp(),
      };
      if (extraField) payload[extraField] = serverTimestamp();
      await updateDoc(doc(db, 'rudewear_deliveries', id), payload);
      setDeliveries((prev) =>
        prev.map((d) => (d.id === id ? { ...d, status } : d))
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirm = (d: Delivery) => patch(d.id, 'confirmed', 'confirmedAt');
  const handleDelivered = (d: Delivery) => patch(d.id, 'delivered', 'deliveredAt');
  const handleCancel = (d: Delivery) => {
    if (!confirm(`Cancel delivery for ${d.customerName}?`)) return;
    patch(d.id, 'cancelled', 'cancelledAt');
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter mb-1">
            Deliveries
          </h1>
          <p className="text-sm text-neutral-500">
            Home-visit requests from customers. No money is collected here —
            drivers charge on arrival.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/deliveries/map"
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-bold uppercase tracking-wide"
          >
            🗺 Map + broadcast
          </Link>
          <button
            onClick={load}
            disabled={loading}
            className="px-4 py-2 border border-neutral-700 hover:border-neutral-500 rounded text-sm font-bold uppercase tracking-wide disabled:opacity-50"
          >
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1 mb-6">
        {FILTER_TABS.map((t) => {
          const active = filter === t.key;
          const count = counts[t.key];
          return (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide transition-colors ${
                active
                  ? 'bg-red-600 text-white'
                  : 'text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800'
              }`}
            >
              {t.label}
              <span
                className={`ml-1.5 tabular-nums ${
                  active ? 'text-red-200' : 'text-neutral-500'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="text-neutral-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="border border-neutral-800 rounded p-8 text-center">
          <p className="text-neutral-400">
            {deliveries.length === 0
              ? 'No delivery requests yet.'
              : `No deliveries in "${filter}".`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((d) => (
            <DeliveryRow
              key={d.id}
              d={d}
              busy={busyId === d.id}
              onConfirm={() => handleConfirm(d)}
              onDelivered={() => handleDelivered(d)}
              onCancel={() => handleCancel(d)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeliveryRow({
  d,
  busy,
  onConfirm,
  onDelivered,
  onCancel,
}: {
  d: Delivery;
  busy: boolean;
  onConfirm: () => void;
  onDelivered: () => void;
  onCancel: () => void;
}) {
  const scheduled = formatScheduled(d.scheduledAt, d.scheduledDay);
  const phoneDisplay = formatPhone(d.customerPhone);
  const mapsHref = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    d.address
  )}`;

  return (
    <div
      className={`border rounded p-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 transition-opacity ${
        busy ? 'opacity-50' : ''
      } ${
        d.status === 'requested'
          ? 'border-red-900/60 bg-red-950/10'
          : d.status === 'confirmed'
            ? 'border-amber-900/60 bg-amber-950/10'
            : d.status === 'delivered'
              ? 'border-green-900/60 bg-green-950/10'
              : 'border-neutral-800 bg-neutral-900/40'
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <StatusBadge status={d.status} />
          <p className="font-bold text-white">{d.customerName}</p>
          <a
            href={`tel:+1${d.customerPhone}`}
            className="text-sm text-neutral-300 hover:text-white underline decoration-neutral-700 hover:decoration-white"
          >
            {phoneDisplay}
          </a>
        </div>

        <p className="text-sm text-neutral-300 mb-1">
          <span className="text-neutral-500 uppercase tracking-wider text-[10px] font-bold mr-1">
            When
          </span>
          {scheduled}
        </p>
        <p className="text-sm text-neutral-300 mb-1">
          <span className="text-neutral-500 uppercase tracking-wider text-[10px] font-bold mr-1">
            Where
          </span>
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white underline decoration-neutral-700 hover:decoration-white"
            title="Open in Google Maps"
          >
            {d.address}
          </a>
          {typeof d.distanceMiles === 'number' && (
            <span className="text-neutral-500 ml-2 text-xs">
              · {d.distanceMiles} mi
            </span>
          )}
        </p>
        {typeof d.deliveryFee === 'number' && (
          <p className="text-sm mb-1">
            <span className="text-neutral-500 uppercase tracking-wider text-[10px] font-bold mr-1">
              Fee
            </span>
            {d.deliveryFee > 0 ? (
              <span className="text-red-400 font-bold">
                ${d.deliveryFee.toFixed(2)} cash on arrival
                {d.agreedToPayOnArrival ? (
                  <span className="ml-2 text-xs text-green-400 font-normal">
                    ✓ customer agreed
                  </span>
                ) : (
                  <span className="ml-2 text-xs text-amber-400 font-normal">
                    ⚠ not agreed
                  </span>
                )}
              </span>
            ) : (
              <span className="text-green-400">Free (under 5 mi)</span>
            )}
          </p>
        )}
        {d.notes && (
          <p className="text-sm text-neutral-400 mt-2 border-l-2 border-neutral-700 pl-3">
            <span className="text-neutral-500 uppercase tracking-wider text-[10px] font-bold block mb-0.5">
              Notes
            </span>
            {d.notes}
          </p>
        )}
      </div>

      <div className="flex md:flex-col gap-2 md:justify-start">
        {d.status === 'requested' && (
          <>
            <button
              onClick={onConfirm}
              disabled={busy}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded text-xs font-bold uppercase tracking-wide whitespace-nowrap"
            >
              Confirm
            </button>
            <button
              onClick={onCancel}
              disabled={busy}
              className="px-3 py-1.5 border border-neutral-700 hover:border-neutral-500 disabled:opacity-50 rounded text-xs font-bold uppercase tracking-wide text-neutral-300 whitespace-nowrap"
            >
              Cancel
            </button>
          </>
        )}
        {d.status === 'confirmed' && (
          <>
            <button
              onClick={onDelivered}
              disabled={busy}
              className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded text-xs font-bold uppercase tracking-wide whitespace-nowrap"
            >
              Mark delivered
            </button>
            <button
              onClick={onCancel}
              disabled={busy}
              className="px-3 py-1.5 border border-neutral-700 hover:border-neutral-500 disabled:opacity-50 rounded text-xs font-bold uppercase tracking-wide text-neutral-300 whitespace-nowrap"
            >
              Cancel
            </button>
          </>
        )}
        {(d.status === 'delivered' || d.status === 'cancelled') && (
          <span className="text-xs text-neutral-500 italic">
            {d.status === 'delivered' ? 'Completed' : 'Cancelled'}
          </span>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: DeliveryStatus }) {
  const styles: Record<DeliveryStatus, string> = {
    requested: 'bg-red-950/50 text-red-300 border border-red-900',
    confirmed: 'bg-amber-950/50 text-amber-300 border border-amber-900',
    delivered: 'bg-green-950/50 text-green-300 border border-green-900',
    cancelled: 'bg-neutral-900 text-neutral-500 border border-neutral-800',
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${styles[status]}`}
    >
      {status}
    </span>
  );
}

// Parseamos "2026-05-28T15:00:00" en su tz de origen (LA) y devolvemos
// un label "Today · 3-5 PM" / "Tomorrow · 9-11 AM" / "May 28 · 1-3 PM".
// Nota: no usamos new Date(iso) porque eso interpretaría en tz local del
// admin y podría desplazar el día si estás viendo desde otra tz.
function formatScheduled(iso: string, day: 'today' | 'tomorrow'): string {
  // iso = "YYYY-MM-DDTHH:mm:ss"
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const [, y, mo, d, hh] = m;
  const hourStart = parseInt(hh, 10);
  const hourEnd = hourStart + 2;
  const timeLabel = `${to12h(hourStart)}–${to12h(hourEnd)}`;

  // Comparamos vs hoy en la MISMA tz que el ISO representa. Es
  // suficiente comparar los primeros 10 chars con `today` en LA tz.
  const laToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  // en-CA da "YYYY-MM-DD"
  const isoDate = `${y}-${mo}-${d}`;

  if (isoDate === laToday) return `Today · ${timeLabel}`;
  // Tomorrow check
  const tmr = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const laTmr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(tmr);
  if (isoDate === laTmr) return `Tomorrow · ${timeLabel}`;

  // Fallback: mostrar día del mes.
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(
    new Date(`${y}-${mo}-${d}T12:00:00`)
  );
  return `${monthName} ${parseInt(d, 10)} · ${timeLabel} (${day})`;
}

function to12h(h: number): string {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
}

function formatPhone(p: string): string {
  const d = (p || '').replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return p;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
