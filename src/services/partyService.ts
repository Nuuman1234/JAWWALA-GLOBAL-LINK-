import {
  Bytes,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocsFromServer,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage';
import { auth, db, storage } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { loadGlobalSnapshot, saveGlobalSnapshot } from './offlineQueue';
import {
  FIXED_PARTY_MAP,
  UserRole,
  type PartyCode,
  type PartyConfig,
  type PartyLogoStorageMode,
  type UserAccount,
} from '../types/fdmis';

export const ALLOWED_PARTY_LOGO_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
export const ALLOWED_PARTY_LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;
export const MAX_PARTY_LOGO_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB raw file limit
export const MAX_PARTY_LOGO_STORED_BYTES = 650 * 1024; // 650 KB normalized binary asset limit
export const PARTY_ASSET_URI_PREFIX = 'fdmis-asset://party_logo_assets/';

const STORAGE_UPLOAD_TIMEOUT_MS = 4000;
const ASSET_OFFLINE_SNAPSHOT_PREFIX = 'partyLogoAsset::';

type SupportedLogoMime = (typeof ALLOWED_PARTY_LOGO_MIME_TYPES)[number];

interface ValidatedLogoImage {
  file: File;
  detectedMime: SupportedLogoMime;
  width: number;
  height: number;
}

interface NormalizedLogoBinary {
  bytes: Uint8Array;
  blob: Blob;
  contentType: SupportedLogoMime;
  width: number;
  height: number;
  sha256Hash: string;
}

interface CachedAssetEntry {
  objectUrl: string;
  contentType: string;
  sha256Hash: string;
}

interface OfflineLogoAssetSnapshot {
  assetId: string;
  partyCode: PartyCode;
  contentType: string;
  sha256Hash: string;
  bytesArray: number[];
}

// Track Firebase Storage bucket availability within session so unprovisioned 404 buckets never stall uploads
let firebaseStorageBucketAvailable: boolean | null = null;

// In-memory resolved display URL cache keyed by `${assetId}::${sha256Hash}`
const resolvedAssetUrlCache = new Map<string, CachedAssetEntry>();
const inflightAssetLoads = new Map<string, Promise<string | null>>();

export function createEmptyPartyConfigMap(): Record<PartyCode, PartyConfig | null> {
  return {
    APC: null,
    PDP: null,
    ADC: null,
    OTHERS: null,
  };
}

export function extractPartyLogoAssetId(config?: PartyConfig | null): string | null {
  if (!config) return null;
  if (config.logoAssetId && /^[a-zA-Z0-9_-]{3,128}$/.test(config.logoAssetId)) {
    return config.logoAssetId;
  }
  if (config.logoUrl && config.logoUrl.startsWith(PARTY_ASSET_URI_PREFIX)) {
    const id = config.logoUrl.slice(PARTY_ASSET_URI_PREFIX.length).trim();
    if (/^[a-zA-Z0-9_-]{3,128}$/.test(id)) {
      return id;
    }
  }
  if (config.storagePath && config.storagePath.startsWith('party_logo_assets/')) {
    const id = config.storagePath.slice('party_logo_assets/'.length).trim();
    if (/^[a-zA-Z0-9_-]{3,128}$/.test(id)) {
      return id;
    }
  }
  return null;
}

export function hasConfiguredPartyLogo(config?: PartyConfig | null): boolean {
  if (!config) return false;
  if (config.storageMode === 'none') return false;
  const url = (config.logoUrl || '').trim();
  if (!url || url.startsWith('blob:')) return false;
  if (url.startsWith(PARTY_ASSET_URI_PREFIX)) {
    return Boolean(extractPartyLogoAssetId(config));
  }
  return url.startsWith('https://') || url.startsWith('data:image/');
}

function normalizeMimeType(rawMime: string): SupportedLogoMime | null {
  const lower = rawMime.trim().toLowerCase();
  if (lower === 'image/png') return 'image/png';
  if (lower === 'image/jpeg' || lower === 'image/jpg') return 'image/jpeg';
  if (lower === 'image/webp') return 'image/webp';
  return null;
}

function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx < 0) return '';
  return fileName.slice(idx + 1).trim().toLowerCase();
}

