import {
  EmailAuthProvider,
  reauthenticateWithCredential,
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
  type UserAccount,
  type UserPreferences,
} from '../types/fdmis';

export interface ProfileCheckResult {
  account: UserAccount | null;
  needsBootstrap: boolean;
  needsRegistration: boolean;
}

export async function signInWithGoogle(): Promise<FirebaseUser> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

function clearLocalSessionTokens(): void {
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
  if (actor && auth.currentUser) {
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
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (userSnap.exists()) {
    const account = userSnap.data() as UserAccount;
    if (account.status === AccountStatus.ACTIVE && !account.sessionRevoked) {
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
    handleFirestoreError(error, OperationType.GET, 'system_settings/bootstrap');
  }

  if (!bootstrapExists) {
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
  if (!user) throw new Error('Authenticated Google account required.');

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
    return createdSnap.data() as UserAccount;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
  }
}

export async function registerPendingAccount(
  displayName: string,
  phone: string
): Promise<UserAccount> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authenticated Google account required.');

  const cleanName = displayName.trim().slice(0, 110);
  if (cleanName.length < 2) {
    throw new Error('Full operational name must be at least 2 characters.');
  }

  const cleanPhone = phone.trim().slice(0, 25);
  const userRef = doc(db, 'users', user.uid);
  const payload: Record<string, unknown> = {
    uid: user.uid,
    email: user.email || '',
    displayName: cleanName,
    role: UserRole.PENDING,
    status: AccountStatus.PENDING_APPROVAL,
    assignedLgaId: '',
    assignedWardId: '',
    assignedPollingUnitId: '',
    sessionRevoked: false,
    lastLoginAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (cleanPhone.length > 0) {
    payload.phone = cleanPhone;
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
  const cleanPhone = updates.phone.trim().slice(0, 30);

  try {
    await updateDoc(doc(db, 'users', actor.uid), {
      displayName: cleanName,
      phone: cleanPhone || null,
      updatedAt: serverTimestamp(),
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
  if (newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters.');
  }
  const credential = EmailAuthProvider.credential(fbUser.email, currentPassword);
  await reauthenticateWithCredential(fbUser, credential);
  await updatePassword(fbUser, newPassword);
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
      onData(snapshot.exists() ? (snapshot.data() as UserAccount) : null);
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
