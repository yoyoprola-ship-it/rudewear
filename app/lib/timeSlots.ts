// Time slots para la tienda móvil.
// Horario: 9 AM a 7 PM (10 horas). Slots de 2 horas cada uno:
//   9-11, 11-13, 13-15, 15-17, 17-19 → 5 slots por día.
// Cliente elige entre hoy y mañana.
// Buffer 30 min: si faltan menos de 30 min al inicio del slot, no
// se puede seleccionar (necesitamos tiempo para preparar la visita).

export const STORE_OPEN_HOUR = 9;
export const STORE_CLOSE_HOUR = 19;
export const SLOT_DURATION_HOURS = 2;
export const BOOKING_BUFFER_MINUTES = 30;

/** Zona horaria de operación (Louisiana). */
export const OPERATION_TZ = 'America/Chicago';

/** Horas de inicio de cada slot. */
export const SLOT_START_HOURS = [9, 11, 13, 15, 17];

export interface TimeSlot {
  iso: string;          // ISO local del INICIO del slot
  label: string;        // "9:00 AM – 11:00 AM"
  day: 'today' | 'tomorrow';
  hour: number;         // hora de inicio 0-23
}

/** Formato humano de hora en 12h con AM/PM. */
function formatHour(h: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${period}`;
}

function slotLabel(startHour: number): string {
  return `${formatHour(startHour)} – ${formatHour(startHour + SLOT_DURATION_HOURS)}`;
}

/** Genera los slots hoy + mañana. Hoy filtra los slots donde faltan
 *  menos de BOOKING_BUFFER_MINUTES para el inicio. */
export function getAvailableSlots(now: Date = new Date()): TimeSlot[] {
  const slots: TimeSlot[] = [];

  // "Ahora" en la zona local del store.
  const localNow = new Date(
    now.toLocaleString('en-US', { timeZone: OPERATION_TZ })
  );

  // TODAY
  for (const h of SLOT_START_HOURS) {
    const slotStart = new Date(localNow);
    slotStart.setHours(h, 0, 0, 0);
    const minutesUntilStart = (slotStart.getTime() - localNow.getTime()) / 60000;
    // Debe faltar al menos BOOKING_BUFFER_MINUTES.
    if (minutesUntilStart < BOOKING_BUFFER_MINUTES) continue;

    slots.push({
      iso: toIsoLocal(slotStart),
      label: slotLabel(h),
      day: 'today',
      hour: h,
    });
  }

  // TOMORROW — todos los slots (siempre están a más de 30 min).
  const tomorrow = new Date(localNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  for (const h of SLOT_START_HOURS) {
    const slotStart = new Date(tomorrow);
    slotStart.setHours(h, 0, 0, 0);
    slots.push({
      iso: toIsoLocal(slotStart),
      label: slotLabel(h),
      day: 'tomorrow',
      hour: h,
    });
  }

  return slots;
}

/** ISO local sin timezone: "YYYY-MM-DDTHH:mm:ss". */
function toIsoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
  );
}

/** Formato humano completo: "Today · 9:00 AM – 11:00 AM". */
export function formatSlot(slot: TimeSlot): string {
  const dayLabel = slot.day === 'today' ? 'Today' : 'Tomorrow';
  return `${dayLabel} · ${slot.label}`;
}
