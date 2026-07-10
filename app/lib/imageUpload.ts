'use client';
// Helper de upload de imágenes de productos rudewear.
// Guarda en Storage bajo `rudewear/products/{timestamp}_{rand}.ext`.
// Devuelve la URL pública lista para meter en product.images[].

import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { storage } from './firebase';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // 10 MB (matches rules)
export const ACCEPTED_TYPES = /^image\/(jpeg|jpg|png|webp|heic|heif|gif)$/i;

export interface UploadProgress {
  file: File;
  progress: number;            // 0-100
  status: 'uploading' | 'done' | 'error';
  url?: string;
  error?: string;
}

/**
 * Sube un archivo. Callback con progreso opcional.
 * Devuelve la URL pública descargable.
 */
export function uploadProductImage(
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ACCEPTED_TYPES.test(file.type)) {
      reject(new Error('Unsupported file type. Use JPG, PNG, WebP, or HEIC.'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error('File too large (max 10 MB).'));
      return;
    }

    // Path: rudewear/products/{timestamp}_{random}.{ext}
    // Timestamp + random ensures uniqueness sin coordinación server-side.
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const safeName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const path = `rudewear/products/${safeName}`;
    const storageRef = ref(storage, path);

    const task = uploadBytesResumable(storageRef, file, {
      contentType: file.type,
    });

    task.on(
      'state_changed',
      (snap) => {
        const percent = snap.totalBytes > 0
          ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100)
          : 0;
        if (onProgress) onProgress(percent);
      },
      (err) => reject(err),
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve(url);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

/**
 * Borra una imagen del storage (para "eliminar" desde la UI).
 * Best-effort — si la URL no es de nuestro bucket la ignoramos.
 */
export async function deleteProductImage(publicUrl: string): Promise<void> {
  try {
    // Extraer path de la URL: `.../o/rudewear%2Fproducts%2F{name}?alt=media...`
    const m = publicUrl.match(/\/o\/([^?]+)/);
    if (!m) return;
    const path = decodeURIComponent(m[1]);
    if (!path.startsWith('rudewear/products/')) return;
    await deleteObject(ref(storage, path));
  } catch (err) {
    console.warn('[imageUpload] delete failed (non-fatal):', err);
  }
}