function detectMimeFromMagicBytes(header: Uint8Array): SupportedLogoMime | null {
  if (header.length >= 8) {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (
      header[0] === 0x89 &&
      header[1] === 0x50 &&
      header[2] === 0x4e &&
      header[3] === 0x47 &&
      header[4] === 0x0d &&
      header[5] === 0x0a &&
      header[6] === 0x1a &&
      header[7] === 0x0a
    ) {
      return 'image/png';
    }
  }
  if (header.length >= 3) {
    // JPEG signature: FF D8 FF
    if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
      return 'image/jpeg';
    }
  }
  if (header.length >= 12) {
    // WebP signature: "RIFF" .... "WEBP"
    if (
      header[0] === 0x52 &&
      header[1] === 0x49 &&
      header[2] === 0x46 &&
      header[3] === 0x46 &&
      header[8] === 0x57 &&
      header[9] === 0x45 &&
      header[10] === 0x42 &&
      header[11] === 0x50
    ) {
      return 'image/webp';
    }
  }
  return null;
}

async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function loadDecodedImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const tempUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(tempUrl);
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height || width <= 0 || height <= 0) {
        reject(new Error('The selected image file is empty or corrupted and could not be decoded.'));
        return;
      }
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(tempUrl);
      reject(
        new Error(
          'The selected file appears corrupted or is not a valid PNG, JPG, JPEG, or WebP image.'
        )
      );
    };
    img.src = tempUrl;
  });
}

/**
 * Validates party logo file format (PNG, JPG, JPEG, WebP), size, binary signature, and image integrity.
 */
export async function validatePartyLogoFile(file: File): Promise<ValidatedLogoImage> {
  if (!file || file.size <= 0) {
    throw new Error('The selected file is empty. Please choose a valid PNG, JPG, JPEG, or WebP logo.');
  }

  if (file.size > MAX_PARTY_LOGO_UPLOAD_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    throw new Error(
      `Logo file is too large (${sizeMb} MB). Maximum allowed file size is 5 MB.`
    );
  }

  const ext = getFileExtension(file.name);
  const hasValidExt = (ALLOWED_PARTY_LOGO_EXTENSIONS as readonly string[]).includes(ext);
  const normalizedDeclaredMime = file.type ? normalizeMimeType(file.type) : null;

  if (file.type && !normalizedDeclaredMime) {
    throw new Error(
      'Unsupported file format. Only PNG, JPG, JPEG, and WebP images are permitted for party logos.'
    );
  }

  if (!hasValidExt && !normalizedDeclaredMime) {
    throw new Error(
      'Unsupported file extension. Please upload a PNG, JPG, JPEG, or WebP image file.'
    );
  }

  // Inspect actual binary file signature to reject renamed or corrupted files
  const headerBuffer = await file.slice(0, 16).arrayBuffer();
  const detectedMime = detectMimeFromMagicBytes(new Uint8Array(headerBuffer));
  if (!detectedMime) {
    throw new Error(
      'File signature verification failed. The file is either corrupted or not a genuine PNG, JPG, JPEG, or WebP image.'
    );
  }

  // Verify the browser can actually decode the full image payload
  const decodedImg = await loadDecodedImageFromFile(file);

  return {
    file,
    detectedMime,
    width: decodedImg.naturalWidth || decodedImg.width,
    height: decodedImg.naturalHeight || decodedImg.height,
  };
}

