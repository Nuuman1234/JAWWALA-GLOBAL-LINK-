import { deleteApp, initializeApp } from 'firebase/app';
import {
  EmailAuthProvider,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  linkWithCredential,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  verifyPasswordResetCode,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db, firebaseConfig, googleProvider } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  AccountStatus,
  DEFAULT_OFFLINE_SESSION_MAX_DAYS,
  DEFAULT_WHATSAPP_GROUP_NAME,
  DEFAULT_WHATSAPP_GROUP_URL,
  UserRole,
  canManageOperationsOfficers,
  canManageUsers,
  type BootstrapLock,
  type GlobalSettings,
  type LgaId,
  type PendingOfflineRegistration,
  type UserAccount,
  type UserPreferences,
} from '../types/fdmis';
import {
  PBKDF2_ALGORITHM_LABEL,
  computePhoneBlindHash,
  computeUidBlindHash,
  generateRecoveryKey,
  getSyntheticEmailForPhoneDigits,
  hashSecretPBKDF2,
  normalizePhoneNumber,
  normalizeRecoveryKey,
  validateEmailAddress,
  validatePasswordStrength,
  validateRegistrationInputs,
  verifySecretPBKDF2,
} from '../utils/phoneAuth';
import {
  clearCachedSession,
  deletePendingOfflineRegistration,
  getPendingOfflineRegistrations,
  loadCachedSession,
  purgeAllUserSnapshots,
  saveCachedSession,
  savePendingOfflineRegistration,
  unwrapOfflinePassword,
  updatePendingOfflineRegistrationStatus,
  wrapAndStoreOfflinePassword,
} from './offlineQueue';
import {
  clearTrustedDeviceSession,
  establishTrustedDeviceSession,
  verifyTrustedDeviceSession,
} from './trustedDeviceSession';
import { getEffectiveLocationCatalog } from './directoryService';
import {
  buildBundledLocationCatalog,
  isLocationSelectionValidInCatalog,
} from './officialDirectory';

const LS_ACTIVE_RESET_REQ_KEY = 'fdmis_active_reset_req_id';
const LS_PHONE_EMAIL_MAP_KEY = 'fdmis_phone_email_map_v1';
const ephemeralOfflineRegPasswords = new Map<string, string>();

function loadPhoneEmailMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LS_PHONE_EMAIL_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function recordLocalPhoneEmailMapping(
  phoneInput: string | null | undefined,
  emailInput: string | null | undefined
): Promise<void> {
  if (typeof window === 'undefined' || !phoneInput || !emailInput) return;
  const cleanEmail = emailInput.trim().toLowerCase();
  if (!cleanEmail || cleanEmail.endsWith('@fdmis.local')) return;
  const norm = normalizePhoneNumber(phoneInput);
  if (!norm.valid) return;
  try {
    const hash = await computePhoneBlindHash(norm.digits);
    const map = loadPhoneEmailMap();
    map[hash] = cleanEmail;
    window.localStorage.setItem(LS_PHONE_EMAIL_MAP_KEY, JSON.stringify(map));
  } catch {
    // Storage restricted
  }
}

function lookupLocalPhoneEmailMapping(phoneHash: string): string | null {
  const map = loadPhoneEmailMap();
  const hit = map[phoneHash];
  return typeof hit === 'string' && hit.includes('@') ? hit : null;
}

export function cacheEphemeralOfflinePassword(regId: string, password: string): void {
  ephemeralOfflineRegPasswords.set(regId, password);
}

export function getEphemeralOfflinePassword(regId: string): string | undefined {
  return ephemeralOfflineRegPasswords.get(regId);
}

export function clearEphemeralOfflinePassword(regId: string): void {
  ephemeralOfflineRegPasswords.delete(regId);
}

export function hasStoredOfflineRegistrationKey(reg: PendingOfflineRegistration): boolean {
  return Boolean(
    ephemeralOfflineRegPasswords.has(reg.id) ||
      (reg.wrappedPasswordCipher && reg.wrappedPasswordIv)
  );
}

export async function resolvePendingOfflinePassword(
  reg: PendingOfflineRegistration
): Promise<string | null> {
  const mem = ephemeralOfflineRegPasswords.get(reg.id);
  if (mem) return mem;
  return unwrapOfflinePassword(reg);
}

export interface ProfileCheckResult {
  account: UserAccount | null;
  needsBootstrap: boolean;
  needsRegistration: boolean;
  offlineRestored?: boolean;
}

export interface RegistrationLocationSelection {
  lgaId: LgaId;
  lgaName: string;
  wardId: string;
  wardName: string;
  puId: string;
  puCode: string;
  puName: string;
}

export interface PhoneRegistrationResult {
  queuedOffline: boolean;
  account?: UserAccount;
  offlineRegistration?: PendingOfflineRegistration;
  recoveryKey: string;
}

function isOfflineOrNetworkError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('client is offline') ||
    msg.includes('offline') ||
    msg.includes('unavailable') ||
    msg.includes('network-request-failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('timeout') ||
    msg.includes('failed to get document')
  );
}

function isVerifiedGoogleAccount(fbUser: FirebaseUser | null): boolean {
  if (!fbUser) return false;
  const hasGoogle = fbUser.providerData.some((p) => p.providerId === 'google.com');
  return (hasGoogle || !fbUser.email?.endsWith('@fdmis.local')) && Boolean(fbUser.emailVerified);
}

function mapFirebaseAuthError(error: unknown, fallback: string): Error {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  if (code === 'auth/email-already-in-use') {
    return new Error(
      'This email address or phone number is already registered in FDMIS. Sign in directly or use Forgot Password to recover access.'
    );
  }
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  ) {
    return new Error('Invalid email/phone number or password.');
  }
  if (code === 'auth/invalid-email') {
    return new Error('Enter a valid email address.');
  }
  if (code === 'auth/too-many-requests') {
    return new Error(
      'Too many sign-in attempts. Wait a few minutes before retrying or use Forgot Password.'
    );
  }
  if (code === 'auth/weak-password') {
    return new Error('Password is too weak. Use at least 8 characters with letters and numbers.');
  }
  if (code === 'auth/network-request-failed') {
    return new Error('Network connection required to verify credentials with the server.');
  }
  if (error instanceof Error) return error;
  return new Error(fallback);
}

export async function signInWithGoogle(): Promise<FirebaseUser> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

function clearLocalSessionTokens(): void {
  ephemeralOfflineRegPasswords.clear();
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (
        key &&
        (key.startsWith('firebase:') ||
          key.startsWith('fdmis_session') ||
          key.startsWith('fdmis_auth'))
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => window.localStorage.removeItem(k));
    window.sessionStorage.clear();
  } catch {
    // Storage access may be restricted in hardened browser modes
  }

  try {
    window.history.replaceState({ loggedOut: true, ts: Date.now() }, '', '/');
  } catch {
    // Ignore history API restrictions
  }
}

export async function signOutSession(actor?: UserAccount | null, reason = 'USER_SIGN_OUT'): Promise<void> {
  if (actor && auth.currentUser && navigator.onLine) {
    try {
      const logRef = doc(collection(db, 'audit_logs'));
      await setDoc(logRef, {
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: reason,
        affectedEntity: 'auth_session',
        affectedId: actor.uid,
        details:
          reason === 'INACTIVITY_AUTO_LOGOUT'
            ? 'Session locked and signed out automatically due to inactivity timeout.'
            : 'User signed out of FDMIS Situation Room.',
        createdAt: serverTimestamp(),
      });
    } catch {
      // Best-effort audit log before sign out
    }
  }
  try {
    await signOut(auth);
  } catch {
    // Allow local credential wipe even when offline
  }
  await clearTrustedDeviceSession();
  clearCachedSession(actor?.uid);
  clearCachedSession();
  await purgeAllUserSnapshots(actor?.uid);
  clearLocalSessionTokens();
}

