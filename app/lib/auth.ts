'use client';
// Auth helpers — email/password para el admin.
// El check de "es admin?" mira el user doc de Firestore en la
// colección `users` (compartida con Lafayette Market) — role debe
// ser 'admin'.

import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

export async function signInAdmin(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}

export async function isAdmin(uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return false;
    return snap.data()?.role === 'admin';
  } catch (err) {
    console.error('[isAdmin] check failed:', err);
    return false;
  }
}

/** Suscribe al cambio de auth. Devuelve unsubscribe. */
export function onAuthChange(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}
