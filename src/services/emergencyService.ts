import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  UserRole,
  canManageEmergencyContacts,
  type EmergencyContact,
  type LgaId,
  type UserAccount,
} from '../types/fdmis';

const PHONE_REGEX = /^[+0-9][0-9\s\-()]{4,22}[0-9]$/;

function requireAuthUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated user session required.');
  return uid;
}

async function logEmergencyAudit(
  actor: UserAccount,
  action: string,
  contactId: string,
  details: string
): Promise<void> {
  try {
    await setDoc(doc(collection(db, 'audit_logs')), {
      actorUid: actor.uid,
      actorName: actor.displayName.slice(0, 120),
      actorEmail: actor.email.slice(0, 200),
      actorRole: actor.role,
      action: action.slice(0, 100),
      affectedEntity: 'emergency_contacts',
      affectedId: contactId.slice(0, 128),
      details: details.slice(0, 1000),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'audit_logs');
  }
}

export function observeEmergencyContacts(
  user: UserAccount,
  onData: (contacts: EmergencyContact[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const base = collection(db, 'emergency_contacts');
  let q: Query;

  if (
    user.role === UserRole.FULL_CONTROL_ADMIN ||
    (user.role === UserRole.VERIFICATION_OFFICER && !user.assignedLgaId)
  ) {
    q = base;
  } else if (user.assignedLgaId === 'funtua' || user.assignedLgaId === 'dandume') {
    q = query(base, where('scopeLgaId', 'in', ['all', user.assignedLgaId]));
  } else {
    q = query(base, where('scopeLgaId', '==', 'all'));
  }

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<EmergencyContact, 'id'>) }))
        .sort((a, b) => {
          if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'emergency_contacts');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export interface EmergencyContactInput {
  name: string;
  roleLabel: string;
  phoneNumber: string;
  scopeLgaId: 'all' | LgaId;
  isPriority: boolean;
  notes: string;
}

export async function saveEmergencyContact(
  actor: UserAccount,
  input: EmergencyContactInput,
  existingContact?: EmergencyContact | null
): Promise<void> {
  const uid = requireAuthUid();
  if (!canManageEmergencyContacts(actor.role)) {
    throw new Error('Only authorized Super Admins can manage emergency assistance contacts.');
  }

  let effectiveScope: 'all' | LgaId = input.scopeLgaId;
  if (actor.role === UserRole.FUNTUA_SUPER_ADMIN) {
    if (existingContact && existingContact.scopeLgaId !== 'funtua') {
      throw new Error('Funtua Super Admin can only edit Funtua LGA emergency contacts.');
    }
    effectiveScope = 'funtua';
  } else if (actor.role === UserRole.DANDUME_SUPER_ADMIN) {
    if (existingContact && existingContact.scopeLgaId !== 'dandume') {
      throw new Error('Dandume Super Admin can only edit Dandume LGA emergency contacts.');
    }
    effectiveScope = 'dandume';
  }

  const cleanName = input.name.trim().slice(0, 120);
  const cleanRoleLabel = input.roleLabel.trim().slice(0, 100);
  const cleanPhone = input.phoneNumber.trim().slice(0, 24);
  const cleanNotes = input.notes.trim().slice(0, 240);

  if (cleanName.length < 2) {
    throw new Error('Emergency contact name must be at least 2 characters.');
  }
  if (cleanPhone.length < 6 || !PHONE_REGEX.test(cleanPhone)) {
    throw new Error('Enter a valid phone number (6–24 digits, optional +, spaces, hyphens).');
  }

  if (existingContact) {
    const ref = doc(db, 'emergency_contacts', existingContact.id);
    try {
      await updateDoc(ref, {
        name: cleanName,
        roleLabel: cleanRoleLabel,
        phoneNumber: cleanPhone,
        scopeLgaId: effectiveScope,
        isPriority: input.isPriority,
        notes: cleanNotes,
        updatedByUid: uid,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `emergency_contacts/${existingContact.id}`);
    }

    await logEmergencyAudit(
      actor,
      'EMERGENCY_CONTACT_UPDATED',
      existingContact.id,
      `Updated emergency contact "${cleanName}" (${cleanPhone}), scope=${effectiveScope}, priority=${input.isPriority}.`
    );
    return;
  }

  const ref = doc(collection(db, 'emergency_contacts'));
  try {
    await setDoc(ref, {
      name: cleanName,
      roleLabel: cleanRoleLabel,
      phoneNumber: cleanPhone,
      scopeLgaId: effectiveScope,
      isPriority: input.isPriority,
      notes: cleanNotes,
      createdByUid: uid,
      updatedByUid: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `emergency_contacts/${ref.id}`);
  }

  await logEmergencyAudit(
    actor,
    'EMERGENCY_CONTACT_CREATED',
    ref.id,
    `Added emergency contact "${cleanName}" (${cleanPhone}), scope=${effectiveScope}, priority=${input.isPriority}.`
  );
}

export async function removeEmergencyContact(
  actor: UserAccount,
  contact: EmergencyContact
): Promise<void> {
  requireAuthUid();
  if (!canManageEmergencyContacts(actor.role)) {
    throw new Error('Only authorized Super Admins can remove emergency contacts.');
  }
  if (actor.role === UserRole.FUNTUA_SUPER_ADMIN && contact.scopeLgaId !== 'funtua') {
    throw new Error('Funtua Super Admin can only remove Funtua LGA emergency contacts.');
  }
  if (actor.role === UserRole.DANDUME_SUPER_ADMIN && contact.scopeLgaId !== 'dandume') {
    throw new Error('Dandume Super Admin can only remove Dandume LGA emergency contacts.');
  }

  try {
    await deleteDoc(doc(db, 'emergency_contacts', contact.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `emergency_contacts/${contact.id}`);
  }

  await logEmergencyAudit(
    actor,
    'EMERGENCY_CONTACT_REMOVED',
    contact.id,
    `Removed emergency contact "${contact.name}" (${contact.phoneNumber}), scope=${contact.scopeLgaId}.`
  );
}
