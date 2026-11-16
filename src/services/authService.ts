import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  AccountStatus,
  DEFAULT_WHATSAPP_GROUP_NAME,
  DEFAULT_WHATSAPP_GROUP_URL,
  UserRole,
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
  validatePasswordStrength,
  validateRegistrationInputs,
  verifySecretPBKDF2,
} from '../utils/phoneAuth';
import {
  clearCachedSession,
  deletePendingOfflineRegistration,
  loadCachedSession,
  purgeAllUserSnapshots,
  saveCachedSession,
  savePendingOfflineRegistration,
  updatePendingOfflineRegistrationStatus,
} from './offlineQueue';

const LS_ACTIVE_RESET_REQ_KEY = 'fdmis_active_reset_req_id';
const ephemeralOfflineRegPasswords = new Map<string, string>();

export function cacheEphemeralOfflinePassword(regId: string, password: string): void {
  ephemeralOfflineRegPasswords.set(regId, password);
}

export function getEphemeralOfflinePassword(regId: string): string | undefined {
  return ephemeralOfflineRegPasswords.get(regId);
}

export function clearEphemeralOfflinePassword(regId: string): void {
  ephemeralOfflineRegPasswords.delete(regId);
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
      'This phone number is already registered in FDMIS. Sign in with your password or use Forgot Password to recover access.'
    );
  }
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  ) {
    return new Error('Invalid phone number or password.');
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
  await signOut(auth);
  clearCachedSession(actor?.uid);
  await purgeAllUserSnapshots(actor?.uid);
  clearLocalSessionTokens();
}

