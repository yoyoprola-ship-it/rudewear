// Notificaciones al ADMIN_PHONE vía Twilio.
//
// Rudewear reutiliza los secrets de Twilio de Lafayette Market (misma
// cuenta de Twilio). El ADMIN_PHONE también es compartido.
//
// Este helper se llama fire-and-forget desde /api/create-delivery para
// avisar cuando llega una reserva nueva. NO bloquea la respuesta al
// cliente — si Twilio está caído la reserva igual se guardó y el
// admin puede verla en /admin/deliveries.

interface DeliveryNotifyPayload {
  customerName: string;
  customerPhone: string;         // 10 dígitos US
  address: string;
  scheduledAt: string;           // "YYYY-MM-DDTHH:mm:ss" local (CT)
  scheduledDay: 'today' | 'tomorrow';
}

/**
 * Manda un SMS al ADMIN_PHONE con los datos de una nueva reserva.
 *
 * No hace throw — todas las fallas se loggean pero se swallowean
 * porque esto se llama fire-and-forget desde el request handler.
 */
export async function notifyAdminOfNewDelivery(
  d: DeliveryNotifyPayload
): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  const rawAdminPhone = process.env.ADMIN_PHONE;

  if (!accountSid || !authToken || !fromNumber || !rawAdminPhone) {
    console.warn(
      '[notifyAdmin] Missing Twilio/ADMIN_PHONE env vars — skipping SMS'
    );
    return;
  }

  // Normalizar el phone del admin a E.164 (+1XXXXXXXXXX)
  const adminDigits = rawAdminPhone.replace(/\D/g, '');
  let toE164: string;
  if (adminDigits.length === 10) toE164 = `+1${adminDigits}`;
  else if (adminDigits.length === 11 && adminDigits.startsWith('1'))
    toE164 = `+${adminDigits}`;
  else toE164 = `+${adminDigits}`;

  const body = buildBody(d);

  // Timeout de 8s vía AbortController — Twilio p95 ~700ms; pasado 8s
  // preferimos abandonar antes que el request de create-delivery ya
  // haya devuelto al cliente hace rato.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const params = new URLSearchParams({
      To: toE164,
      From: fromNumber,
      Body: body,
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(
          `${accountSid}:${authToken}`
        ).toString('base64')}`,
      },
      body: params.toString(),
      signal: controller.signal,
    });
    if (!res.ok) {
      const result = await res.json().catch(() => ({}));
      console.error('[notifyAdmin] Twilio error:', {
        code: result?.code,
        status: res.status,
        message: result?.message,
      });
      return;
    }
    console.log('[notifyAdmin] SMS sent to admin about new delivery');
  } catch (err) {
    console.error('[notifyAdmin] SMS send failed:', err);
  } finally {
    clearTimeout(timer);
  }
}

function buildBody(d: DeliveryNotifyPayload): string {
  const phone = formatPhone(d.customerPhone);
  const when = formatWhen(d.scheduledAt, d.scheduledDay);
  // Address puede ser largo — Twilio corta SMS en 160 chars por
  // segmento y cobra por segmento. Truncamos a 80 para mantener
  // el SMS en 2 segmentos como mucho.
  const address = d.address.length > 80
    ? d.address.slice(0, 77) + '…'
    : d.address;

  return [
    'Rudewear: new delivery',
    `${d.customerName} · ${phone}`,
    when,
    address,
    'https://rudewear.lafayettelamarket.com/admin/deliveries',
  ].join('\n');
}

function formatPhone(p: string): string {
  const d = (p || '').replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return p;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function formatWhen(iso: string, day: 'today' | 'tomorrow'): string {
  // "2026-05-28T15:00:00" → "Today 3-5 PM" / "Tomorrow 9-11 AM"
  const m = iso.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):/);
  if (!m) return `${day} ${iso}`;
  const hourStart = parseInt(m[1], 10);
  const hourEnd = hourStart + 2;
  const dayLabel = day === 'today' ? 'Today' : 'Tomorrow';
  return `${dayLabel} ${to12h(hourStart)}-${to12h(hourEnd)}`;
}

function to12h(h: number): string {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${suffix}`;
}