function canvasToBlobAsync(
  canvas: HTMLCanvasElement,
  mimeType: SupportedLogoMime,
  quality?: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

async function normalizeLogoToBinary(validated: ValidatedLogoImage): Promise<NormalizedLogoBinary> {
  const img = await loadDecodedImageFromFile(validated.file);

  const maxDim = 512;
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
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
    throw new Error('Unable to process logo image in this browser environment.');
  }

  const preferredMime: SupportedLogoMime =
    validated.detectedMime === 'image/jpeg' ? 'image/jpeg' : 'image/png';

  if (preferredMime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);

  let chosenBlob = await canvasToBlobAsync(
    canvas,
    preferredMime,
    preferredMime === 'image/jpeg' ? 0.9 : undefined
  );
  let chosenMime: SupportedLogoMime = preferredMime;

  // If PNG is larger than persistent cloud asset budget, try lossless/high-quality WebP preserving transparency
  if (!chosenBlob || chosenBlob.size > MAX_PARTY_LOGO_STORED_BYTES) {
    const webpBlob = await canvasToBlobAsync(canvas, 'image/webp', 0.88);
    if (webpBlob && webpBlob.type === 'image/webp' && webpBlob.size <= MAX_PARTY_LOGO_STORED_BYTES) {
      chosenBlob = webpBlob;
      chosenMime = 'image/webp';
    }
  }

  // Secondary JPEG fallback if still oversized
  if (!chosenBlob || chosenBlob.size > MAX_PARTY_LOGO_STORED_BYTES) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const jpegBlob = await canvasToBlobAsync(canvas, 'image/jpeg', 0.84);
    if (jpegBlob && jpegBlob.size <= MAX_PARTY_LOGO_STORED_BYTES) {
      chosenBlob = jpegBlob;
      chosenMime = 'image/jpeg';
    }
  }

  if (!chosenBlob || chosenBlob.size <= 0) {
    throw new Error('Failed to encode the party logo image. Please try another PNG, JPG, or WebP file.');
  }

  if (chosenBlob.size > MAX_PARTY_LOGO_STORED_BYTES) {
    throw new Error(
      'Optimized logo exceeds the 650 KB persistent cloud storage budget. Please upload a simpler or smaller logo image.'
    );
  }

  const buffer = await chosenBlob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const sha256Hash = await computeSha256Hex(bytes);

  return {
    bytes,
    blob: chosenBlob,
    contentType: chosenMime,
    width,
    height,
    sha256Hash,
  };
}

function mapPartyConfigDocs(
  docs: Array<{ id: string; data: () => Record<string, unknown> }>
): Record<PartyCode, PartyConfig | null> {
  const map = createEmptyPartyConfigMap();
  docs.forEach((d) => {
    const raw = d.data() as unknown as PartyConfig;
    const code = (raw?.partyCode || d.id) as PartyCode;
    if (code in map) {
      map[code] = {
        ...raw,
        partyCode: code,
      };
    }
  });
  return map;
}

export async function fetchPartyConfigsFromServer(): Promise<Record<PartyCode, PartyConfig | null>> {
  const snap = await getDocsFromServer(collection(db, 'party_configs'));
  return mapPartyConfigDocs(snap.docs);
}

