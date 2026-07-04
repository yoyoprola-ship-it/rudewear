'use client';
// Customer profile helpers.
// Compartimos la colección `users` con Lafayette Market → mismo phone
// resuelve al mismo UID → mismo doc. La regla firestore de Lafayette
// blacklistea `addressLat`/`addressLng` en writes de cliente (son
// server-only), pero el string `address` sí lo puede escribir. Así
// que guardamos solo el string y en cada visita re-geocodeamos para
// el fee calc.

import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export interface CustomerProfile {
  uid: string;
  name: string;      // alias
  phone: string;     // 10 dígitos US
  address: string;   // formatted string (sin lat/lng)
}

export async function getCustomerProfile(uid: string): Promise<CustomerProfile | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      uid,
      name: typeof data.name === 'string' ? data.name : '',
      phone: typeof data.phone === 'string' ? data.phone : '',
      address: typeof data.address === 'string' ? data.address : '',
    };
  } catch (err) {
    console.error('[customer] load failed:', err);
    return null;
  }
}

/**
 * Guarda name + phone + address en el user doc con merge:true.
 * NO seteamos registeredAt/updatedBy/lat/lng — son blacklisted por
 * la regla firestore compartida con Lafayette Market. merge:true
 * preserva cualquier campo previo (role, etc.) sin tocarlos.
 */
export async function saveCustomerProfile(
  uid: string,
  fields: {
    name: string;
    phone: string;     // '' → skipea (no overwrite)
    address?: string;  // undefined/'' → skipea
  }
): Promise<void> {
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (fields.name.trim().length > 0) {
    payload.name = fields.name.trim();
  }
  if (fields.phone && /^\d{10}$/.test(fields.phone)) {
    payload.phone = fields.phone;
  }
  if (typeof fields.address === 'string' && fields.address.trim().length > 0) {
    payload.address = fields.address.trim();
  }
  await setDoc(doc(db, 'users', uid), payload, { merge: true });
}
