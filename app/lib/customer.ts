'use client';
// Customer profile helpers — save/load el user doc del cliente.
// Compartimos la colección `users` con Lafayette Market. Si el
// cliente ya existe (mismo phone → mismo UID), reusamos su doc y
// solo updateamos `name` si no lo tenía.

import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export interface CustomerProfile {
  uid: string;
  name: string;      // alias del cliente
  phone: string;     // 10 dígitos US
}

/** Lee el user doc. Devuelve null si no existe. */
export async function getCustomerProfile(uid: string): Promise<CustomerProfile | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      uid,
      name: typeof data.name === 'string' ? data.name : '',
      phone: typeof data.phone === 'string' ? data.phone : '',
    };
  } catch (err) {
    console.error('[customer] load failed:', err);
    return null;
  }
}

/**
 * Crea/actualiza el user doc con nombre y phone.
 * merge:true asegura que no pisamos otros campos que Lafayette Market
 * pueda haber puesto (role, address, etc.) si es un cliente compartido.
 *
 * NO seteamos registeredAt/updatedBy/otros trusted — Firestore rules
 * de Lafayette Market los blacklistean en client writes (ver
 * firestore.rules:63 blacklist). Con merge:true, Firestore no toca
 * esos campos si ya existen (populados por Lafayette server-side).
 */
export async function saveCustomerProfile(
  uid: string,
  name: string,
  phoneDigits: string
): Promise<void> {
  await setDoc(
    doc(db, 'users', uid),
    {
      name: name.trim(),
      phone: phoneDigits,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