export async function checkUserAndBootstrapState(
  firebaseUser: FirebaseUser
): Promise<ProfileCheckResult> {
  const userPath = `users/${firebaseUser.uid}`;
  const userRef = doc(db, 'users', firebaseUser.uid);

  let userSnap;
  try {
    userSnap = await getDoc(userRef);
  } catch (error) {
    if (isOfflineOrNetworkError(error)) {
      const cached = loadCachedSession(firebaseUser.uid);
      if (
        cached &&
        cached.status === AccountStatus.ACTIVE &&
        !cached.sessionRevoked &&
        cached.role !== UserRole.PENDING
      ) {
        return {
          account: cached,
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
    if (account.status === AccountStatus.ACTIVE && !account.sessionRevoked) {
      saveCachedSession(account);

      if (typeof navigator === 'undefined' || navigator.onLine) {
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
      clearCachedSession(account.uid);
    }
    return {
      account,
      needsBootstrap: false,
      needsRegistration: false,
    };
  }

  const bootstrapRef = doc(db, 'system_settings', 'bootstrap');
  let bootstrapExists = true;
  try {
    const bootstrapSnap = await getDoc(bootstrapRef);
    bootstrapExists = bootstrapSnap.exists();
  } catch (error) {
    if (isOfflineOrNetworkError(error)) {
      const cached = loadCachedSession(firebaseUser.uid);
      if (
        cached &&
        cached.status === AccountStatus.ACTIVE &&
        !cached.sessionRevoked
      ) {
        return {
          account: cached,
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

  const isPhoneUser = user.email?.endsWith('@fdmis.local') ?? false;
  const userRef = doc(db, 'users', user.uid);
  const payload: Record<string, unknown> = {
    uid: user.uid,
    email: user.email || '',
    displayName: cleanName,
    authMethod: isPhoneUser ? 'PHONE_PASSWORD' : 'GOOGLE',
    role: UserRole.PENDING,
    status: AccountStatus.PENDING_APPROVAL,
    assignedLgaId: '',
    assignedWardId: '',
    assignedPollingUnitId: '',
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
    return snap.data() as UserAccount;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
  }
}

// ---------- PHONE + PASSWORD REGISTRATION, SIGN-IN & OFFLINE SYNC ----------

async function commitPhoneAccountDocuments(params: {
  firebaseUser: FirebaseUser;
  displayName: string;
  phoneE164: string;
  phoneHash: string;
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
    email: firebaseUser.email || '',
    displayName: params.displayName.trim().slice(0, 110),
    phone: params.phoneE164,
    authMethod: 'PHONE_PASSWORD',
    role: UserRole.PENDING,
    status: AccountStatus.PENDING_APPROVAL,
    assignedLgaId: '',
    assignedWardId: '',
    assignedPollingUnitId: '',
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
    actorEmail: params.phoneE164,
    actorRole: UserRole.PENDING,
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
  return snap.data() as UserAccount;
}

export async function registerWithPhoneAndPassword(input: {
  fullName: string;
  phone: string;
  password: string;
  confirmPassword: string;
  location: RegistrationLocationSelection;
}): Promise<PhoneRegistrationResult> {
  const validationError = validateRegistrationInputs({
    fullName: input.fullName,
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

  const normalized = normalizePhoneNumber(input.phone);
  if (!normalized.valid) {
    throw new Error(normalized.error || 'Enter a valid phone number.');
  }

  const cleanName = input.fullName.trim().slice(0, 110);
  const phoneHash = await computePhoneBlindHash(normalized.digits);
  const passwordHashed = await hashSecretPBKDF2(input.password);
  const recoveryKey = generateRecoveryKey();
  const recoveryHashed = await hashSecretPBKDF2(normalizeRecoveryKey(recoveryKey));

  const onlineNow = typeof navigator === 'undefined' ? true : navigator.onLine;
  if (!onlineNow) {
    const now = new Date().toISOString();
    const regId = `offreg_${phoneHash.slice(0, 16)}_${Date.now()}`;
    const offlineRecord: PendingOfflineRegistration = {
      id: regId,
      displayName: cleanName,
      phoneE164: normalized.e164,
      phoneDigits: normalized.digits,
      phoneHash,
      passwordSalt: passwordHashed.saltHex,
      passwordHash: passwordHashed.hashHex,
      recoveryKeySalt: recoveryHashed.saltHex,
      recoveryKeyHash: recoveryHashed.hashHex,
      requestedLgaId: input.location.lgaId,
      requestedLgaName: input.location.lgaName,
      requestedWardId: input.location.wardId,
      requestedWardName: input.location.wardName,
      requestedPollingUnitId: input.location.puId,
      requestedPollingUnitCode: input.location.puCode,
      requestedPollingUnitName: input.location.puName,
      status: 'QUEUED_OFFLINE',
      createdAtIso: now,
      updatedAtIso: now,
    };
    await savePendingOfflineRegistration(offlineRecord);
    cacheEphemeralOfflinePassword(regId, input.password);
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
      phoneE164: normalized.e164,
      phoneHash,
      passwordSalt: passwordHashed.saltHex,
      passwordHash: passwordHashed.hashHex,
      recoveryKeySalt: recoveryHashed.saltHex,
      recoveryKeyHash: recoveryHashed.hashHex,
      location: input.location,
      auditAction: 'PHONE_ACCOUNT_REGISTERED',
      auditDetails: `Registered pending operator ${cleanName} (${normalized.maskedPhone}) requesting ${input.location.lgaId.toUpperCase()} / ${input.location.wardName} / ${input.location.puCode}.`,
    });

    return {
      queuedOffline: false,
      account,
      recoveryKey,
    };
  } catch (error) {
    if (isOfflineOrNetworkError(error)) {
      const now = new Date().toISOString();
      const regId = `offreg_${phoneHash.slice(0, 16)}_${Date.now()}`;
      const offlineRecord: PendingOfflineRegistration = {
        id: regId,
        displayName: cleanName,
        phoneE164: normalized.e164,
        phoneDigits: normalized.digits,
        phoneHash,
        passwordSalt: passwordHashed.saltHex,
        passwordHash: passwordHashed.hashHex,
        recoveryKeySalt: recoveryHashed.saltHex,
        recoveryKeyHash: recoveryHashed.hashHex,
        requestedLgaId: input.location.lgaId,
        requestedLgaName: input.location.lgaName,
        requestedWardId: input.location.wardId,
        requestedWardName: input.location.wardName,
        requestedPollingUnitId: input.location.puId,
        requestedPollingUnitCode: input.location.puCode,
        requestedPollingUnitName: input.location.puName,
        status: 'QUEUED_OFFLINE',
        createdAtIso: now,
        updatedAtIso: now,
      };
      await savePendingOfflineRegistration(offlineRecord);
      cacheEphemeralOfflinePassword(regId, input.password);
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

    const syntheticEmail = getSyntheticEmailForPhoneDigits(reg.phoneDigits, 0);
    const cred = await createUserWithEmailAndPassword(auth, syntheticEmail, rawPassword);
    const account = await commitPhoneAccountDocuments({
      firebaseUser: cred.user,
      displayName: reg.displayName,
      phoneE164: reg.phoneE164,
      phoneHash: reg.phoneHash,
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
      auditAction: 'OFFLINE_PHONE_ACCOUNT_SYNCED',
      auditDetails: `Synchronized offline registration for ${reg.displayName} (${reg.phoneE164}) requesting ${reg.requestedLgaId.toUpperCase()} / ${reg.requestedWardName} / ${reg.requestedPollingUnitCode}.`,
    });

    await deletePendingOfflineRegistration(reg.id);
    clearEphemeralOfflinePassword(reg.id);
    return account;
  } catch (error) {
    const mapped = mapFirebaseAuthError(error, 'Failed to sync queued registration.');
    await updatePendingOfflineRegistrationStatus(reg.id, 'SYNC_FAILED', mapped.message);
    throw mapped;
  }
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
  let authSeq = 0;

  try {
    const idxSnap = await getDoc(doc(db, 'phone_index', phoneHash));
    if (!idxSnap.exists()) {
      throw new Error(
        'No operator account was found for this phone number. Check the number or create a new account.'
      );
    }
    const idxData = idxSnap.data() as { authSeq?: number };
    if (typeof idxData.authSeq === 'number' && idxData.authSeq > 0) {
      authSeq = idxData.authSeq;
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('No operator account')) {
      throw error;
    }
    if (isOfflineOrNetworkError(error)) {
      throw new Error('Network connection required to verify phone credentials.');
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

export function getAuthProviderSummary(): {
  hasPasswordProvider: boolean;
  providerIds: string[];
  email: string;
} {
  const fbUser = auth.currentUser;
  const providers = fbUser?.providerData.map((p) => p.providerId) || [];
  return {
    hasPasswordProvider: providers.includes('password'),
    providerIds: providers,
    email: fbUser?.email || '',
  };
}

export async function changeAccountPassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.email) {
    throw new Error('Authenticated session required.');
  }
  const summary = getAuthProviderSummary();
  if (!summary.hasPasswordProvider) {
    throw new Error(
      'This account authenticates via Google Single Sign-On. Password management and 2FA are controlled directly in your Google Account security settings.'
    );
  }
  const issue = validatePasswordStrength(newPassword);
  if (issue) {
    throw new Error(issue);
  }
  const credential = EmailAuthProvider.credential(fbUser.email, currentPassword);
  await reauthenticateWithCredential(fbUser, credential);
  await updatePassword(fbUser, newPassword);

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
}

export function subscribeToUserAccount(
  uid: string,
  onData: (account: UserAccount | null) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snapshot) => {
      if (snapshot.exists()) {
        const account = snapshot.data() as UserAccount;
        if (account.status === AccountStatus.ACTIVE && !account.sessionRevoked) {
          saveCachedSession(account);
        } else {
          clearCachedSession(uid);
        }
        onData(account);
      } else {
        onData(null);
      }
    },
    (error) => {
      if (isOfflineOrNetworkError(error)) {
        const cached = loadCachedSession(uid);
        if (cached) {
          onData(cached);
          return;
        }
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
