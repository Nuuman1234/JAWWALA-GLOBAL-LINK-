import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

function createPersistentFirestore(): Firestore {
  try {
    return initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = createPersistentFirestore();
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export type ConnectionCheckStatus = 'checking' | 'connected' | 'offline';

export async function testFirestoreConnection(): Promise<ConnectionCheckStatus> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'offline';
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return 'connected';
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes('the client is offline')
    ) {
      return 'offline';
    }
    return 'connected';
  }
}
