// Firebase Admin SDK — server-side ONLY (usa credentials del
// service account de Cloud Run). Solo importar desde API routes,
// nunca desde componentes cliente.

import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// En Cloud Run + App Hosting, applicationDefault() usa las creds
// del service account automáticamente. En local (dev), si querés
// probar API routes con firebase-admin, seteá GOOGLE_APPLICATION_
// CREDENTIALS al path del service account JSON.
const app = getApps().length === 0
  ? initializeApp({
      credential: applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    })
  : getApps()[0];

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);
