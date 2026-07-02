'use client';
// Auth helpers — Firebase Phone Auth (mismo flow que Lafayette Market).
// El check de "es admin?" mira el user doc de Firestore en la colección
// `users` (compartida con Lafayette Market). Como usa el mismo Firebase
// project, un phone que ya es admin en Lafayette entra directo acá
// sin crear cuenta nueva.

import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut as fbSignOut,
  onAuthStateChanged,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

// Declaramos los globals que Firebase Phone Auth usa.
declare global {
  interface Window {
    recaptchaVerifier?: RecaptchaVerifier;
    confirmationResult?: ConfirmationResult;
  }
}

/**
 * Crea el RecaptchaVerifier (invisible) atado al elemento con el id
 * indicado. Retorna la instancia. Idempotente: si ya existe una, la
 * limpia primero para evitar "reCAPTCHA has already been rendered".
 */
export function setupRecaptcha(containerId: string): RecaptchaVerifier {
  if (typeof window === 'undefined') {
    throw new Error('setupRecaptcha called server-side');
  }
  if (window.recaptchaVerifier) {
    try {
      window.recaptchaVerifier.clear();
    } catch {
      // ignore
    }
    window.recaptchaVerifier = undefined;
  }
  window.recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
    callback: () => {
      /* success — nada que hacer, signInWithPhoneNumber continúa */
    },
    'expired-callback': () => {
      // Si el token expira antes de mandar el SMS, el próximo intento
      // reseteará el verifier.
    },
  });
  return window.recaptchaVerifier;
}

/**
 * Manda el SMS de verificación al número US (10 dígitos).
 * Guarda el `ConfirmationResult` en window para el segundo paso.
 */
export async function sendSmsCode(digitsUS: string): Promise<void> {
  if (!/^\d{10}$/.test(digitsUS)) {
    throw new Error('Phone must be 10 digits (US only).');
  }
  if (!window.recaptchaVerifier) {
    throw new Error('reCAPTCHA verifier not initialized.');
  }
  const result = await signInWithPhoneNumber(
    auth,
    `+1${digitsUS}`,
    window.recaptchaVerifier
  );
  window.confirmationResult = result;
}

/**
 * Confirma el código de 6 dígitos. Devuelve el User.
 */
export async function confirmSmsCode(code: string): Promise<User> {
  if (!/^\d{6}$/.test(code)) {
    throw new Error('Code must be 6 digits.');
  }
  if (!window.confirmationResult) {
    throw new Error('No pending confirmation. Request a new code.');
  }
  const cred = await window.confirmationResult.confirm(code);
  window.confirmationResult = undefined;
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