export async function checkUserAndBootstrapState(
  firebaseUser: FirebaseUser,
  options?: { maxOfflineDays?: number; forceServer?: boolean }
): Promise<ProfileCheckResult> {
  const userPath = `users/${firebaseUser.uid}`;
  const userRef = doc(db, 'users', firebaseUser.uid);
  const providerIds = firebaseUser.providerData.map((p) => p.providerId);
  const maxOfflineDays = options?.maxOfflineDays ?? DEFAULT_OFFLINE_SESSION_MAX_DAYS;

  // When offline, immediately verify the cryptographically sealed trusted-device session
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const trusted = await verifyTrustedDeviceSession(firebaseUser.uid);
    if (trusted.valid) {
      return {
        account: trusted.payload.account,
        needsBootstrap: false,
        needsRegistration: false,
        offlineRestored: true,
      };
    }
    throw new Error(
      trusted.reason === 'EXPIRED'
        ? 'Your offline trusted session has expired. Connect to the internet to sign in and re-verify your account.'
        : 'Internet connection required for first-time server authentication on this device.'
    );
  }

  let userSnap;
  try {
    userSnap = options?.forceServer ? await getDocFromServer(userRef) : await getDoc(userRef);
  } catch (error) {
    if (isOfflineOrNetworkError(error)) {
      const trusted = await verifyTrustedDeviceSession(firebaseUser.uid);
      if (trusted.valid) {
        return {
          account: trusted.payload.account,
          needsBootstrap: false,
          needsRegistration: false,
          offlineRestored: true,
        };
      }
    }
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (userSnap.exists()) {
    const account = userSnap.data() as UserAccount;
    const fromCacheOnly = userSnap.metadata?.fromCache === true;
    if (account.status === AccountStatus.ACTIVE && !account.sessionRevoked) {
      saveCachedSession(account);
      void recordLocalPhoneEmailMapping(account.phone, account.email);

      if (!fromCacheOnly && (typeof navigator === 'undefined' || navigator.onLine)) {
        // Seal trusted device session ONLY after genuine online server verification
        await establishTrustedDeviceSession(account, {
          providerIds,
          maxOfflineDays,
        });

        try {
          await updateDoc(userRef, {
            lastLoginAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Non-blocking login timestamp refresh
        }

        try {
          const auditRef = doc(collection(db, 'audit_logs'));
          await setDoc(auditRef, {
            actorUid: account.uid,
            actorName: account.displayName,
            actorEmail: account.email,
            actorRole: account.role,
            action: 'USER_LOGIN',
            affectedEntity: 'users',
            affectedId: account.uid,
            details: `Authenticated into FDMIS Situation Room (${account.role}).`,
            createdAt: serverTimestamp(),
          });
        } catch {
          // Non-blocking audit log on login
        }
      }
    } else if (account.status === AccountStatus.SUSPENDED || account.sessionRevoked) {
      await clearTrustedDeviceSession(account.uid);
      clearCachedSession(account.uid);
    }
    return {
      account,
      needsBootstrap: false,
      needsRegistration: false,
      offlineRestored: fromCacheOnly,
    };
  }

  const bootstrapRef = doc(db, 'system_settings', 'bootstrap');
  let bootstrapExists = true;
  try {
    const bootstrapSnap = await getDoc(bootstrapRef);
    bootstrapExists = bootstrapSnap.exists();
  } catch (error) {
    if (isOfflineOrNetworkError(error)) {
      const trusted = await verifyTrustedDeviceSession(firebaseUser.uid);
      if (trusted.valid) {
        return {
          account: trusted.payload.account,
          needsBootstrap: false,
          needsRegistration: false,
          offlineRestored: true,
        };
      }
    }
    handleFirestoreError(error, OperationType.GET, 'system_settings/bootstrap');
  }

  if (!bootstrapExists && isVerifiedGoogleAccount(firebaseUser)) {
    return {
      account: null,
      needsBootstrap: true,
      needsRegistration: false,
    };
  }

  return {
    account: null,
    needsBootstrap: false,
    needsRegistration: true,
  };
}

export type ServerRevalidationResult =
  | { status: 'VERIFIED'; account: UserAccount; verifiedAtMs: number }
  | { status: 'REVOKED'; account: UserAccount | null; reason: string }
  | { status: 'REAUTH_REQUIRED'; reason: string }
  | { status: 'OFFLINE' };

/**
 * Revalidates a locally restored trusted session against the live FDMIS server when connectivity returns.
 * Refreshes Firebase Auth tokens, checks server-side account suspension/revocation, and updates cached permissions.
 */
export async function revalidateTrustedSessionWithServer(
  uid: string,
  maxOfflineDays = DEFAULT_OFFLINE_SESSION_MAX_DAYS
): Promise<ServerRevalidationResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { status: 'OFFLINE' };
  }

  const fbUser = auth.currentUser;
  if (!fbUser || fbUser.uid !== uid) {
    return {
      status: 'REAUTH_REQUIRED',
      reason: 'Internet connectivity returned. Please sign in online to refresh your server session.',
    };
  }

  try {
    await fbUser.getIdToken(true);
  } catch (err) {
    if (isOfflineOrNetworkError(err)) {
      return { status: 'OFFLINE' };
    }
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code || '')
        : '';
    if (
      code === 'auth/user-disabled' ||
      code === 'auth/user-token-expired' ||
      code === 'auth/invalid-user-token'
    ) {
      await clearTrustedDeviceSession(uid);
      clearCachedSession(uid);
      return {
        status: 'REVOKED',
        account: null,
        reason: 'Your authentication session was revoked or disabled on the server. Please sign in again or contact an administrator.',
      };
    }
  }

  try {
    const snap = await getDocFromServer(doc(db, 'users', uid));
    if (!snap.exists()) {
      await clearTrustedDeviceSession(uid);
      clearCachedSession(uid);
      return {
        status: 'REVOKED',
        account: null,
        reason: 'Your operator profile is no longer active on the FDMIS server.',
      };
    }

    const freshAccount = snap.data() as UserAccount;
    if (
      freshAccount.status !== AccountStatus.ACTIVE ||
      freshAccount.sessionRevoked ||
      freshAccount.role === UserRole.PENDING
    ) {
      await clearTrustedDeviceSession(uid);
      clearCachedSession(uid);
      await purgeAllUserSnapshots(uid);
      const reason =
        freshAccount.revokedReason ||
        (freshAccount.status === AccountStatus.SUSPENDED
          ? 'Your account has been suspended by an administrator.'
          : 'Your session was revoked by an administrator.');
      return {
        status: 'REVOKED',
        account: freshAccount,
        reason,
      };
    }

    const nowMs = Date.now();
    saveCachedSession(freshAccount);
    await establishTrustedDeviceSession(freshAccount, {
      providerIds: fbUser.providerData.map((p) => p.providerId),
      maxOfflineDays,
      nowMs,
    });
    return {
      status: 'VERIFIED',
      account: freshAccount,
      verifiedAtMs: nowMs,
    };
  } catch (error) {
    if (isOfflineOrNetworkError(error)) {
      return { status: 'OFFLINE' };
    }
    return {
      status: 'REAUTH_REQUIRED',
      reason: 'Unable to re-verify your server session. Please sign in online.',
    };
  }
}

