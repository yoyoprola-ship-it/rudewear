'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '@/app/lib/firebase';
import type { Delivery } from '@/app/types';

// Inbox de SMS entrantes al número Twilio.
// Los mensajes los persiste el webhook /api/webhooks/twilio-sms que vive
// en el proyecto Lafayette Market (mismo Firebase project → misma
// colección `smsInbox`). Este panel los lee, muestra el customer si
// matchea por phone con rudewear_deliveries, y permite responder desde
// el mismo número Twilio.

interface InboxMessage {
  id: string;
  from: string;                              // '+13375551234'
  phoneDigits: string;                       // '3375551234'
  body: string;
  messageSid: string | null;
  receivedAt?: {
    seconds: number;
    nanoseconds: number;
  } | { toMillis: () => number };
  read?: boolean;
  replied?: boolean;
  replyBody?: string;
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const [replyTo, setReplyTo] = useState<InboxMessage | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [msgSnap, delivSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'smsInbox'),
            orderBy('receivedAt', 'desc'),
            limit(200)
          )
        ),
        getDocs(collection(db, 'rudewear_deliveries')),
      ]);
      setMessages(
        msgSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as InboxMessage)
      );
      setDeliveries(
        delivSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Delivery)
      );
    } catch (err) {
      console.error('[messages] load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Index phone → última delivery de ese customer (para pegar nombre).
  const phoneToDelivery = useMemo(() => {
    const m = new Map<string, Delivery>();
    for (const d of deliveries) {
      const p = (d.customerPhone || '').replace(/\D/g, '').slice(-10);
      if (p.length !== 10) continue;
      const existing = m.get(p);
      if (!existing || existing.scheduledAt < d.scheduledAt) {
        m.set(p, d);
      }
    }
    return m;
  }, [deliveries]);

  const filtered = useMemo(() => {
    if (filter === 'unread') return messages.filter((m) => !m.read);
    return messages;
  }, [messages, filter]);

  const unreadCount = useMemo(
    () => messages.filter((m) => !m.read).length,
    [messages]
  );

  const markRead = async (msg: InboxMessage) => {
    if (msg.read) return;
    try {
      await updateDoc(doc(db, 'smsInbox', msg.id), {
        read: true,
        readAt: serverTimestamp(),
      });
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, read: true } : m))
      );
    } catch (err) {
      console.error('[messages] mark read failed:', err);
    }
  };

  const openReply = (msg: InboxMessage) => {
    markRead(msg);
    setReplyTo(msg);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter mb-1">
            Messages
          </h1>
          <p className="text-sm text-neutral-500">
            SMS customers sent to your Twilio number. Reply from the same
            number.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-4 py-2 border border-neutral-700 hover:border-neutral-500 rounded text-sm font-bold uppercase tracking-wide disabled:opacity-50"
        >
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {(['unread', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide transition-colors ${
              filter === f
                ? 'bg-red-600 text-white'
                : 'text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800'
            }`}
          >
            {f}
            <span
              className={`ml-1.5 tabular-nums ${
                filter === f ? 'text-red-200' : 'text-neutral-500'
              }`}
            >
              {f === 'unread' ? unreadCount : messages.length}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-neutral-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="border border-neutral-800 rounded p-8 text-center">
          <p className="text-neutral-400">
            {filter === 'unread'
              ? 'No unread messages.'
              : 'No messages yet.'}
          </p>
          {filter === 'unread' && messages.length > 0 && (
            <button
              onClick={() => setFilter('all')}
              className="mt-3 text-xs text-red-500 hover:text-red-400 underline"
            >
              View all {messages.length}
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((msg) => {
            const delivery = phoneToDelivery.get(msg.phoneDigits);
            return (
              <MessageRow
                key={msg.id}
                msg={msg}
                delivery={delivery}
                onReply={() => openReply(msg)}
                onMarkRead={() => markRead(msg)}
              />
            );
          })}
        </div>
      )}

      {replyTo && (
        <ReplyModal
          msg={replyTo}
          customerName={
            phoneToDelivery.get(replyTo.phoneDigits)?.customerName || null
          }
          onClose={() => setReplyTo(null)}
          onSent={() => {
            // Marca replied en el doc para tener contexto en el próximo load.
            updateDoc(doc(db, 'smsInbox', replyTo.id), {
              replied: true,
              repliedAt: serverTimestamp(),
            }).catch(() => {});
            setMessages((prev) =>
              prev.map((m) =>
                m.id === replyTo.id ? { ...m, replied: true } : m
              )
            );
            setReplyTo(null);
          }}
        />
      )}
    </div>
  );
}

function MessageRow({
  msg,
  delivery,
  onReply,
  onMarkRead,
}: {
  msg: InboxMessage;
  delivery: Delivery | undefined;
  onReply: () => void;
  onMarkRead: () => void;
}) {
  const phoneDisplay = formatPhone(msg.phoneDigits);
  const when = formatReceivedAt(msg.receivedAt);
  return (
    <div
      className={`border rounded p-4 transition-colors ${
        msg.read
          ? 'border-neutral-800 bg-neutral-900/40'
          : 'border-red-900/60 bg-red-950/10'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {!msg.read && (
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
            )}
            {delivery ? (
              <p className="font-bold text-white">
                {delivery.customerName}
                <span className="text-neutral-500 font-normal ml-1">
                  · Rudewear customer
                </span>
              </p>
            ) : (
              <p className="font-bold text-neutral-400">Unknown sender</p>
            )}
            <a
              href={`tel:+1${msg.phoneDigits}`}
              className="text-sm text-neutral-300 hover:text-white underline decoration-neutral-700"
            >
              {phoneDisplay}
            </a>
            {msg.replied && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-green-400 border border-green-900 rounded px-1.5 py-0.5">
                ✓ replied
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-500 mb-2">{when}</p>
          <p className="text-sm text-neutral-100 whitespace-pre-wrap break-words border-l-2 border-neutral-700 pl-3">
            {msg.body || <span className="text-neutral-600 italic">(empty)</span>}
          </p>
        </div>
        <div className="flex flex-col gap-2 flex-shrink-0">
          <button
            onClick={onReply}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-xs font-bold uppercase tracking-wide whitespace-nowrap"
          >
            Reply
          </button>
          {!msg.read && (
            <button
              onClick={onMarkRead}
              className="px-3 py-1.5 border border-neutral-700 hover:border-neutral-500 rounded text-xs font-bold uppercase tracking-wide text-neutral-300 whitespace-nowrap"
            >
              Mark read
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReplyModal({
  msg,
  customerName,
  onClose,
  onSent,
}: {
  msg: InboxMessage;
  customerName: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const phoneDisplay = formatPhone(msg.phoneDigits);
  const charsLeft = 1600 - body.length;

  const send = async () => {
    if (sending || body.trim().length < 3) return;
    setSending(true);
    setError('');
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
          phones: [msg.phoneDigits],
          message: body.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      if ((data.sent || []).length === 0) {
        setError(
          (data.failed?.[0]?.error && `Twilio: ${data.failed[0].error}`) ||
            'Send failed'
        );
        return;
      }
      setDone(true);
      setTimeout(onSent, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

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
              Reply to
            </p>
            <h2 className="text-lg font-black uppercase tracking-tight text-white">
              {customerName || phoneDisplay}
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

        <div className="p-6 flex flex-col gap-4">
          {done ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-600 flex items-center justify-center text-white text-3xl">
                ✓
              </div>
              <p className="text-lg font-black uppercase">Sent</p>
            </div>
          ) : (
            <>
              <div className="border border-neutral-800 bg-neutral-900/50 rounded p-3">
                <p className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                  Their message
                </p>
                <p className="text-sm text-neutral-300 whitespace-pre-wrap break-words">
                  {msg.body}
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                  Your reply
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={5}
                  maxLength={1600}
                  autoFocus
                  disabled={sending}
                  placeholder="Type your reply…"
                  className="w-full px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded text-white placeholder:text-neutral-600 focus:outline-none focus:border-red-600 transition-colors resize-none"
                />
                <p
                  className={`text-xs mt-1 tabular-nums ${
                    charsLeft < 100 ? 'text-amber-500' : 'text-neutral-500'
                  }`}
                >
                  {body.length}/1600 · {Math.ceil(body.length / 160) || 1} SMS
                  segment{body.length > 160 ? 's' : ''}
                </p>
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button
                onClick={send}
                disabled={sending || body.trim().length < 3}
                className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed rounded font-bold uppercase tracking-wide text-sm"
              >
                {sending ? 'Sending…' : 'Send reply'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────
function formatPhone(p: string): string {
  const d = (p || '').replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return p;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function formatReceivedAt(ts: InboxMessage['receivedAt']): string {
  if (!ts) return '';
  let ms: number;
  if (typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    ms = (ts as { toMillis: () => number }).toMillis();
  } else if (typeof (ts as { seconds?: number }).seconds === 'number') {
    ms = (ts as { seconds: number }).seconds * 1000;
  } else {
    return '';
  }
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const d = new Date(ms);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
