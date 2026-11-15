import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  FIXED_PARTY_MAP,
  UserRole,
  type PartyCode,
  type PartyConfig,
  type UserAccount,
} from '../types/fdmis';

const MAX_LOGO_DATA_URL_LENGTH = 260000;

async function computeSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected party logo file.'));
    reader.readAsDataURL(file);
  });
}

function resizeLogoDataUrl(dataUrl: string): Promise<{ dataUrl: string; blob: Blob | null }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 512;
      let width = img.naturalWidth || img.width || 256;
      let height = img.naturalHeight || img.height || 256;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable for logo optimization.'));
        return;
      }

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      let outUrl = canvas.toDataURL('image/png');
      if (outUrl.length > MAX_LOGO_DATA_URL_LENGTH) {
        outUrl = canvas.toDataURL('image/webp', 0.85);
      }
      if (outUrl.length > MAX_LOGO_DATA_URL_LENGTH) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        outUrl = canvas.toDataURL('image/jpeg', 0.8);
      }

      canvas.toBlob(
        (blob) => {
          resolve({ dataUrl: outUrl, blob });
        },
        'image/png'
      );
    };
    img.onerror = () => reject(new Error('Selected file is not a valid image (PNG, JPG, WebP, or SVG).'));
    img.src = dataUrl;
  });
}

export function observePartyConfigs(
  onData: (configs: Record<PartyCode, PartyConfig | null>) => void,
  onError: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'party_configs'),
    (snap) => {
      const map: Record<PartyCode, PartyConfig | null> = {
        APC: null,
        PDP: null,
        ADC: null,
        OTHERS: null,
      };
      snap.docs.forEach((d) => {
        const data = d.data() as PartyConfig;
        if (data.partyCode in map) {
          map[data.partyCode] = data;
        }
      });
      onData(map);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'party_configs');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function uploadPartyLogo(
  actor: UserAccount,
  partyCode: PartyCode,
  file: File
): Promise<PartyConfig> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated session required.');
  if (actor.role !== UserRole.FULL_CONTROL_ADMIN) {
    throw new Error('Only Full Control Admin can upload or replace political party logos.');
  }

  const fixedParty = FIXED_PARTY_MAP[partyCode];
  if (!fixedParty) {
    throw new Error('Invalid party selection. Only APC, PDP, ADC, and OTHERS are supported.');
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('Please upload an image file (PNG, JPG, WebP, or SVG).');
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const { dataUrl, blob } = await resizeLogoDataUrl(rawDataUrl);
  const safeFileName = file.name.trim().slice(0, 110) || `${partyCode.toLowerCase()}_logo.png`;
  const sha256Hash = await computeSha256(dataUrl);

  let finalLogoUrl = dataUrl;
  let storageMode: 'firebase_storage' | 'firestore_cloud' = 'firestore_cloud';

  // Attempt Firebase Cloud Storage first; fall back cleanly to Firestore cloud document if storage rules aren't enabled
  if (blob) {
    try {
      const path = `party_logos/${partyCode}/${Date.now()}_${safeFileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, blob, { contentType: blob.type || 'image/png' });
      const downloadUrl = await getDownloadURL(fileRef);
      if (downloadUrl && downloadUrl.length <= 340000) {
        finalLogoUrl = downloadUrl;
        storageMode = 'firebase_storage';
      }
    } catch {
      // Fallback safely stores compressed PNG directly inside protected cloud Firestore party_configs/{partyCode}
      storageMode = 'firestore_cloud';
    }
  }

  if (finalLogoUrl.length > 345000) {
    throw new Error('Logo image exceeds maximum cloud storage budget (345KB). Choose a smaller image.');
  }

  const payload = {
    partyCode,
    partyName: fixedParty.name,
    logoUrl: finalLogoUrl,
    storageMode,
    fileName: safeFileName,
    sha256Hash,
    updatedByUid: uid,
    updatedByName: actor.displayName.slice(0, 120),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'party_configs', partyCode), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `party_configs/${partyCode}`);
  }

  try {
    await setDoc(doc(collection(db, 'audit_logs')), {
      actorUid: uid,
      actorName: actor.displayName.slice(0, 120),
      actorEmail: actor.email.slice(0, 200),
      actorRole: actor.role,
      action: 'PARTY_LOGO_UPDATED',
      affectedEntity: 'party_configs',
      affectedId: partyCode,
      details: `Updated official logo for ${partyCode} (${fixedParty.name}) via ${storageMode}. File: ${safeFileName}.`,
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal audit mirror
  }

  return {
    partyCode,
    partyName: fixedParty.name,
    logoUrl: finalLogoUrl,
    storageMode,
    fileName: safeFileName,
    sha256Hash,
    updatedByUid: uid,
    updatedByName: actor.displayName,
  };
}