export async function initializeFullControlAdmin(
  displayName: string,
  phone: string
): Promise<UserAccount> {
  const user = auth.currentUser;
  if (!user || !isVerifiedGoogleAccount(user)) {
    throw new Error('Verified Google account required for initial administrator setup.');
  }

  const cleanName = displayName.trim().slice(0, 110);
  if (cleanName.length < 2) {
    throw new Error('Full operational name must be at least 2 characters.');
  }

  const cleanPhone = phone.trim().slice(0, 25);
  const bootstrapRef = doc(db, 'system_settings', 'bootstrap');
  const adminRef = doc(db, 'admins', user.uid);
  const userRef = doc(db, 'users', user.uid);
  const settingsRef = doc(db, 'system_settings', 'global');
  const auditRef = doc(collection(db, 'audit_logs'));

  const batch = writeBatch(db);

  const bootstrapPayload: BootstrapLock = {
    initializedByUid: user.uid,
    initializedByEmail: user.email || '',
    cycleYear: 2027,
    constituencyName: 'Funtua-Dandume Federal Constituency',
  };

  batch.set(bootstrapRef, {
    ...bootstrapPayload,
    createdAt: serverTimestamp(),
  });

  batch.set(adminRef, {
    uid: user.uid,
    email: user.email || '',
    grantedByUid: user.uid,
    createdAt: serverTimestamp(),
  });

  const userPayload: Record<string, unknown> = {
    uid: user.uid,
    email: user.email || '',
    displayName: cleanName,
    authMethod: 'GOOGLE',
    role: UserRole.FULL_CONTROL_ADMIN,
    status: AccountStatus.ACTIVE,
    assignedLgaId: '',
    assignedWardId: '',
    assignedPollingUnitId: '',
    sessionRevoked: false,
    lastLoginAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (cleanPhone.length > 0) {
    userPayload.phone = cleanPhone;
  }
  batch.set(userRef, userPayload);

  batch.set(settingsRef, {
    inactivityTimeoutMinutes: 30,
    mfaPrepared: true,
    publicSummaryEnabled: false,
    smsFallbackConfigured: false,
    whatsappConfigured: false,
    emailConfigured: false,
    whatsappGroupName: DEFAULT_WHATSAPP_GROUP_NAME,
    whatsappGroupUrl: DEFAULT_WHATSAPP_GROUP_URL,
    whatsappGroupEnabled: true,
    updatedByUid: user.uid,
    updatedAt: serverTimestamp(),
  });

  batch.set(auditRef, {
    actorUid: user.uid,
    actorName: cleanName,
    actorEmail: user.email || '',
    actorRole: UserRole.FULL_CONTROL_ADMIN,
    action: 'INITIAL_ADMIN_BOOTSTRAP',
    affectedEntity: 'system_settings',
    affectedId: 'bootstrap',
    details: 'Initialized 2027 Situation Room Full Control Admin account and locked bootstrap.',
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'system_settings/bootstrap');
  }

  try {
    const createdSnap = await getDoc(userRef);
    if (!createdSnap.exists()) {
      throw new Error('Full Control Admin initialized, but profile could not be read.');
    }
    const createdAccount = createdSnap.data() as UserAccount;
    saveCachedSession(createdAccount);
    return createdAccount;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
  }
}

export async function registerPendingAccount(
  displayName: string,
  phone: string,
  location?: RegistrationLocationSelection | null
): Promise<UserAccount> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authenticated account required.');

  const cleanName = displayName.trim().slice(0, 110);
  if (cleanName.length < 2) {
    throw new Error('Full operational name must be at least 2 characters.');
  }

  let formattedPhone = phone.trim().slice(0, 25);
  if (formattedPhone) {
    const norm = normalizePhoneNumber(formattedPhone);
    if (!norm.valid) {
      throw new Error(norm.error || 'Enter a valid phone number.');
    }
    formattedPhone = norm.e164;
  }

  const hasValidLocation = Boolean(
    location && location.lgaId && location.wardId && location.puId
  );
  const isPhoneUser = user.email?.endsWith('@fdmis.local') ?? false;
  const userRef = doc(db, 'users', user.uid);
  const payload: Record<string, unknown> = {
    uid: user.uid,
    email: user.email || '',
    displayName: cleanName,
    authMethod: isPhoneUser ? 'PHONE_PASSWORD' : 'GOOGLE',
    role: hasValidLocation ? UserRole.ORDINARY_USER : UserRole.PENDING,
    status: hasValidLocation ? AccountStatus.ACTIVE : AccountStatus.PENDING_APPROVAL,
    assignedLgaId: hasValidLocation && location ? location.lgaId : '',
    assignedWardId: hasValidLocation && location ? location.wardId : '',
    assignedPollingUnitId: hasValidLocation && location ? location.puId : '',
    requestedLgaId: location?.lgaId || '',
    requestedWardId: location?.wardId || '',
    requestedWardName: location?.wardName || '',
    requestedPollingUnitId: location?.puId || '',
    requestedPollingUnitCode: location?.puCode || '',
    requestedPollingUnitName: location?.puName || '',
    sessionRevoked: false,
    lastLoginAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (formattedPhone.length > 0) {
    payload.phone = formattedPhone;
  }

  try {
    await setDoc(userRef, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}`);
  }

  try {
    const snap = await getDoc(userRef);
    const createdAccount = snap.data() as UserAccount;
    if (createdAccount.status === AccountStatus.ACTIVE && !createdAccount.sessionRevoked) {
      saveCachedSession(createdAccount);
      void recordLocalPhoneEmailMapping(createdAccount.phone, createdAccount.email);
    }
    return createdAccount;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
  }
}

// ---------- EMAIL + PHONE + PASSWORD REGISTRATION, SIGN-IN & OFFLINE SYNC ----------

async function commitPhoneAccountDocuments(params: {
  firebaseUser: FirebaseUser;
  displayName: string;
  email: string;
  phoneE164: string;
  phoneHash: string;
  authMethod: 'EMAIL_PASSWORD' | 'PHONE_PASSWORD';
  passwordSalt: string;
  passwordHash: string;
  recoveryKeySalt: string;
  recoveryKeyHash: string;
  location: RegistrationLocationSelection;
  auditAction: string;
  auditDetails: string;
}): Promise<UserAccount> {
  const { firebaseUser } = params;
  const ownerUidHash = await computeUidBlindHash(firebaseUser.uid);

  const userRef = doc(db, 'users', firebaseUser.uid);
  const credRef = doc(db, 'user_credentials', firebaseUser.uid);
  const phoneIndexRef = doc(db, 'phone_index', params.phoneHash);
  const auditRef = doc(collection(db, 'audit_logs'));

  const batch = writeBatch(db);
  batch.set(userRef, {
    uid: firebaseUser.uid,
    email: params.email || firebaseUser.email || '',
    displayName: params.displayName.trim().slice(0, 110),
    phone: params.phoneE164,
    authMethod: params.authMethod,
    role: UserRole.ORDINARY_USER,
    status: AccountStatus.ACTIVE,
    assignedLgaId: params.location.lgaId.slice(0, 32),
    assignedWardId: params.location.wardId.slice(0, 128),
    assignedPollingUnitId: params.location.puId.slice(0, 128),
    requestedLgaId: params.location.lgaId.slice(0, 32),
    requestedWardId: params.location.wardId.slice(0, 128),
    requestedWardName: params.location.wardName.slice(0, 120),
    requestedPollingUnitId: params.location.puId.slice(0, 128),
    requestedPollingUnitCode: params.location.puCode.slice(0, 40),
    requestedPollingUnitName: params.location.puName.slice(0, 160),
    sessionRevoked: false,
    lastLoginAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(credRef, {
    uid: firebaseUser.uid,
    phoneHash: params.phoneHash,
    passwordSalt: params.passwordSalt,
    passwordHash: params.passwordHash,
    passwordAlgorithm: PBKDF2_ALGORITHM_LABEL,
    recoveryKeySalt: params.recoveryKeySalt,
    recoveryKeyHash: params.recoveryKeyHash,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(phoneIndexRef, {
    phoneHash: params.phoneHash,
    ownerUidHash,
    accountType: params.authMethod,
    authSeq: 0,
    pendingNextAuthSeq: 0,
    resetPinSalt: '',
    resetPinHash: '',
    recoveryKeySalt: params.recoveryKeySalt,
    recoveryKeyHash: params.recoveryKeyHash,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(auditRef, {
    actorUid: firebaseUser.uid,
    actorName: params.displayName.trim().slice(0, 110),
    actorEmail: params.email || params.phoneE164,
    actorRole: UserRole.ORDINARY_USER,
    action: params.auditAction,
    affectedEntity: 'users',
    affectedId: firebaseUser.uid,
    details: params.auditDetails,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    try {
      await deleteUser(firebaseUser);
    } catch {
      // Ignore cleanup failure if network dropped mid-flight
    }
    throw err;
  }

  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    throw new Error('Account registered, but profile confirmation could not be loaded.');
  }
  const account = snap.data() as UserAccount;
  saveCachedSession(account);
  await recordLocalPhoneEmailMapping(params.phoneE164, params.email);
  return account;
}

async function queueOfflineRegistrationRecord(params: {
  cleanName: string;
  email?: string;
  phoneE164: string;
  phoneDigits: string;
  phoneHash: string;
  password: string;
  passwordSalt: string;
  passwordHash: string;
  recoveryKeySalt: string;
  recoveryKeyHash: string;
  location: RegistrationLocationSelection;
}): Promise<PendingOfflineRegistration> {
  const now = new Date().toISOString();
  const regId = `offreg_${params.phoneHash.slice(0, 16)}_${Date.now()}`;
  const wrapped = await wrapAndStoreOfflinePassword(regId, params.password);

  const offlineRecord: PendingOfflineRegistration = {
    id: regId,
    displayName: params.cleanName,
    ...(params.email ? { email: params.email } : {}),
    phoneE164: params.phoneE164,
    phoneDigits: params.phoneDigits,
    phoneHash: params.phoneHash,
    passwordSalt: params.passwordSalt,
    passwordHash: params.passwordHash,
    recoveryKeySalt: params.recoveryKeySalt,
    recoveryKeyHash: params.recoveryKeyHash,
    ...(wrapped
      ? {
          wrappedPasswordCipher: wrapped.cipherHex,
          wrappedPasswordIv: wrapped.ivHex,
        }
      : {}),
    requestedLgaId: params.location.lgaId,
    requestedLgaName: params.location.lgaName,
    requestedWardId: params.location.wardId,
    requestedWardName: params.location.wardName,
    requestedPollingUnitId: params.location.puId,
    requestedPollingUnitCode: params.location.puCode,
    requestedPollingUnitName: params.location.puName,
    status: 'QUEUED_OFFLINE',
    createdAtIso: now,
    updatedAtIso: now,
  };

  await savePendingOfflineRegistration(offlineRecord);
  cacheEphemeralOfflinePassword(regId, params.password);
  if (params.email) {
    await recordLocalPhoneEmailMapping(params.phoneE164, params.email);
  }
  return offlineRecord;
}

export async function registerWithEmailAndPhone(input: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  location: RegistrationLocationSelection;
}): Promise<PhoneRegistrationResult> {
  const validationError = validateRegistrationInputs({
    fullName: input.fullName,
    email: input.email,
    requireEmail: true,
    phone: input.phone,
    password: input.password,
    confirmPassword: input.confirmPassword,
    lgaId: input.location.lgaId,
    wardId: input.location.wardId,
    pollingUnitId: input.location.puId,
  });
  if (validationError) {
    throw new Error(validationError);
  }

  const emailCheck = validateEmailAddress(input.email);
  if (!emailCheck.valid) {
    throw new Error(emailCheck.error || 'Enter a valid email address.');
  }

  // Strictly validate LGA -> Ward -> Polling Unit against the official/synced directory
  const effectiveCatalog = await getEffectiveLocationCatalog();
  const locationValid =
    isLocationSelectionValidInCatalog(effectiveCatalog, input.location) ||
    isLocationSelectionValidInCatalog(buildBundledLocationCatalog(), input.location);
  if (!locationValid) {
    throw new Error(
      'Selected LGA, Ward, or Polling Unit could not be verified in the official directory. Reselect from the dropdown lists.'
    );
  }

  const normalized = normalizePhoneNumber(input.phone);
  if (!normalized.valid) {
    throw new Error(normalized.error || 'Enter a valid phone number.');
  }

  const cleanName = input.fullName.trim().slice(0, 110);
  const phoneHash = await computePhoneBlindHash(normalized.digits);

  // Prevent duplicate pending registrations on this device for the same phone number or email
  const existingQueue = await getPendingOfflineRegistrations();
  const duplicatePending = existingQueue.find(
    (r) =>
      (r.phoneHash === phoneHash ||
        (r.email && r.email.toLowerCase() === emailCheck.normalized)) &&
      (r.status === 'QUEUED_OFFLINE' || r.status === 'SYNC_FAILED')
  );
  if (duplicatePending) {
    throw new Error(
      'A registration for this email or phone number is already saved offline on this device (PENDING SYNCHRONIZATION).'
    );
  }

  const passwordHashed = await hashSecretPBKDF2(input.password);
  const recoveryKey = generateRecoveryKey();
  const recoveryHashed = await hashSecretPBKDF2(normalizeRecoveryKey(recoveryKey));

  const onlineNow = typeof navigator === 'undefined' ? true : navigator.onLine;
  if (!onlineNow) {
    const offlineRecord = await queueOfflineRegistrationRecord({
      cleanName,
      email: emailCheck.normalized,
      phoneE164: normalized.e164,
      phoneDigits: normalized.digits,
      phoneHash,
      password: input.password,
      passwordSalt: passwordHashed.saltHex,
      passwordHash: passwordHashed.hashHex,
      recoveryKeySalt: recoveryHashed.saltHex,
      recoveryKeyHash: recoveryHashed.hashHex,
      location: input.location,
    });
    return {
      queuedOffline: true,
      offlineRegistration: offlineRecord,
      recoveryKey,
    };
  }

  try {
    const existingIdx = await getDoc(doc(db, 'phone_index', phoneHash));
    if (existingIdx.exists()) {
      throw new Error(
        'This phone number is already registered in FDMIS. Sign in with your email/phone and password, or use Forgot Password to recover access.'
      );
    }

    const cred = await createUserWithEmailAndPassword(auth, emailCheck.normalized, input.password);
    void sendEmailVerification(cred.user).catch(() => {
      // Non-blocking verification email dispatch
    });
    const account = await commitPhoneAccountDocuments({
      firebaseUser: cred.user,
      displayName: cleanName,
      email: emailCheck.normalized,
      phoneE164: normalized.e164,
      phoneHash,
      authMethod: 'EMAIL_PASSWORD',
      passwordSalt: passwordHashed.saltHex,
      passwordHash: passwordHashed.hashHex,
      recoveryKeySalt: recoveryHashed.saltHex,
      recoveryKeyHash: recoveryHashed.hashHex,
      location: input.location,
      auditAction: 'EMAIL_PHONE_ACCOUNT_REGISTERED',
      auditDetails: `Auto-approved standard account for ${cleanName} (${emailCheck.normalized}, ${normalized.maskedPhone}) scoped to ${input.location.lgaId.toUpperCase()} / ${input.location.wardName} / ${input.location.puCode}.`,
    });

    return {
      queuedOffline: false,
      account,
      recoveryKey,
    };
  } catch (error) {
    if (isOfflineOrNetworkError(error)) {
      const offlineRecord = await queueOfflineRegistrationRecord({
        cleanName,
        email: emailCheck.normalized,
        phoneE164: normalized.e164,
        phoneDigits: normalized.digits,
        phoneHash,
        password: input.password,
        passwordSalt: passwordHashed.saltHex,
        passwordHash: passwordHashed.hashHex,
        recoveryKeySalt: recoveryHashed.saltHex,
        recoveryKeyHash: recoveryHashed.hashHex,
        location: input.location,
      });
      return {
        queuedOffline: true,
        offlineRegistration: offlineRecord,
        recoveryKey,
      };
    }
    throw mapFirebaseAuthError(error, 'Unable to create FDMIS operator account.');
  }
}

export async function registerWithPhoneAndPassword(input: {
  fullName: string;
  email?: string;
  phone: string;
  password: string;
  confirmPassword: string;
  location: RegistrationLocationSelection;
}): Promise<PhoneRegistrationResult> {
  if (input.email && input.email.trim().length > 0) {
    return registerWithEmailAndPhone({
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      password: input.password,
      confirmPassword: input.confirmPassword,
      location: input.location,
    });
  }
  const validationError = validateRegistrationInputs({
    fullName: input.fullName,
    requireEmail: false,
    phone: input.phone,
    password: input.password,
    confirmPassword: input.confirmPassword,
    lgaId: input.location.lgaId,
    wardId: input.location.wardId,
    pollingUnitId: input.location.puId,
  });
  if (validationError) {
    throw new Error(validationError);
  }

  // Strictly validate LGA -> Ward -> Polling Unit against the official/synced directory
  const effectiveCatalog = await getEffectiveLocationCatalog();
  const locationValid =
    isLocationSelectionValidInCatalog(effectiveCatalog, input.location) ||
    isLocationSelectionValidInCatalog(buildBundledLocationCatalog(), input.location);
  if (!locationValid) {
    throw new Error(
      'Selected LGA, Ward, or Polling Unit could not be verified in the official directory. Reselect from the dropdown lists.'
    );
  }

  const normalized = normalizePhoneNumber(input.phone);
  if (!normalized.valid) {
    throw new Error(normalized.error || 'Enter a valid phone number.');
  }

  const cleanName = input.fullName.trim().slice(0, 110);
  const phoneHash = await computePhoneBlindHash(normalized.digits);

  // Prevent duplicate pending registrations on this device for the same phone number
  const existingQueue = await getPendingOfflineRegistrations();
  const duplicatePending = existingQueue.find(
    (r) =>
      r.phoneHash === phoneHash &&
      (r.status === 'QUEUED_OFFLINE' || r.status === 'SYNC_FAILED')
  );
  if (duplicatePending) {
    throw new Error(
      'A registration for this phone number is already saved offline on this device (PENDING SYNCHRONIZATION).'
    );
  }

  const passwordHashed = await hashSecretPBKDF2(input.password);
  const recoveryKey = generateRecoveryKey();
  const recoveryHashed = await hashSecretPBKDF2(normalizeRecoveryKey(recoveryKey));

  const onlineNow = typeof navigator === 'undefined' ? true : navigator.onLine;
  if (!onlineNow) {
    const offlineRecord = await queueOfflineRegistrationRecord({
      cleanName,
      phoneE164: normalized.e164,
      phoneDigits: normalized.digits,
      phoneHash,
      password: input.password,
      passwordSalt: passwordHashed.saltHex,
      passwordHash: passwordHashed.hashHex,
      recoveryKeySalt: recoveryHashed.saltHex,
      recoveryKeyHash: recoveryHashed.hashHex,
      location: input.location,
    });
    return {
      queuedOffline: true,
      offlineRegistration: offlineRecord,
      recoveryKey,
    };
  }

  try {
    const existingIdx = await getDoc(doc(db, 'phone_index', phoneHash));
    if (existingIdx.exists()) {
      throw new Error(
        'This phone number is already registered in FDMIS. Sign in with your phone number and password, or use Forgot Password to recover access.'
      );
    }

    const syntheticEmail = getSyntheticEmailForPhoneDigits(normalized.digits, 0);
    const cred = await createUserWithEmailAndPassword(auth, syntheticEmail, input.password);
    const account = await commitPhoneAccountDocuments({
      firebaseUser: cred.user,
      displayName: cleanName,
      email: syntheticEmail,
      phoneE164: normalized.e164,
      phoneHash,
      authMethod: 'PHONE_PASSWORD',
      passwordSalt: passwordHashed.saltHex,
      passwordHash: passwordHashed.hashHex,
      recoveryKeySalt: recoveryHashed.saltHex,
      recoveryKeyHash: recoveryHashed.hashHex,
      location: input.location,
      auditAction: 'PHONE_ACCOUNT_REGISTERED',
      auditDetails: `Auto-approved standard account for ${cleanName} (${normalized.maskedPhone}) scoped to ${input.location.lgaId.toUpperCase()} / ${input.location.wardName} / ${input.location.puCode}.`,
    });

    return {
      queuedOffline: false,
      account,
      recoveryKey,
    };
  } catch (error) {
    if (isOfflineOrNetworkError(error)) {
      const offlineRecord = await queueOfflineRegistrationRecord({
        cleanName,
        phoneE164: normalized.e164,
        phoneDigits: normalized.digits,
        phoneHash,
        password: input.password,
        passwordSalt: passwordHashed.saltHex,
        passwordHash: passwordHashed.hashHex,
        recoveryKeySalt: recoveryHashed.saltHex,
        recoveryKeyHash: recoveryHashed.hashHex,
        location: input.location,
      });
      return {
        queuedOffline: true,
        offlineRegistration: offlineRecord,
        recoveryKey,
      };
    }
    throw mapFirebaseAuthError(error, 'Unable to create FDMIS operator account.');
  }
}

export async function syncPendingOfflineRegistration(
  reg: PendingOfflineRegistration,
  rawPassword: string
): Promise<UserAccount> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Internet connection required to synchronize pending registration.');
  }

  const passwordValid = await verifySecretPBKDF2(
    rawPassword,
    reg.passwordSalt,
    reg.passwordHash
  );
  if (!passwordValid) {
    throw new Error('Entered password does not match the offline registration credentials.');
  }

  try {
    const existingIdx = await getDoc(doc(db, 'phone_index', reg.phoneHash));
    if (existingIdx.exists()) {
      await updatePendingOfflineRegistrationStatus(
        reg.id,
        'SYNC_FAILED',
        'Phone number is already registered on server.'
      );
      clearEphemeralOfflinePassword(reg.id);
      throw new Error(
        `Phone ${reg.phoneE164} is already registered on the server. Sign in directly or remove this queued request.`
      );
    }

    const hasPersonalEmail = Boolean(reg.email && !reg.email.endsWith('@fdmis.local'));
    const authEmail = hasPersonalEmail
      ? reg.email!.trim().toLowerCase()
      : getSyntheticEmailForPhoneDigits(reg.phoneDigits, 0);
    const cred = await createUserWithEmailAndPassword(auth, authEmail, rawPassword);
    if (hasPersonalEmail) {
      void sendEmailVerification(cred.user).catch(() => {
        // Non-blocking verification email
      });
    }
    const account = await commitPhoneAccountDocuments({
      firebaseUser: cred.user,
      displayName: reg.displayName,
      email: authEmail,
      phoneE164: reg.phoneE164,
      phoneHash: reg.phoneHash,
      authMethod: hasPersonalEmail ? 'EMAIL_PASSWORD' : 'PHONE_PASSWORD',
      passwordSalt: reg.passwordSalt,
      passwordHash: reg.passwordHash,
      recoveryKeySalt: reg.recoveryKeySalt,
      recoveryKeyHash: reg.recoveryKeyHash,
      location: {
        lgaId: reg.requestedLgaId,
        lgaName: reg.requestedLgaName,
        wardId: reg.requestedWardId,
        wardName: reg.requestedWardName,
        puId: reg.requestedPollingUnitId,
        puCode: reg.requestedPollingUnitCode,
        puName: reg.requestedPollingUnitName,
      },
      auditAction: 'OFFLINE_ACCOUNT_SYNCED',
      auditDetails: `Synchronized offline registration (created ${reg.createdAtIso}) for ${reg.displayName} (${reg.phoneE164}) and auto-approved to ${reg.requestedLgaId.toUpperCase()} / ${reg.requestedWardName} / ${reg.requestedPollingUnitCode}.`,
    });

    await deletePendingOfflineRegistration(reg.id);
    clearEphemeralOfflinePassword(reg.id);
    return account;
  } catch (error) {
    const mapped = mapFirebaseAuthError(error, 'Failed to sync queued registration.');
    const nextStatus = isOfflineOrNetworkError(error) ? 'QUEUED_OFFLINE' : 'SYNC_FAILED';
    await updatePendingOfflineRegistrationStatus(reg.id, nextStatus, mapped.message);
    throw mapped;
  }
}

export async function signInWithIdentifierAndPassword(
  identifier: string,
  password: string
): Promise<FirebaseUser> {
  const trimmed = identifier.trim();
  if (!trimmed) {
    throw new Error('Email address or phone number is required.');
  }
  if (!password) {
    throw new Error('Password is required.');
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error(
      'Internet connection is unavailable. New sign-ins require connectivity; previously signed-in sessions remain accessible offline.'
    );
  }

  if (trimmed.includes('@')) {
    const emailCheck = validateEmailAddress(trimmed);
    if (!emailCheck.valid) {
      throw new Error(emailCheck.error || 'Enter a valid email address.');
    }
    try {
      const cred = await signInWithEmailAndPassword(auth, emailCheck.normalized, password);
      return cred.user;
    } catch (error) {
      throw mapFirebaseAuthError(error, 'Invalid email address or password.');
    }
  }

  return signInWithPhoneAndPassword(trimmed, password);
}

export async function signInWithPhoneAndPassword(
  phone: string,
  password: string
): Promise<FirebaseUser> {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized.valid) {
    throw new Error(normalized.error || 'Enter a valid phone number.');
  }
  if (!password) {
    throw new Error('Password is required.');
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error(
      'Internet connection is unavailable. New sign-ins require connectivity; previously signed-in sessions remain accessible offline.'
    );
  }

  const phoneHash = await computePhoneBlindHash(normalized.digits);

  // Check device-local verified email mapping first for EMAIL_PASSWORD users
  const mappedLocalEmail = lookupLocalPhoneEmailMapping(phoneHash);
  if (mappedLocalEmail) {
    try {
      const cred = await signInWithEmailAndPassword(auth, mappedLocalEmail, password);
      return cred.user;
    } catch (error) {
      throw mapFirebaseAuthError(error, 'Invalid phone number or password.');
    }
  }

  let authSeq = 0;
  try {
    const idxSnap = await getDoc(doc(db, 'phone_index', phoneHash));
    if (!idxSnap.exists()) {
      throw new Error(
        'No operator account was found for this phone number. Check the number or sign in with your email address.'
      );
    }
    const idxData = idxSnap.data() as {
      authSeq?: number;
      accountType?: 'EMAIL_PASSWORD' | 'PHONE_PASSWORD';
    };
    if (idxData.accountType === 'EMAIL_PASSWORD') {
      throw new Error(
        'This account is registered with a personal email address. Sign in using your Email Address + Password (phone sign-in resumes automatically on this device afterward).'
      );
    }
    if (typeof idxData.authSeq === 'number' && idxData.authSeq > 0) {
      authSeq = idxData.authSeq;
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('No operator account') ||
        error.message.includes('registered with a personal email'))
    ) {
      throw error;
    }
    if (isOfflineOrNetworkError(error)) {
      throw new Error('Network connection required to verify credentials.');
    }
  }

  const syntheticEmail = getSyntheticEmailForPhoneDigits(normalized.digits, authSeq);
  try {
    const cred = await signInWithEmailAndPassword(auth, syntheticEmail, password);
    return cred.user;
  } catch (error) {
    throw mapFirebaseAuthError(error, 'Invalid phone number or password.');
  }
}

export const NEUTRAL_PASSWORD_RESET_MESSAGE =
  'If an FDMIS account is registered with that email address, a secure single-use password reset link has been sent. Please check your inbox and spam folder. Reset links expire automatically for your security.';

export async function sendEmailPasswordReset(emailInput: string): Promise<string> {
  const emailCheck = validateEmailAddress(emailInput);
  if (!emailCheck.valid) {
    throw new Error(emailCheck.error || 'Enter a valid registered email address.');
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Internet connection required to request a password reset link.');
  }
  const actionUrl =
    typeof window !== 'undefined' && /^https?:\/\//.test(window.location.origin)
      ? window.location.origin
      : undefined;

  try {
    await sendPasswordResetEmail(
      auth,
      emailCheck.normalized,
      actionUrl ? { url: actionUrl, handleCodeInApp: false } : undefined
    );
    return NEUTRAL_PASSWORD_RESET_MESSAGE;
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';
    // Anti-enumeration: never disclose whether an email address exists in the database
    if (code === 'auth/user-not-found' || code === 'auth/invalid-continue-uri' || code === 'auth/unauthorized-continue-uri') {
      if (code === 'auth/invalid-continue-uri' || code === 'auth/unauthorized-continue-uri') {
        try {
          await sendPasswordResetEmail(auth, emailCheck.normalized);
        } catch (retryErr) {
          const retryCode =
            typeof retryErr === 'object' && retryErr !== null && 'code' in retryErr
              ? String((retryErr as { code?: unknown }).code || '')
              : '';
          if (retryCode !== 'auth/user-not-found') {
            throw mapFirebaseAuthError(retryErr, 'Unable to process password reset request.');
          }
        }
      }
      return NEUTRAL_PASSWORD_RESET_MESSAGE;
    }
    throw mapFirebaseAuthError(error, 'Unable to process password reset request.');
  }
}

export async function verifyEmailPasswordResetCode(oobCode: string): Promise<string> {
  const cleanCode = oobCode.trim();
  if (!cleanCode) {
    throw new Error('Invalid password reset link or verification code.');
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Internet connection required to verify a password reset code.');
  }
  try {
    return await verifyPasswordResetCode(auth, cleanCode);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';
    if (code === 'auth/expired-action-code') {
      throw new Error(
        'This password reset link or code has expired. Please request a new password reset link.'
      );
    }
    if (code === 'auth/invalid-action-code') {
      throw new Error(
        'This password reset link or code is invalid or has already been used. Request a fresh reset link.'
      );
    }
    throw mapFirebaseAuthError(error, 'Unable to validate password reset code.');
  }
}

export async function completeEmailPasswordReset(
  oobCode: string,
  newPassword: string,
  confirmPassword: string
): Promise<string> {
  const cleanCode = oobCode.trim();
  if (!cleanCode) {
    throw new Error('Invalid password reset link or verification code.');
  }
  const issue = validatePasswordStrength(newPassword);
  if (issue) throw new Error(issue);
  if (newPassword !== confirmPassword) {
    throw new Error('New Password and Confirm New Password do not match.');
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Internet connection required to complete password reset.');
  }

  const verifiedEmail = await verifyEmailPasswordResetCode(cleanCode);
  try {
    await confirmPasswordReset(auth, cleanCode, newPassword);
    return verifiedEmail;
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';
    if (code === 'auth/expired-action-code') {
      throw new Error(
        'This password reset link has expired before completion. Please request a new reset link.'
      );
    }
    if (code === 'auth/invalid-action-code') {
      throw new Error(
        'This password reset link is invalid or has already been used. Please request a new reset link.'
      );
    }
    throw mapFirebaseAuthError(error, 'Unable to complete password reset.');
  }
}

export async function adminInitiateUserPasswordReset(
  actor: UserAccount,
  target: UserAccount
): Promise<string> {
  if (!canManageUsers(actor.role)) {
    throw new Error('Only authorized administrators can initiate password resets.');
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Internet connection required to dispatch password reset instructions.');
  }
  if (!target.email || target.email.endsWith('@fdmis.local')) {
    throw new Error(
      'This legacy account has no real email address. Approve its Reset PIN in the Phone Recovery Queue below.'
    );
  }
  try {
    await sendPasswordResetEmail(auth, target.email);
  } catch (error) {
    throw mapFirebaseAuthError(error, 'Unable to send password reset email.');
  }

  try {
    await setDoc(doc(collection(db, 'audit_logs')), {
      actorUid: actor.uid,
      actorName: actor.displayName,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'ADMIN_PASSWORD_RESET_EMAIL_SENT',
      affectedEntity: 'users',
      affectedId: target.uid,
      details: `Initiated password reset email to ${target.email} (${target.displayName}).`,
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking audit log
  }
  return target.email;
}

export async function provisionOperationsOfficerAccount(
  actor: UserAccount,
  input: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
    lgaId: LgaId;
    wardId: string;
    wardName: string;
  }
): Promise<UserAccount> {
  if (!canManageOperationsOfficers(actor.role) || actor.role !== UserRole.FULL_CONTROL_ADMIN) {
    throw new Error(
      'Only Full Control Admin can provision brand-new Operations Officer credentials directly. LGA admins can assign Operations Officer role to existing registered users.'
    );
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Internet connection required to create an Operations Officer account.');
  }

  const cleanName = input.fullName.trim().slice(0, 110);
  if (cleanName.length < 2) {
    throw new Error('Officer full name must be at least 2 characters.');
  }
  const emailCheck = validateEmailAddress(input.email);
  if (!emailCheck.valid) {
    throw new Error(emailCheck.error || 'Enter a valid email address.');
  }
  const normalizedPhone = normalizePhoneNumber(input.phone);
  if (!normalizedPhone.valid) {
    throw new Error(normalizedPhone.error || 'Enter a valid phone number.');
  }
  const pwIssue = validatePasswordStrength(input.password);
  if (pwIssue) {
    throw new Error(pwIssue);
  }
  if (!input.lgaId || !input.wardId) {
    throw new Error('Select both LGA and Ward for this Operations Officer.');
  }

  const phoneHash = await computePhoneBlindHash(normalizedPhone.digits);
  const existingIdx = await getDoc(doc(db, 'phone_index', phoneHash));
  if (existingIdx.exists()) {
    throw new Error(
      'This phone number is already registered in FDMIS. Promote the existing user record instead of creating a duplicate.'
    );
  }

  const passwordHashed = await hashSecretPBKDF2(input.password);
  const recoveryKey = generateRecoveryKey();
  const recoveryHashed = await hashSecretPBKDF2(normalizeRecoveryKey(recoveryKey));

  const secondaryApp = initializeApp(
    firebaseConfig,
    `fdmis-officer-provision-${Date.now()}`
  );
  const secondaryAuth = getAuth(secondaryApp);

  let createdUid = '';
  try {
    const cred = await createUserWithEmailAndPassword(
      secondaryAuth,
      emailCheck.normalized,
      input.password
    );
    createdUid = cred.user.uid;
    void sendEmailVerification(cred.user).catch(() => {
      // Non-blocking verification email
    });

    const ownerUidHash = await computeUidBlindHash(createdUid);
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', createdUid), {
      uid: createdUid,
      email: emailCheck.normalized,
      displayName: cleanName,
      phone: normalizedPhone.e164,
      authMethod: 'EMAIL_PASSWORD',
      role: UserRole.OPERATIONS_OFFICER,
      status: AccountStatus.ACTIVE,
      assignedLgaId: input.lgaId,
      assignedWardId: input.wardId,
      assignedPollingUnitId: '',
      requestedLgaId: input.lgaId,
      requestedWardId: input.wardId,
      requestedWardName: input.wardName.slice(0, 120),
      sessionRevoked: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'user_credentials', createdUid), {
      uid: createdUid,
      phoneHash,
      passwordSalt: passwordHashed.saltHex,
      passwordHash: passwordHashed.hashHex,
      passwordAlgorithm: PBKDF2_ALGORITHM_LABEL,
      recoveryKeySalt: recoveryHashed.saltHex,
      recoveryKeyHash: recoveryHashed.hashHex,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'phone_index', phoneHash), {
      phoneHash,
      ownerUidHash,
      accountType: 'EMAIL_PASSWORD',
      authSeq: 0,
      pendingNextAuthSeq: 0,
      resetPinSalt: '',
      resetPinHash: '',
      recoveryKeySalt: recoveryHashed.saltHex,
      recoveryKeyHash: recoveryHashed.hashHex,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(collection(db, 'audit_logs')), {
      actorUid: actor.uid,
      actorName: actor.displayName,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'OPERATIONS_OFFICER_CREATED',
      affectedEntity: 'users',
      affectedId: createdUid,
      details: `Created active Operations Officer ${cleanName} (${emailCheck.normalized}, ${normalizedPhone.maskedPhone}) for ${input.lgaId.toUpperCase()} / ${input.wardName}.`,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    const createdSnap = await getDoc(doc(db, 'users', createdUid));
    return createdSnap.data() as UserAccount;
  } catch (error) {
    if (createdUid && secondaryAuth.currentUser) {
      try {
        await deleteUser(secondaryAuth.currentUser);
      } catch {
        // Ignore rollback failure
      }
    }
    throw mapFirebaseAuthError(error, 'Unable to create Operations Officer account.');
  } finally {
    await signOut(secondaryAuth).catch(() => {});
    await deleteApp(secondaryApp).catch(() => {});
  }
}

export async function submitPasswordResetRequest(input: {
  phone: string;
  fullName: string;
  lgaId: string;
  wardName: string;
  puCode: string;
  recoveryKey?: string;
}): Promise<{ requestId: string; recoveryKeyMatched: boolean; maskedPhone: string }> {
  const normalized = normalizePhoneNumber(input.phone);
  if (!normalized.valid) {
    throw new Error(normalized.error || 'Enter a valid registered phone number.');
  }
  const cleanName = input.fullName.trim().slice(0, 120);
  if (cleanName.length < 2) {
    throw new Error('Enter your full registered name (at least 2 characters).');
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Internet connection required to submit a password recovery request.');
  }

  const phoneHash = await computePhoneBlindHash(normalized.digits);
  const idxSnap = await getDoc(doc(db, 'phone_index', phoneHash));
  if (!idxSnap.exists()) {
    throw new Error('No phone-registered operator account matches that phone number.');
  }

  const idxData = idxSnap.data() as {
    recoveryKeySalt?: string;
    recoveryKeyHash?: string;
  };
  let recoveryKeyMatched = false;
  const trimmedKey = (input.recoveryKey || '').trim();
  if (trimmedKey) {
    if (!idxData.recoveryKeySalt || !idxData.recoveryKeyHash) {
      throw new Error('No recovery key is configured on this account; leave blank for admin review.');
    }
    recoveryKeyMatched = await verifySecretPBKDF2(
      normalizeRecoveryKey(trimmedKey),
      idxData.recoveryKeySalt,
      idxData.recoveryKeyHash
    );
    if (!recoveryKeyMatched) {
      throw new Error(
        'Personal Recovery Key does not match our record. Verify the key or leave it blank for administrator identity verification.'
      );
    }
  }

  const reqRef = doc(collection(db, 'password_reset_requests'));
  try {
    await setDoc(reqRef, {
      phoneHash,
      maskedPhone: normalized.maskedPhone,
      applicantName: cleanName,
      lgaId: (input.lgaId || '').trim().slice(0, 32),
      wardName: (input.wardName || '').trim().slice(0, 120),
      puCode: (input.puCode || '').trim().slice(0, 40),
      recoveryKeyMatched,
      status: 'PENDING',
      reviewerNote: '',
      reviewedByUid: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `password_reset_requests/${reqRef.id}`);
  }

  try {
    window.localStorage.setItem(LS_ACTIVE_RESET_REQ_KEY, reqRef.id);
  } catch {
    // Ignore storage restriction
  }

  return {
    requestId: reqRef.id,
    recoveryKeyMatched,
    maskedPhone: normalized.maskedPhone,
  };
}

export async function completeApprovedPasswordReset(input: {
  phone: string;
  resetPin: string;
  fullName?: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<UserAccount> {
  const normalized = normalizePhoneNumber(input.phone);
  if (!normalized.valid) {
    throw new Error(normalized.error || 'Enter a valid registered phone number.');
  }
  const cleanPin = normalizeRecoveryKey(input.resetPin);
  if (cleanPin.length < 4) {
    throw new Error('Enter the one-time Reset PIN issued by your administrator.');
  }
  const passwordIssue = validatePasswordStrength(input.newPassword);
  if (passwordIssue) throw new Error(passwordIssue);
  if (input.newPassword !== input.confirmPassword) {
    throw new Error('New Password and Confirm Password do not match.');
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Internet connection required to complete password reset.');
  }

  const phoneHash = await computePhoneBlindHash(normalized.digits);
  const indexRef = doc(db, 'phone_index', phoneHash);
  const idxSnap = await getDoc(indexRef);
  if (!idxSnap.exists()) {
    throw new Error('No registered phone account matches this number.');
  }

  const idxData = idxSnap.data() as {
    authSeq: number;
    pendingNextAuthSeq: number;
    resetPinSalt: string;
    resetPinHash: string;
    recoveryKeySalt: string;
    recoveryKeyHash: string;
  };

  if (
    typeof idxData.pendingNextAuthSeq !== 'number' ||
    idxData.pendingNextAuthSeq <= (idxData.authSeq || 0) ||
    !idxData.resetPinHash
  ) {
    throw new Error(
      'No approved Reset PIN is active for this phone number. Submit a Forgot Password request and obtain administrator approval first.'
    );
  }

  const pinMatches = await verifySecretPBKDF2(
    cleanPin,
    idxData.resetPinSalt,
    idxData.resetPinHash
  );
  if (!pinMatches) {
    throw new Error('Invalid one-time Reset PIN. Check the code provided by your administrator.');
  }

  const nextEmail = getSyntheticEmailForPhoneDigits(
    normalized.digits,
    idxData.pendingNextAuthSeq
  );
  const newPasswordHashed = await hashSecretPBKDF2(input.newPassword);
  const cleanName =
    (input.fullName || '').trim().slice(0, 110) ||
    `Recovered Operator (${normalized.maskedPhone})`;

  let createdFbUser: FirebaseUser;
  try {
    const cred = await createUserWithEmailAndPassword(auth, nextEmail, input.newPassword);
    createdFbUser = cred.user;
  } catch (error) {
    throw mapFirebaseAuthError(error, 'Unable to provision reset credentials.');
  }

  const newUidHash = await computeUidBlindHash(createdFbUser.uid);
  const userRef = doc(db, 'users', createdFbUser.uid);
  const credRef = doc(db, 'user_credentials', createdFbUser.uid);
  const auditRef = doc(collection(db, 'audit_logs'));

  const batch = writeBatch(db);
  batch.update(indexRef, {
    ownerUidHash: newUidHash,
    authSeq: idxData.pendingNextAuthSeq,
    resetPinSalt: '',
    resetPinHash: '',
    updatedAt: serverTimestamp(),
  });

  batch.set(credRef, {
    uid: createdFbUser.uid,
    phoneHash,
    passwordSalt: newPasswordHashed.saltHex,
    passwordHash: newPasswordHashed.hashHex,
    passwordAlgorithm: PBKDF2_ALGORITHM_LABEL,
    recoveryKeySalt: idxData.recoveryKeySalt || '',
    recoveryKeyHash: idxData.recoveryKeyHash || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(userRef, {
    uid: createdFbUser.uid,
    email: createdFbUser.email || nextEmail,
    displayName: cleanName,
    phone: normalized.e164,
    authMethod: 'PHONE_PASSWORD',
    role: UserRole.PENDING,
    status: AccountStatus.PENDING_APPROVAL,
    assignedLgaId: '',
    assignedWardId: '',
    assignedPollingUnitId: '',
    sessionRevoked: false,
    lastLoginAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(auditRef, {
    actorUid: createdFbUser.uid,
    actorName: cleanName,
    actorEmail: normalized.e164,
    actorRole: UserRole.PENDING,
    action: 'PASSWORD_RESET_COMPLETED',
    affectedEntity: 'phone_index',
    affectedId: phoneHash,
    details: `Completed approved password reset for ${normalized.maskedPhone}; awaiting administrator scope re-activation.`,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    try {
      await deleteUser(createdFbUser);
    } catch {
      // Ignore cleanup error
    }
    throw mapFirebaseAuthError(err, 'Failed to finalize password reset.');
  }

  try {
    const storedReqId = window.localStorage.getItem(LS_ACTIVE_RESET_REQ_KEY);
    if (storedReqId) {
      await updateDoc(doc(db, 'password_reset_requests', storedReqId), {
        status: 'COMPLETED',
        updatedAt: serverTimestamp(),
      });
      window.localStorage.removeItem(LS_ACTIVE_RESET_REQ_KEY);
    }
  } catch {
    // Non-blocking best-effort request completion status sync
  }

  const snap = await getDoc(userRef);
  return snap.data() as UserAccount;
}

export async function updateOwnProfile(
  actor: UserAccount,
  updates: { displayName: string; phone: string }
): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || fbUser.uid !== actor.uid) {
    throw new Error('Authenticated session required.');
  }

  const cleanName = updates.displayName.trim().slice(0, 110);
  if (cleanName.length < 2) {
    throw new Error('Operational display name must be at least 2 characters.');
  }
  const trimmedPhone = updates.phone.trim().slice(0, 30);
  let normalizedPhoneValue = trimmedPhone;

  if (actor.authMethod === 'PHONE_PASSWORD') {
    // Keep primary phone sign-in number immutable on PHONE_PASSWORD accounts to preserve phone_index integrity
    normalizedPhoneValue = actor.phone || trimmedPhone;
  } else if (trimmedPhone) {
    const norm = normalizePhoneNumber(trimmedPhone);
    if (!norm.valid) {
      throw new Error(norm.error || 'Enter a valid phone number.');
    }
    normalizedPhoneValue = norm.e164;
  }

  try {
    await updateDoc(doc(db, 'users', actor.uid), {
      displayName: cleanName,
      phone: normalizedPhoneValue || null,
      updatedAt: serverTimestamp(),
    });
    saveCachedSession({
      ...actor,
      displayName: cleanName,
      phone: normalizedPhoneValue || null,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${actor.uid}`);
  }
}