export function observePartyConfigs(
  onData: (configs: Record<PartyCode, PartyConfig | null>) => void,
  onError: (err: Error) => void
): Unsubscribe {
  let receivedServerSnapshot = false;

  const unsubscribe = onSnapshot(
    collection(db, 'party_configs'),
    { includeMetadataChanges: true },
    (snap) => {
      if (!snap.metadata.fromCache) {
        receivedServerSnapshot = true;
      }
      const map = mapPartyConfigDocs(snap.docs);
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

  // Explicitly confirm authoritative server state on startup/refresh when online so stale empty cache cannot mask saved logos
  if (typeof navigator === 'undefined' || navigator.onLine) {
    void fetchPartyConfigsFromServer()
      .then((serverMap) => {
        if (!receivedServerSnapshot) {
          receivedServerSnapshot = true;
          onData(serverMap);
        }
      })
      .catch(() => {
        // Fallback to live snapshot / offline cache if transiently offline
      });
  }

  return unsubscribe;
}

function evictCachedAssetUrl(assetId: string): void {
  const prefix = `${assetId}::`;
  for (const [key, entry] of resolvedAssetUrlCache.entries()) {
    if (key.startsWith(prefix)) {
      URL.revokeObjectURL(entry.objectUrl);
      resolvedAssetUrlCache.delete(key);
    }
  }
}

function createDisplayObjectUrlFromBytes(
  assetId: string,
  bytes: Uint8Array,
  contentType: string,
  sha256Hash: string
): string {
  const cacheKey = `${assetId}::${sha256Hash || 'v1'}`;
  const existing = resolvedAssetUrlCache.get(cacheKey);
  if (existing) {
    return existing.objectUrl;
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: contentType || 'image/png' });
  const objectUrl = URL.createObjectURL(blob);
  resolvedAssetUrlCache.set(cacheKey, {
    objectUrl,
    contentType: contentType || 'image/png',
    sha256Hash,
  });
  return objectUrl;
}

async function persistOfflineAssetBinary(
  assetId: string,
  partyCode: PartyCode,
  contentType: string,
  sha256Hash: string,
  bytes: Uint8Array
): Promise<void> {
  try {
    const snapshot: OfflineLogoAssetSnapshot = {
      assetId,
      partyCode,
      contentType,
      sha256Hash,
      bytesArray: Array.from(bytes),
    };
    await saveGlobalSnapshot(`${ASSET_OFFLINE_SNAPSHOT_PREFIX}${assetId}`, snapshot);
  } catch {
    // Non-fatal offline mirror
  }
}

/**
 * Resolves a persisted PartyConfig reference into an img-renderable source URL.
 * - HTTPS Firebase Storage URLs are returned directly.
 * - Persistent Cloud Firestore Asset Store references (`fdmis-asset://party_logo_assets/{assetId}`)
 *   are fetched from `party_logo_assets/{assetId}` (with in-memory & offline cache) and rendered from binary bytes.
 * - Legacy inline data URLs remain supported so existing logos continue displaying seamlessly.
 * - Temporary `blob:` references are strictly rejected.
 */
export async function resolvePartyLogoDisplayUrl(
  config?: PartyConfig | null,
  options?: { forceServer?: boolean }
): Promise<string | null> {
  if (!config || config.storageMode === 'none') return null;

  const rawUrl = (config.logoUrl || '').trim();
  if (!rawUrl || rawUrl.startsWith('blob:')) return null;

  if (rawUrl.startsWith('https://')) {
    return rawUrl;
  }

  if (rawUrl.startsWith('data:image/')) {
    return rawUrl;
  }

  const assetId = extractPartyLogoAssetId(config);
  if (!assetId) return null;

  const cacheKey = `${assetId}::${config.sha256Hash || 'v1'}`;
  if (!options?.forceServer) {
    const cached = resolvedAssetUrlCache.get(cacheKey);
    if (cached) return cached.objectUrl;
  } else {
    evictCachedAssetUrl(assetId);
  }

  const inflightKey = `${cacheKey}::${options?.forceServer ? 'server' : 'default'}`;
  const existingPromise = inflightAssetLoads.get(inflightKey);
  if (existingPromise) {
    return existingPromise;
  }

  const loadPromise = (async (): Promise<string | null> => {
    try {
      const assetRef = doc(db, 'party_logo_assets', assetId);
      let snap = null;

      if (options?.forceServer) {
        snap = await getDocFromServer(assetRef);
      } else if (auth.currentUser) {
        try {
          snap = await getDoc(assetRef);
          if (!snap.exists() && (typeof navigator === 'undefined' || navigator.onLine)) {
            snap = await getDocFromServer(assetRef);
          }
        } catch {
          if (typeof navigator === 'undefined' || navigator.onLine) {
            snap = await getDocFromServer(assetRef);
          }
        }
      }

      if (snap && snap.exists()) {
        const data = snap.data() as {
          binaryData?: Bytes | Uint8Array;
          contentType?: string;
          sha256Hash?: string;
          partyCode?: PartyCode;
        };
        const rawBytes = data.binaryData;
        const uint8 =
          rawBytes instanceof Bytes
            ? rawBytes.toUint8Array()
            : rawBytes instanceof Uint8Array
              ? rawBytes
              : null;

        if (uint8 && uint8.byteLength > 0) {
          const contentType = data.contentType || config.contentType || 'image/png';
          const sha256Hash = data.sha256Hash || config.sha256Hash || '';
          void persistOfflineAssetBinary(
            assetId,
            data.partyCode || config.partyCode,
            contentType,
            sha256Hash,
            uint8
          );
          return createDisplayObjectUrlFromBytes(assetId, uint8, contentType, sha256Hash);
        }
      }

      // Cold-offline fallback: hydrate from global IndexedDB asset cache if available
      const offlineAsset = await loadGlobalSnapshot<OfflineLogoAssetSnapshot>(
        `${ASSET_OFFLINE_SNAPSHOT_PREFIX}${assetId}`
      );
      if (offlineAsset && Array.isArray(offlineAsset.bytesArray) && offlineAsset.bytesArray.length > 0) {
        return createDisplayObjectUrlFromBytes(
          assetId,
          new Uint8Array(offlineAsset.bytesArray),
          offlineAsset.contentType || config.contentType || 'image/png',
          offlineAsset.sha256Hash || config.sha256Hash || ''
        );
      }

      return null;
    } catch {
      const offlineAsset = await loadGlobalSnapshot<OfflineLogoAssetSnapshot>(
        `${ASSET_OFFLINE_SNAPSHOT_PREFIX}${assetId}`
      );
      if (offlineAsset && Array.isArray(offlineAsset.bytesArray) && offlineAsset.bytesArray.length > 0) {
        return createDisplayObjectUrlFromBytes(
          assetId,
          new Uint8Array(offlineAsset.bytesArray),
          offlineAsset.contentType || config.contentType || 'image/png',
          offlineAsset.sha256Hash || config.sha256Hash || ''
        );
      }
      return null;
    } finally {
      inflightAssetLoads.delete(inflightKey);
    }
  })();

  inflightAssetLoads.set(inflightKey, loadPromise);
  return loadPromise;
}

async function tryUploadToFirebaseStorage(
  storagePath: string,
  blob: Blob,
  contentType: SupportedLogoMime
): Promise<string | null> {
  if (firebaseStorageBucketAvailable === false) {
    return null;
  }

  try {
    // Cap Firebase Storage retries so unprovisioned 404 buckets fail fast instead of hanging for 10 minutes
    storage.maxUploadRetryTime = STORAGE_UPLOAD_TIMEOUT_MS - 500;
    const fileRef = storageRef(storage, storagePath);

    const downloadUrl = await Promise.race<string>([
      (async () => {
        await uploadBytes(fileRef, blob, {
          contentType,
          cacheControl: 'public, max-age=31536000, immutable',
        });
        return getDownloadURL(fileRef);
      })(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('storage_timeout')), STORAGE_UPLOAD_TIMEOUT_MS);
      }),
    ]);

    if (downloadUrl && downloadUrl.startsWith('https://') && downloadUrl.length <= 2000) {
      firebaseStorageBucketAvailable = true;
      return downloadUrl;
    }
    firebaseStorageBucketAvailable = false;
    return null;
  } catch {
    firebaseStorageBucketAvailable = false;
    return null;
  }
}

