'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  collection,
  doc,
  getDocs,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '@/app/lib/firebase';
import type { Delivery, DeliveryStatus } from '@/app/types';
import { DELIVERY_ORIGIN_COORDS } from '@/app/lib/pricing';

// Panel mapa de deliveries — muestra markers coloreados por status,
// permite seleccionar customers con checkbox y mandar un SMS broadcast
// via /api/admin/broadcast-sms. Todo pensado para planear la ruta
// del día y hacer un ping ("on my way", "running 10 min late").

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

type FilterKey = 'active' | 'requested' | 'confirmed' | 'delivered' | 'all';

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'requested', label: 'Requested' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'all', label: 'All' },
];

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export default function DeliveriesMapPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('active');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mapReady, setMapReady] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  const mapDivRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Record<string, any>>({});

  // ── Load deliveries ──────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'rudewear_deliveries'));
        setDeliveries(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Delivery)
        );
      } catch (err) {
        console.error('[map] load failed:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Load Google Maps JS API ──────────────────────────
  useEffect(() => {
    if (!MAPS_KEY) return;
    if (window.google?.maps) {
      setMapReady(true);
      return;
    }
    const existing = document.getElementById('google-maps-script');
    if (existing) {
      existing.addEventListener('load', () => setMapReady(true));
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-maps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}`;
    script.async = true;
    script.defer = true;
    script.onload = () => setMapReady(true);
    document.head.appendChild(script);
  }, []);

  // ── Init map + origin marker ─────────────────────────
  useEffect(() => {
    if (!mapReady || !mapDivRef.current || mapRef.current) return;
    const map = new window.google.maps.Map(mapDivRef.current, {
      center: DELIVERY_ORIGIN_COORDS,
      zoom: 11,
      disableDefaultUI: false,
      styles: DARK_MAP_STYLE,
    });
    mapRef.current = map;
    // Origin marker (donde sale el driver)
    new window.google.maps.Marker({
      position: DELIVERY_ORIGIN_COORDS,
      map,
      title: 'Store (origin)',
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: '#ffffff',
        fillOpacity: 1,
        strokeColor: '#000000',
        strokeWeight: 2,
      },
      zIndex: 999,
    });
  }, [mapReady]);

  const filtered = useMemo(() => {
    let list: Delivery[];
    if (filter === 'all') list = [...deliveries];
    else if (filter === 'active')
      list = deliveries.filter(
        (d) => d.status === 'requested' || d.status === 'confirmed'
      );
    else list = deliveries.filter((d) => d.status === filter);
    list.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    return list;
  }, [deliveries, filter]);

  // ── Paint markers whenever filtered list changes ─────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const activeIds = new Set(filtered.map((d) => d.id));

    // Remove markers not in current filter
    Object.entries(markersRef.current).forEach(([id, m]) => {
      if (!activeIds.has(id)) {
        m.setMap(null);
        delete markersRef.current[id];
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geocoder = new window.google.maps.Geocoder();

    filtered.forEach(async (d) => {
      if (markersRef.current[d.id]) {
        // Marker existe — reajustar color por si cambió el status
        // o el selected-highlight
        applyMarkerStyle(markersRef.current[d.id], d, selected.has(d.id));
        return;
      }

      let lat = d.lat;
      let lng = d.lng;

      if (typeof lat !== 'number' || typeof lng !== 'number') {
        // Geocode y cachear en el doc
        try {
          const res = await geocoder.geocode({ address: d.address });
          const loc = res.results?.[0]?.geometry?.location;
          if (!loc) return;
          lat = loc.lat();
          lng = loc.lng();
          try {
            await updateDoc(doc(db, 'rudewear_deliveries', d.id), {
              lat,
              lng,
            });
            // También actualizar el state local para próximas iteraciones
            setDeliveries((prev) =>
              prev.map((x) => (x.id === d.id ? { ...x, lat, lng } : x))
            );
          } catch (err) {
            console.warn('[map] cache lat/lng failed:', err);
          }
        } catch (err) {
          console.warn('[map] geocode failed for', d.id, err);
          return;
        }
      }

      if (typeof lat !== 'number' || typeof lng !== 'number') return;

      const marker = new window.google.maps.Marker({
        position: { lat, lng },
        map,
        title: `${d.customerName} · ${d.address}`,
      });
      applyMarkerStyle(marker, d, selected.has(d.id));

      marker.addListener('click', () => {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(d.id)) next.delete(d.id);
          else next.add(d.id);
          return next;
        });
      });

      markersRef.current[d.id] = marker;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, filtered, selected]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected(new Set(filtered.map((d) => d.id)));
  };
  const clearSelection = () => setSelected(new Set());

  const selectedList = filtered.filter((d) => selected.has(d.id));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter mb-1">
            Deliveries · Map
          </h1>
          <p className="text-sm text-neutral-500">
            Plan the route and message customers. Click a marker or a row
            to select.
          </p>
        </div>
        <Link
          href="/admin/deliveries"
          className="px-4 py-2 border border-neutral-700 hover:border-neutral-500 rounded text-sm font-bold uppercase tracking-wide"
        >
          ← List view
        </Link>
      </div>

      {!MAPS_KEY && (
        <p className="text-red-500 text-sm mb-4">
          NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set. Map won&apos;t load.
        </p>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1 mb-4">
        {FILTER_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide transition-colors ${
              filter === t.key
                ? 'bg-red-600 text-white'
                : 'text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 h-[calc(100vh-260px)] min-h-[500px]">
        {/* Map */}
        <div
          ref={mapDivRef}
          className="rounded border border-neutral-800 bg-neutral-900 min-h-[300px]"
        >
          {!mapReady && (
            <div className="h-full flex items-center justify-center text-neutral-500 text-sm">
              Loading map…
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="border border-neutral-800 rounded flex flex-col overflow-hidden">
          <div className="sticky top-0 bg-neutral-950 border-b border-neutral-800 p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-neutral-500 tabular-nums">
                {filtered.length} shown · {selected.size} selected
              </p>
              <div className="flex gap-1">
                <button
                  onClick={selectAllVisible}
                  disabled={filtered.length === 0}
                  className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400 hover:text-white border border-neutral-800 hover:border-neutral-700 rounded disabled:opacity-40"
                >
                  All
                </button>
                <button
                  onClick={clearSelection}
                  disabled={selected.size === 0}
                  className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400 hover:text-white border border-neutral-800 hover:border-neutral-700 rounded disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
            </div>
            <button
              onClick={() => setComposeOpen(true)}
              disabled={selected.size === 0}
              className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed rounded text-xs font-bold uppercase tracking-wide"
            >
              Message {selected.size} selected
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && (
              <p className="p-4 text-neutral-500 text-sm">Loading…</p>
            )}
            {!loading && filtered.length === 0 && (
              <p className="p-4 text-neutral-500 text-sm">
                No deliveries in this filter.
              </p>
            )}
            {filtered.map((d) => (
              <SidebarRow
                key={d.id}
                d={d}
                selected={selected.has(d.id)}
                onToggle={() => toggle(d.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {composeOpen && (
        <ComposeModal
          recipients={selectedList}
          onClose={() => setComposeOpen(false)}
          onSent={() => {
            setComposeOpen(false);
            clearSelection();
          }}
        />
      )}
    </div>
  );
}

// ─── Sidebar row ─────────────────────────────────────
function SidebarRow({
  d,
  selected,
  onToggle,
}: {
  d: Delivery;
  selected: boolean;
  onToggle: () => void;
}) {
  const when = formatWhen(d.scheduledAt, d.scheduledDay);
  return (
    <label
      className={`flex gap-3 p-3 border-b border-neutral-800 cursor-pointer transition-colors ${
        selected ? 'bg-red-950/30' : 'hover:bg-neutral-900'
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="mt-0.5 w-4 h-4 accent-red-600 cursor-pointer flex-shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="font-bold text-sm text-white truncate">
            {d.customerName}
          </p>
          <StatusDot status={d.status} />
        </div>
        <p className="text-xs text-neutral-500">{when}</p>
        <p className="text-xs text-neutral-400 truncate">{d.address}</p>
        {typeof d.distanceMiles === 'number' &&
          typeof d.deliveryFee === 'number' && (
            <p className="text-[11px] text-neutral-500 mt-0.5">
              {d.distanceMiles} mi ·{' '}
              {d.deliveryFee > 0
                ? `$${d.deliveryFee.toFixed(2)} card/cash`
                : 'Free'}
            </p>
          )}
      </div>
    </label>
  );
}

function StatusDot({ status }: { status: DeliveryStatus }) {
  const color = statusColor(status);
  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ backgroundColor: color }}
      title={status}
    />
  );
}