export function subscribeToUserPreferences(
  uid: string,
  onData: (prefs: UserPreferences | null) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `user_preferences/${uid}`;
  return onSnapshot(
    doc(db, 'user_preferences', uid),
    (snap) => {
      onData(snap.exists() ? (snap.data() as UserPreferences) : null);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function saveUserPreferences(
  uid: string,
  prefs: Pick<
    UserPreferences,
    | 'criticalAlertsEnabled'
    | 'resultUpdatesEnabled'
    | 'incidentDigestEnabled'
    | 'soundAlertsEnabled'
  >
): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || fbUser.uid !== uid) {
    throw new Error('Authenticated session required.');
  }

  try {
    await setDoc(doc(db, 'user_preferences', uid), {
      uid,
      criticalAlertsEnabled: Boolean(prefs.criticalAlertsEnabled),
      resultUpdatesEnabled: Boolean(prefs.resultUpdatesEnabled),
      incidentDigestEnabled: Boolean(prefs.incidentDigestEnabled),
      soundAlertsEnabled: Boolean(prefs.soundAlertsEnabled),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `user_preferences/${uid}`);
  }
}

export function getAuthProviderSummary(fallbackAccount?: UserAccount | null): {
  hasPasswordProvider: boolean;
  hasGoogleProvider: boolean;
  providerIds: string[];
  email: string;
} {
  const fbUser = auth.currentUser;
  const providers = fbUser?.providerData.map((p) => p.providerId) || [];
  const hasPasswordProvider =
    providers.includes('password') ||
    (!fbUser &&
      (fallbackAccount?.authMethod === 'EMAIL_PASSWORD' ||
        fallbackAccount?.authMethod === 'PHONE_PASSWORD'));
  const hasGoogleProvider =
    providers.includes('google.com') || (!fbUser && fallbackAccount?.authMethod === 'GOOGLE');

  return {
    hasPasswordProvider,
    hasGoogleProvider,
    providerIds: providers,
    email: fbUser?.email || fallbackAccount?.email || '',
  };
}

export async function changeAccountPassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Online server verification is required to change your password.');
  }
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.email) {
    throw new Error('An active online authenticated session is required to change your password.');
  }
  const summary = getAuthProviderSummary();
  if (!summary.hasPasswordProvider) {
    throw new Error(
      'Your account currently uses Google Sign-In only. Use "Set Up Account Password" below to link a password securely.'
    );
  }
  if (!currentPassword) {
    throw new Error('Enter your current password to verify your identity.');
  }
  const issue = validatePasswordStrength(newPassword);
  if (issue) {
    throw new Error(issue);
  }
  if (currentPassword === newPassword) {
    throw new Error('New password must be different from your current password.');
  }

  try {
    const credential = EmailAuthProvider.credential(fbUser.email, currentPassword);
    await reauthenticateWithCredential(fbUser, credential);
    await updatePassword(fbUser, newPassword);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      throw new Error('Current password is incorrect.');
    }
    if (code === 'auth/requires-recent-login') {
      throw new Error(
        'For security, please sign out and sign in again before changing your password.'
      );
    }
    throw mapFirebaseAuthError(error, 'Unable to update account password.');
  }

  const hashed = await hashSecretPBKDF2(newPassword);
  const credRef = doc(db, 'user_credentials', fbUser.uid);
  try {
    const credSnap = await getDoc(credRef);
    if (credSnap.exists()) {
      await updateDoc(credRef, {
        passwordSalt: hashed.saltHex,
        passwordHash: hashed.hashHex,
        passwordAlgorithm: PBKDF2_ALGORITHM_LABEL,
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Non-blocking if credential shadow doc is absent for legacy password accounts
  }

  try {
    await updateDoc(doc(db, 'users', fbUser.uid), {
      lastPasswordChangedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking profile password-change timestamp update
  }

  try {
    await setDoc(doc(collection(db, 'audit_logs')), {
      actorUid: fbUser.uid,
      actorName: fbUser.displayName || fbUser.email || 'Operator',
      actorEmail: fbUser.email || '',
      actorRole: 'SELF',
      action: 'PASSWORD_CHANGED',
      affectedEntity: 'users',
      affectedId: fbUser.uid,
      details: 'User re-authenticated and updated account password in Settings & Security.',
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking audit entry
  }
}

/**
 * Securely sets up a local password for a Google-only user by freshly verifying their
 * Google identity and linking an Email/Password credential without affecting Google Sign-In.
 */
export async function setupPasswordForGoogleAccount(
  newPassword: string,
  confirmPassword: string
): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Online server verification is required to set up an account password.');
  }
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.email) {
    throw new Error('An active online Google session is required to set up a password.');
  }
  const summary = getAuthProviderSummary();
  if (summary.hasPasswordProvider) {
    throw new Error('This account already has a password configured. Use Change Password instead.');
  }
  const issue = validatePasswordStrength(newPassword);
  if (issue) {
    throw new Error(issue);
  }
  if (newPassword !== confirmPassword) {
    throw new Error('New Password and Confirm New Password do not match.');
  }

  try {
    await reauthenticateWithPopup(fbUser, googleProvider);
    const credential = EmailAuthProvider.credential(fbUser.email, newPassword);
    await linkWithCredential(fbUser, credential);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Google identity confirmation was cancelled. Please try again to complete password setup.');
    }
    if (code === 'auth/provider-already-linked' || code === 'auth/credential-already-in-use') {
      throw new Error('A password sign-in method is already linked to this email address.');
    }
    if (code === 'auth/requires-recent-login') {
      throw new Error('Please sign in again with Google to verify your identity before setting a password.');
    }
    throw mapFirebaseAuthError(error, 'Unable to link a password to your Google account.');
  }

  try {
    await updateDoc(doc(db, 'users', fbUser.uid), {
      lastPasswordChangedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking timestamp update
  }

  try {
    await setDoc(doc(collection(db, 'audit_logs')), {
      actorUid: fbUser.uid,
      actorName: fbUser.displayName || fbUser.email || 'Operator',
      actorEmail: fbUser.email || '',
      actorRole: 'SELF',
      action: 'PASSWORD_LINKED_TO_GOOGLE',
      affectedEntity: 'users',
      affectedId: fbUser.uid,
      details: 'Google-authenticated operator confirmed identity and securely linked a local password.',
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking audit log
  }
}

export async function updateUserBatteryStatus(
  user: UserAccount,
  level: number | null,
  charging: boolean | null
): Promise<void> {
  const safeLevel =
    typeof level === 'number' && Number.isFinite(level)
      ? Math.max(0, Math.min(100, Math.round(level)))
      : null;
  const safeCharging = typeof charging === 'boolean' ? charging : null;

  saveCachedSession({
    ...user,
    batteryLevel: safeLevel,
    batteryCharging: safeCharging,
    batteryUpdatedAt: new Date().toISOString(),
  });

  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const fbUser = auth.currentUser;
  if (!fbUser || fbUser.uid !== user.uid || user.status !== AccountStatus.ACTIVE || user.sessionRevoked) {
    return;
  }

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      batteryLevel: safeLevel,
      batteryCharging: safeCharging,
      batteryUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking telemetry persistence
  }
}

export function subscribeToUserAccount(
  uid: string,
  onData: (account: UserAccount | null) => void,
  onError: (err: Error) => void,
  maxOfflineDays = DEFAULT_OFFLINE_SESSION_MAX_DAYS
): Unsubscribe {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snapshot) => {
      if (snapshot.exists()) {
        const account = snapshot.data() as UserAccount;
        const fromCacheOnly = snapshot.metadata?.fromCache === true;
        if (account.status === AccountStatus.ACTIVE && !account.sessionRevoked) {
          saveCachedSession(account);
          if (!fromCacheOnly && (typeof navigator === 'undefined' || navigator.onLine)) {
            void establishTrustedDeviceSession(account, {
              providerIds: auth.currentUser?.providerData.map((p) => p.providerId) || [],
              maxOfflineDays,
            });
          }
        } else {
          void clearTrustedDeviceSession(uid);
          clearCachedSession(uid);
        }
        onData(account);
      } else {
        void clearTrustedDeviceSession(uid);
        clearCachedSession(uid);
        onData(null);
      }
    },
    (error) => {
      if (isOfflineOrNetworkError(error)) {
        void verifyTrustedDeviceSession(uid).then((trusted) => {
          if (trusted.valid) {
            onData(trusted.payload.account);
          }
        });
        return;
      }
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeToGlobalSettings(
  onData: (settings: GlobalSettings | null) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = 'system_settings/global';
  return onSnapshot(
    doc(db, 'system_settings', 'global'),
    (snapshot) => {
      onData(snapshot.exists() ? (snapshot.data() as GlobalSettings) : null);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}
