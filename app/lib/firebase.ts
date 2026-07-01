// Firebase client SDK — compartimos el mismo proyecto que Lafayette
// Market para no crear infraestructura duplicada. Los emails de
// signup de rudewear se guardan en la colección `rudewear_signups`
// (prefijada para no chocar con nada del market).
//
// Env vars — copiadas de C:/Users/user/lafayette-market/.env.local
// (todas las NEXT_PUBLIC_FIREBASE_*).

import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Guard contra doble-init durante HMR en dev.
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);
