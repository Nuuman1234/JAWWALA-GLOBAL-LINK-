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
  IncidentUrgency,
  UserRole,
  canManageEmergencyContacts,
  type EmergencyContact,
  type EmergencyReport,
  type EmergencyReportStatus,
  type EscalationRule,
  type LgaId,
  type UserAccount,
} from '../types/fdmis';
import { toValidDocId } from './officialDirectory';
import { generateClientSubmissionId } from './offlineQueue';

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

// --- STRUCTURED EMERGENCY ASSISTANCE REPORTS (SEPARATE FROM VERIFIED INCIDENTS) ---

function toMs(val: unknown): number {
  if (!val) return 0;
  if (val instanceof Date) return val.getTime();
  if (typeof (val as { toMillis?: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export function observeEmergencyReports(
  user: UserAccount,
  onData: (reports: EmergencyReport[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const base = collection(db, 'emergency_reports');
  let q: Query;

  if (user.role === UserRole.FULL_CONTROL_ADMIN) {
    q = base;
  } else if (user.role === UserRole.FUNTUA_SUPER_ADMIN) {
    q = query(base, where('lgaId', 'in', ['all', 'funtua']));
  } else if (user.role === UserRole.DANDUME_SUPER_ADMIN) {
    q = query(base, where('lgaId', 'in', ['all', 'dandume']));
  } else if (
    (user.role === UserRole.WARD_COORDINATOR || user.role === UserRole.OPERATIONS_OFFICER) &&
    user.assignedWardId
  ) {
    q = query(base, where('wardId', '==', user.assignedWardId));
  } else {
    q = query(base, where('reporterUid', '==', user.uid));
  }

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<EmergencyReport, 'id'>) }))
        .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
      onData(items);
    },
    (error) => {
      if (onError) onError(error instanceof Error ? error : new Error(String(error)));
    }
  );
}