async function cleanupSupersededLogoAsset(previousConfig: PartyConfig | null): Promise<void> {
  if (!previousConfig || previousConfig.storageMode === 'none') return;

  if (previousConfig.storageMode === 'firestore_asset_store') {
    const prevAssetId = extractPartyLogoAssetId(previousConfig);
    if (prevAssetId) {
      evictCachedAssetUrl(prevAssetId);
      try {
        await deleteDoc(doc(db, 'party_logo_assets', prevAssetId));
      } catch {
        // Non-fatal cleanup
      }
    }
    return;
  }

  if (previousConfig.storageMode === 'firebase_storage' && previousConfig.storagePath) {
    try {
      await deleteObject(storageRef(storage, previousConfig.storagePath));
    } catch {
      // Non-fatal cleanup
    }
  }
}

export interface PartyLogoUploadResult {
  config: PartyConfig;
  displayUrl: string;
  replacedExisting: boolean;
}

/**
 * Permanently uploads or replaces a political party logo:
 * 1. Enforces Full Control Admin role and live network connectivity.
 * 2. Validates PNG/JPG/JPEG/WebP format, size, binary signature, and image integrity.
 * 3. Persists the binary asset in permanent cloud storage (Firebase Storage if enabled,
 *    otherwise the dedicated Firestore `party_logo_assets/{assetId}` binary media store)
 *    and verifies the uploaded object on the server.
 * 4. Saves the canonical storage reference in `party_configs/{partyCode}` linked by party ID.
 * 5. Confirms the database write directly from the server (`getDocFromServer`) and reloads
 *    the saved logo from persistent storage BEFORE reporting success.
 */