// ─── Compose modal ───────────────────────────────────
function ComposeModal({
  recipients,
  onClose,
  onSent,
}: {
  recipients: Delivery[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    sentCount: number;
    failedCount: number;
    uniquePhones: number;
    error?: string;
  } | null>(null);

  // Dedupe recipients by phone para el count real (mostrar antes de enviar
  // qué customers únicos van a recibir el SMS).
  const uniquePhones = useMemo(() => {
    const s = new Set<string>();
    recipients.forEach((r) => {
      const p = (r.customerPhone || '').replace(/\D/g, '').slice(-10);
      if (p.length === 10) s.add(p);
    });
    return s.size;
  }, [recipients]);

  const send = async () => {
    if (sending) return;
    if (message.trim().length < 3) return;
    setSending(true);
    setResult(null);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Session expired');
      const res = await fetch('/api/admin/broadcast-sms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          deliveryIds: recipients.map((r) => r.id),
          message: message.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({
          sentCount: 0,
          failedCount: 0,
          uniquePhones,
          error: data.error || `HTTP ${res.status}`,
        });
        return;
      }
      setResult({
        sentCount: (data.sent || []).length,
        failedCount: (data.failed || []).length,
        uniquePhones: data.uniquePhones || uniquePhones,
      });
    } catch (err) {
      setResult({
        sentCount: 0,
        failedCount: 0,
        uniquePhones,
        error: err instanceof Error ? err.message : 'Send failed',
      });
    } finally {
      setSending(false);
    }
  };

  const charsLeft = 1600 - message.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        className="bg-neutral-950 border border-neutral-800 w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-neutral-950 border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">
              Twilio broadcast
            </p>
            <h2 className="text-lg font-black uppercase tracking-tight text-white">
              Message customers
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-white text-2xl"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-6">
          {result ? (
            <div className="text-center py-4">
              {result.error ? (
                <>
                  <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-900 flex items-center justify-center text-white text-3xl">
                    ×
                  </div>
                  <p className="text-lg font-black uppercase mb-2 text-red-400">
                    Broadcast failed
                  </p>
                  <p className="text-sm text-neutral-400 mb-6">
                    {result.error}
                  </p>
                </>
              ) : (
                <>
                  <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-600 flex items-center justify-center text-white text-3xl">
                    ✓
                  </div>
                  <p className="text-lg font-black uppercase mb-2">
                    Sent
                  </p>
                  <p className="text-sm text-neutral-400 mb-6">
                    Delivered to{' '}
                    <strong className="text-white">
                      {result.sentCount}
                    </strong>{' '}
                    unique phone{result.sentCount === 1 ? '' : 's'}.
                    {result.failedCount > 0 && (
                      <>
                        {' '}
                        <span className="text-amber-400">
                          {result.failedCount} failed.
                        </span>
                      </>
                    )}
                  </p>
                </>
              )}
              <button
                onClick={result.error ? () => setResult(null) : onSent}
                className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 rounded font-bold uppercase tracking-wide text-sm"
              >
                {result.error ? 'Try again' : 'Close'}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="border border-neutral-800 bg-neutral-900/50 rounded p-3">
                <p className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                  Recipients
                </p>
                <p className="text-sm text-neutral-300">
                  <strong className="text-white">{uniquePhones}</strong>{' '}
                  unique phone{uniquePhones === 1 ? '' : 's'} across{' '}
                  {recipients.length} selected reservation
                  {recipients.length === 1 ? '' : 's'}
                </p>
                <ul className="mt-2 space-y-0.5 max-h-32 overflow-y-auto text-xs text-neutral-400">
                  {recipients.map((r) => (
                    <li key={r.id}>
                      • {r.customerName} · {formatPhone(r.customerPhone)}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                  Message
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  maxLength={1600}
                  placeholder="Hey, we're on our way. Should be there in 10 minutes."
                  className="w-full px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded text-white placeholder:text-neutral-600 focus:outline-none focus:border-red-600 transition-colors resize-none"
                  disabled={sending}
                  autoFocus
                />
                <p
                  className={`text-xs mt-1 tabular-nums ${
                    charsLeft < 100 ? 'text-amber-500' : 'text-neutral-500'
                  }`}
                >
                  {message.length}/1600 · sends as{' '}
                  {Math.ceil(message.length / 160) || 1} SMS segment
                  {message.length > 160 ? 's' : ''}
                </p>
              </div>

              <button
                onClick={send}
                disabled={sending || message.trim().length < 3 || uniquePhones === 0}
                className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed rounded font-bold uppercase tracking-wide text-sm"
              >
                {sending
                  ? 'Sending…'
                  : `Send to ${uniquePhones} phone${uniquePhones === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────
function statusColor(status: DeliveryStatus): string {
  switch (status) {
    case 'requested':
      return '#ef4444';
    case 'confirmed':
      return '#f59e0b';
    case 'delivered':
      return '#10b981';
    case 'cancelled':
      return '#6b7280';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyMarkerStyle(marker: any, d: Delivery, isSelected: boolean) {
  const color = statusColor(d.status);
  marker.setIcon({
    path: window.google.maps.SymbolPath.CIRCLE,
    scale: isSelected ? 14 : 10,
    fillColor: color,
    fillOpacity: 0.9,
    strokeColor: isSelected ? '#ffffff' : color,
    strokeWeight: isSelected ? 3 : 1,
  });
}

function formatPhone(p: string): string {
  const d = (p || '').replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return p;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function formatWhen(iso: string, day: 'today' | 'tomorrow'): string {
  const m = iso.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):/);
  if (!m) return `${day} ${iso}`;
  const hourStart = parseInt(m[1], 10);
  const hourEnd = hourStart + 2;
  const dayLabel = day === 'today' ? 'Today' : 'Tomorrow';
  return `${dayLabel} · ${to12h(hourStart)}–${to12h(hourEnd)}`;
}

function to12h(h: number): string {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
}

// Dark map style — mismo look-and-feel que el resto del admin.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DARK_MAP_STYLE: any[] = [
  { elementType: 'geometry', stylers: [{ color: '#212121' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#212121' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry',
    stylers: [{ color: '#757575' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.fill',
    stylers: [{ color: '#2c2c2c' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#8a8a8a' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#000000' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#3d3d3d' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }],
  },
];