export async function submitEmergencyReport(
  actor: UserAccount,
  input: {
    category: string;
    description: string;
    urgency: IncidentUrgency;
    lgaId: LgaId | 'all';
    wardId: string;
    puId: string;
    puCode: string;
    puName: string;
    latitude?: number | null;
    longitude?: number | null;
    clientCreatedAtIso?: string;
  },
  existingClientSubmissionId?: string
): Promise<string> {
  const uid = requireAuthUid();
  const cleanDesc = input.description.trim().slice(0, 1200);
  if (cleanDesc.length < 5) {
    throw new Error('Provide a brief emergency description (at least 5 characters).');
  }

  const clientSubmissionId = existingClientSubmissionId || generateClientSubmissionId('emg');
  const docId = toValidDocId(clientSubmissionId);

  const payload: Record<string, unknown> = {
    category: input.category.slice(0, 100),
    description: cleanDesc,
    urgency: input.urgency,
    status: 'SUBMITTED',
    lgaId: input.lgaId,
    wardId: (input.wardId || '').slice(0, 128),
    puId: (input.puId || '').slice(0, 128),
    puCode: (input.puCode || '').slice(0, 40),
    puName: (input.puName || '').slice(0, 160),
    reporterUid: uid,
    reporterName: actor.displayName.slice(0, 120),
    reporterPhone: (actor.phone || '').slice(0, 30),
    assignedResponderUid: '',
    assignedResponderName: '',
    resolutionNotes: '',
    clientSubmissionId: docId,
    clientCreatedAtIso: (input.clientCreatedAtIso || new Date().toISOString()).slice(0, 64),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (typeof input.latitude === 'number' && typeof input.longitude === 'number') {
    payload.latitude = input.latitude;
    payload.longitude = input.longitude;
  }

  try {
    await setDoc(doc(db, 'emergency_reports', docId), payload);
    // Notify Situation Room & LGA admins immediately
    await setDoc(doc(db, 'notifications', toValidDocId(`emg_notif_${docId}`)), {
      title: `EMERGENCY ASSISTANCE [${input.urgency}]: ${input.category}`,
      body: `${actor.displayName} (${input.puCode || input.lgaId}): ${cleanDesc.slice(0, 260)}`,
      type: 'EMERGENCY_ASSISTANCE',
      targetLgaId: input.lgaId,
      targetWardId: input.wardId || '',
      isCritical: input.urgency === IncidentUrgency.CRITICAL || input.urgency === IncidentUrgency.HIGH,
      isTestData: false,
      createdByUid: uid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `emergency_reports/${docId}`);
  }

  await logEmergencyAudit(
    actor,
    'EMERGENCY_ASSISTANCE_SUBMITTED',
    docId,
    `Submitted ${input.urgency} emergency assistance request (${input.category}) for ${input.puCode || input.lgaId}.`
  );

  return docId;
}

export async function updateEmergencyReportStatus(
  actor: UserAccount,
  report: EmergencyReport,
  updates: {
    status: EmergencyReportStatus;
    assignedResponderUid?: string;
    assignedResponderName?: string;
    resolutionNotes: string;
  }
): Promise<void> {
  requireAuthUid();
  if (!canManageEmergencyContacts(actor.role)) {
    throw new Error('Only authorized administrators can assign responders or resolve emergency reports.');
  }

  try {
    await updateDoc(doc(db, 'emergency_reports', report.id), {
      status: updates.status,
      assignedResponderUid: (updates.assignedResponderUid ?? report.assignedResponderUid).slice(0, 128),
      assignedResponderName: (updates.assignedResponderName ?? report.assignedResponderName).slice(0, 120),
      resolutionNotes: updates.resolutionNotes.trim().slice(0, 1200),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `emergency_reports/${report.id}`);
  }

  await logEmergencyAudit(
    actor,
    'EMERGENCY_ASSISTANCE_UPDATED',
    report.id,
    `Updated emergency report (${report.category}) to ${updates.status}. Responder=${updates.assignedResponderName || 'Unassigned'}.`
  );
}

// --- SMART ESCALATION RULES (ADMIN CONFIGURABLE) ---

export function observeEscalationRules(
  user: UserAccount,
  onData: (rules: EscalationRule[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!canManageEmergencyContacts(user.role)) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    collection(db, 'escalation_rules'),
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<EscalationRule, 'id'>) }))
        .sort((a, b) => a.ruleName.localeCompare(b.ruleName));
      onData(items);
    },
    (error) => {
      if (onError) onError(error instanceof Error ? error : new Error(String(error)));
    }
  );
}

export async function saveEscalationRule(
  actor: UserAccount,
  input: Omit<EscalationRule, 'id' | 'updatedByUid' | 'updatedAt'>,
  existingId?: string
): Promise<string> {
  const uid = requireAuthUid();
  if (actor.role !== UserRole.FULL_CONTROL_ADMIN) {
    throw new Error('Only Full Control Admin can configure alert escalation rules.');
  }
  const ref = existingId
    ? doc(db, 'escalation_rules', existingId)
    : doc(collection(db, 'escalation_rules'));

  try {
    await setDoc(ref, {
      ruleName: input.ruleName.trim().slice(0, 120),
      triggerType: input.triggerType,
      priority: input.priority,
      responsibleRole: input.responsibleRole,
      escalateAfterMinutes: Math.max(5, Math.min(1440, Math.round(input.escalateAfterMinutes))),
      recipientRole: input.recipientRole,
      maxNotificationsPerHour: Math.max(1, Math.min(60, Math.round(input.maxNotificationsPerHour))),
      enabled: Boolean(input.enabled),
      updatedByUid: uid,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `escalation_rules/${ref.id}`);
  }

  await logEmergencyAudit(
    actor,
    'ESCALATION_RULE_SAVED',
    ref.id,
    `Saved escalation rule "${input.ruleName}" (${input.triggerType}, ${input.escalateAfterMinutes}m -> ${input.recipientRole}).`
  );
  return ref.id;
}

export async function deleteEscalationRule(actor: UserAccount, ruleId: string): Promise<void> {
  requireAuthUid();
  if (actor.role !== UserRole.FULL_CONTROL_ADMIN) {
    throw new Error('Only Full Control Admin can delete escalation rules.');
  }
  try {
    await deleteDoc(doc(db, 'escalation_rules', ruleId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `escalation_rules/${ruleId}`);
  }
}