export async function uploadPartyLogo(
  actor: UserAccount,
  partyCode: PartyCode,
  file: File
): Promise<PartyLogoUploadResult> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error('An active authenticated session is required to upload party logos.');
  }
  if (actor.role !== UserRole.FULL_CONTROL_ADMIN) {
    throw new Error('Only Full Control Admin can upload or replace political party logos.');
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error(
      'You are currently offline. Connect to the internet so the party logo can be permanently saved to cloud storage and verified on the server.'
    );
  }

  const fixedParty = FIXED_PARTY_MAP[partyCode];
  if (!fixedParty) {
    throw new Error('Invalid party selection. Only APC, PDP, ADC, and OTHERS are supported.');
  }

  // Step 1: Validate format, size, magic bytes, and image integrity
  const validated = await validatePartyLogoFile(file);

  // Step 2: Normalize to optimized binary bytes (never storing temporary blob: or preview strings)
  const normalized = await normalizeLogoToBinary(validated);

  // Step 3: Read current server record so we know whether we are replacing an existing logo
  let previousConfig: PartyConfig | null = null;
  try {
    const prevSnap = await getDocFromServer(doc(db, 'party_configs', partyCode));
    if (prevSnap.exists()) {
      previousConfig = prevSnap.data() as PartyConfig;
    }
  } catch {
    // Proceeding safely even if document does not yet exist
  }

  const replacedExisting = hasConfiguredPartyLogo(previousConfig);
  const extFromMime =
    normalized.contentType === 'image/jpeg'
      ? 'jpg'
      : normalized.contentType === 'image/webp'
        ? 'webp'
        : 'png';
  const rawBaseName = file.name.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeFileName = (rawBaseName || `${partyCode.toLowerCase()}_logo.${extFromMime}`).slice(
    0,
    115
  );
  const assetId = `${partyCode}_${Date.now()}_${normalized.sha256Hash.slice(0, 10)}`;

  let finalLogoUrl = '';
  let storageMode: PartyLogoStorageMode = 'firestore_asset_store';
  let storagePath = '';
  let persistedAssetId = '';

  // Step 4A: Attempt Firebase Cloud Storage if bucket is active in the Firebase project
  const candidateStoragePath = `party_logos/${partyCode}/${assetId}.${extFromMime}`;
  const storageDownloadUrl = await tryUploadToFirebaseStorage(
    candidateStoragePath,
    normalized.blob,
    normalized.contentType
  );

  if (storageDownloadUrl) {
    finalLogoUrl = storageDownloadUrl;
    storageMode = 'firebase_storage';
    storagePath = candidateStoragePath;
    persistedAssetId = assetId;
  } else {
    // Step 4B: Persist binary image permanently in the dedicated Firestore Cloud Media Store
    const assetDocRef = doc(db, 'party_logo_assets', assetId);
    const assetPayload = {
      assetId,
      partyCode,
      fileName: safeFileName,
      contentType: normalized.contentType,
      fileSizeBytes: normalized.bytes.byteLength,
      width: normalized.width,
      height: normalized.height,
      sha256Hash: normalized.sha256Hash,
      binaryData: Bytes.fromUint8Array(normalized.bytes),
      uploadedByUid: uid,
      uploadedByName: actor.displayName.slice(0, 120),
      createdAt: serverTimestamp(),
    };

    try {
      await setDoc(assetDocRef, assetPayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `party_logo_assets/${assetId}`);
    }

    // Confirm binary asset actually exists on the server before updating party record
    let verifiedAssetSnap;
    try {
      verifiedAssetSnap = await getDocFromServer(assetDocRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `party_logo_assets/${assetId}`);
    }

    if (!verifiedAssetSnap.exists()) {
      throw new Error(
        'Logo file upload could not be confirmed on the cloud server. Please check your connection and try again.'
      );
    }

    const verifiedAssetData = verifiedAssetSnap.data() as {
      sha256Hash?: string;
      partyCode?: string;
      binaryData?: Bytes;
    };
    if (
      verifiedAssetData.partyCode !== partyCode ||
      verifiedAssetData.sha256Hash !== normalized.sha256Hash ||
      !(verifiedAssetData.binaryData instanceof Bytes) ||
      verifiedAssetData.binaryData.toUint8Array().byteLength === 0
    ) {
      throw new Error(
        'Server integrity verification failed for the uploaded logo asset. Please retry the upload.'
      );
    }

    storageMode = 'firestore_asset_store';
    persistedAssetId = assetId;
    storagePath = `party_logo_assets/${assetId}`;
    finalLogoUrl = `${PARTY_ASSET_URI_PREFIX}${assetId}`;
  }

  if (!finalLogoUrl || finalLogoUrl.startsWith('blob:')) {
    throw new Error('Refused to store a temporary browser URL as a permanent party logo reference.');
  }

  // Step 5: Save the permanent storage reference in the party database record (`party_configs/{partyCode}`)
  const partyDocRef = doc(db, 'party_configs', partyCode);
  const partyPayload = {
    partyCode,
    partyName: fixedParty.name,
    logoUrl: finalLogoUrl,
    storageMode,
    storagePath,
    logoAssetId: persistedAssetId,
    fileName: safeFileName,
    contentType: normalized.contentType,
    fileSizeBytes: normalized.bytes.byteLength,
    sha256Hash: normalized.sha256Hash,
    updatedByUid: uid,
    updatedByName: actor.displayName.slice(0, 120),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(partyDocRef, partyPayload);
  } catch (error) {
    // Roll back orphaned new asset if database reference write fails
    if (storageMode === 'firestore_asset_store' && persistedAssetId) {
      void deleteDoc(doc(db, 'party_logo_assets', persistedAssetId)).catch(() => {});
    }
    handleFirestoreError(error, OperationType.WRITE, `party_configs/${partyCode}`);
  }

  // Step 6: Confirm the database update succeeded directly on the server
  let confirmedPartySnap;
  try {
    confirmedPartySnap = await getDocFromServer(partyDocRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `party_configs/${partyCode}`);
  }

  if (!confirmedPartySnap.exists()) {
    throw new Error(
      `Database confirmation failed: party record ${partyCode} could not be read back from the server.`
    );
  }

  const confirmedConfig = confirmedPartySnap.data() as PartyConfig;
  if (
    confirmedConfig.partyCode !== partyCode ||
    confirmedConfig.logoUrl !== finalLogoUrl ||
    confirmedConfig.sha256Hash !== normalized.sha256Hash
  ) {
    throw new Error(
      `Database confirmation mismatch for ${partyCode}. The uploaded logo reference was not confirmed on the server.`
    );
  }

  // Step 7: Reload the saved logo directly from persistent storage to confirm end-to-end display
  const displayUrl = await resolvePartyLogoDisplayUrl(confirmedConfig, { forceServer: true });
  if (!displayUrl) {
    throw new Error(
      `The logo reference was saved for ${partyCode}, but the image could not be reloaded from persistent storage.`
    );
  }

  // Step 8: Clean up any previous superseded logo asset (only if it has a different asset/path)
  if (
    previousConfig &&
    (extractPartyLogoAssetId(previousConfig) !== persistedAssetId ||
      previousConfig.storagePath !== storagePath)
  ) {
    void cleanupSupersededLogoAsset(previousConfig);
  }

  // Step 9: Record audit trail
  try {
    await setDoc(doc(collection(db, 'audit_logs')), {
      actorUid: uid,
      actorName: actor.displayName.slice(0, 120),
      actorEmail: actor.email.slice(0, 200),
      actorRole: actor.role,
      action: replacedExisting ? 'PARTY_LOGO_REPLACED' : 'PARTY_LOGO_UPDATED',
      affectedEntity: 'party_configs',
      affectedId: partyCode,
      details: `${replacedExisting ? 'Replaced' : 'Uploaded'} official logo for ${partyCode} (${fixedParty.name}) in persistent storage (${storagePath}). File: ${safeFileName} (${Math.round(normalized.bytes.byteLength / 1024)} KB).`,
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal audit entry
  }

  return {
    config: confirmedConfig,
    displayUrl,
    replacedExisting,
  };
}

/**
 * Permanently removes a political party's logo while preserving the fixed party record (APC, PDP, ADC, OTHERS).
 * Confirms the server database update before cleaning up the stored binary asset.
 */
export async function removePartyLogo(
  actor: UserAccount,
  partyCode: PartyCode
): Promise<PartyConfig> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error('An active authenticated session is required to remove party logos.');
  }
  if (actor.role !== UserRole.FULL_CONTROL_ADMIN) {
    throw new Error('Only Full Control Admin can remove political party logos.');
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error(
      'You are currently offline. Connect to the internet to permanently remove the party logo from cloud storage.'
    );
  }

  const fixedParty = FIXED_PARTY_MAP[partyCode];
  if (!fixedParty) {
    throw new Error('Invalid party selection. Only APC, PDP, ADC, and OTHERS are supported.');
  }

  const partyDocRef = doc(db, 'party_configs', partyCode);

  let previousConfig: PartyConfig | null = null;
  try {
    const prevSnap = await getDocFromServer(partyDocRef);
    if (prevSnap.exists()) {
      previousConfig = prevSnap.data() as PartyConfig;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `party_configs/${partyCode}`);
  }

  const clearedPayload = {
    partyCode,
    partyName: fixedParty.name,
    logoUrl: '',
    storageMode: 'none' as PartyLogoStorageMode,
    storagePath: '',
    logoAssetId: '',
    fileName: '',
    contentType: '',
    fileSizeBytes: 0,
    sha256Hash: '',
    updatedByUid: uid,
    updatedByName: actor.displayName.slice(0, 120),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(partyDocRef, clearedPayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `party_configs/${partyCode}`);
  }

  // Confirm server removal before declaring success
  let confirmedSnap;
  try {
    confirmedSnap = await getDocFromServer(partyDocRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `party_configs/${partyCode}`);
  }

  if (!confirmedSnap.exists()) {
    throw new Error(`Could not confirm logo removal for ${partyCode} on the server.`);
  }

  const confirmedConfig = confirmedSnap.data() as PartyConfig;
  if (confirmedConfig.storageMode !== 'none' || confirmedConfig.logoUrl !== '') {
    throw new Error(`Server did not confirm removal of the ${partyCode} logo.`);
  }

  // Delete the previous persistent binary asset
  await cleanupSupersededLogoAsset(previousConfig);

  try {
    await setDoc(doc(collection(db, 'audit_logs')), {
      actorUid: uid,
      actorName: actor.displayName.slice(0, 120),
      actorEmail: actor.email.slice(0, 200),
      actorRole: actor.role,
      action: 'PARTY_LOGO_REMOVED',
      affectedEntity: 'party_configs',
      affectedId: partyCode,
      details: `Removed official logo for ${partyCode} (${fixedParty.name}); party record preserved with abbreviation fallback.`,
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal audit entry
  }

  return confirmedConfig;
}
