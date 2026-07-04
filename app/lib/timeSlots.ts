// Time slot generator para la tienda móvil.
// Horario: 9 AM a 7 PM (última entrega 6 PM, para completar antes
// del cierre). Slots horarios. Cliente elige entre hoy y mañana.

export const STORE_OPEN_HOUR = 9;     // 9 AM
export const STORE_CLOSE_HOUR = 19;   // 7 PM
export const LAST_SLOT_HOUR = 18;     // 6 PM = último slot que arranca

/** Zona horaria de operación (Louisiana = America/Chicago). */
export const OPERATION_TZ = 'America/Chicago';

export interface TimeSlot {
  iso: string;                   // full ISO en la zona local
  label: string;                 // "9:00 AM"
  day: 'today' | 'tomorrow';
  hour: number;                  // 0-23
  isPast?: boolean;              // true si el slot ya pasó (solo aplica a hoy)
}

/** Formato humano de hora en 12h con AM/PM. */
function formatHour(h: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${period}`;
}

/** Devuelve slots disponibles hoy + mañana. Hoy excluye horas
 *  pasadas (si son las 3 PM, el primer slot disponible hoy es 4 PM
 *  o el próximo, siempre que llegue antes del cierre). */
export function getAvailableSlots(now: Date = new Date()): TimeSlot[] {
  const slots: TimeSlot[] = [];

  // "Ahora" según la zona de operación — hacemos un truco simple:
  // usamos toLocaleString para obtener la hora local del store.
  const localNow = new Date(
    now.toLocaleString('en-US', { timeZone: OPERATION_TZ })
  );
  const currentHour = localNow.getHours();
  // Bufeamos 1 hora — no aceptamos slots que arranquen en <1h.
  const minHourToday = currentHour + 1;

  // TODAY
  for (let h = STORE_OPEN_HOUR; h <= LAST_SLOT_HOUR; h++) {
    if (h < minHourToday) continue;  // slot ya pasó / muy cercano
    const iso = toIsoWithHour(localNow, h);
    slots.push({
      iso,
      label: formatHour(h),
      day: 'today',
      hour: h,
    });
  }

  // TOMORROW — siempre todos los slots
  const tomorrow = new Date(localNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  for (let h = STORE_OPEN_HOUR; h <= LAST_SLOT_HOUR; h++) {
    const iso = toIsoWithHour(tomorrow, h);
    slots.push({
      iso,
      label: formatHour(h),
      day: 'tomorrow',
      hour: h,
    });
  }

  return slots;
}

/** Construye un ISO string con la fecha dada y la hora indicada
 *  interpretado en la zona local del navegador. Nota: usamos ISO
 *  local (sin Z) para simplicidad — el server lo re-interpreta como
 *  hora local del store cuando lo lee. */
function toIsoWithHour(base: Date, hour: number): string {
  const d = new Date(base);
  d.setHours(hour, 0, 0, 0);
  // ISO local con offset — formato "YYYY-MM-DDTHH:mm:ss".
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
  );
}

/** Formato humano completo de un slot: "Today 3:00 PM" o "Tomorrow 9:00 AM". */
export function formatSlot(slot: TimeSlot): string {
  const dayLabel = slot.day === 'today' ? 'Today' : 'Tomorrow';
  return `${dayLabel} · ${slot.label}`;
}
