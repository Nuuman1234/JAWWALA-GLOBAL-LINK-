import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  AccountStatus,
  DEFAULT_WHATSAPP_GROUP_NAME,
  PuOperationalStatus,
  UserRole,
  canAssignFieldUsers,
  canDeleteUsers,
  canManageDirectory,
  canManageSettings,
  canManageUsers,
  canViewAuditLogs,
  isValidWhatsAppInviteUrl,
  type AuditLog,
  type DirectoryImportSummary,
  type GlobalSettings,
  type LgaId,
  type PollingUnit,
  type PuAssignment,
  type UserAccount,
  type Ward,
} from '../types/fdmis';
import {
  getOfficialDirectoryDataset,
  getPuDocId,
  getWardDocId,
  toValidDocId,
  validateOfficialDirectory,
} from './officialDirectory';

function requireAuthUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated session required.');
  return uid;
}

async function writeAuditLog(
  actor: UserAccount,
  action: string,
  affectedEntity: string,
  affectedId: string,
  details: string
): Promise<void> {
  const auditRef = doc(collection(db, 'audit_logs'));
  try {
    await setDoc(auditRef, {
      actorUid: actor.uid,
      actorName: actor.displayName.slice(0, 120),
      actorEmail: actor.email.slice(0, 200),
      actorRole: actor.role,
      action: action.slice(0, 100),
      affectedEntity: affectedEntity.slice(0, 64),
      affectedId: affectedId.slice(0, 128),
      details: details.slice(0, 1000),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'audit_logs');
  }
}

export function observeWards(
  user: UserAccount,
  onData: (wards: Ward[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const base = collection(db, 'wards');
  let q: Query;

  if (user.role === UserRole.FULL_CONTROL_ADMIN) {
    q = base;
  } else if (user.role === UserRole.VERIFICATION_OFFICER) {
    if (!user.assignedLgaId) {
      q = base;
    } else {
      q = query(base, where('lgaId', '==', user.assignedLgaId));
    }
  } else if (user.role === UserRole.FUNTUA_SUPER_ADMIN) {
    q = query(base, where('lgaId', '==', 'funtua'));
  } else if (user.role === UserRole.DANDUME_SUPER_ADMIN) {
    q = query(base, where('lgaId', '==', 'dandume'));
  } else if (
    (user.role === UserRole.WARD_COORDINATOR || user.role === UserRole.POLLING_UNIT_AGENT) &&
    user.assignedLgaId
  ) {
    q = query(base, where('lgaId', '==', user.assignedLgaId));
  } else {
    onData([]);
    return () => {};
  }

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Ward, 'id'>) }))
        .filter((w) => {
          if (user.role === UserRole.VERIFICATION_OFFICER && user.assignedWardId) {
            return w.id === user.assignedWardId;
          }
          if (user.role === UserRole.WARD_COORDINATOR && user.assignedWardId) {
            return w.id === user.assignedWardId;
          }
          return true;
        })
        .sort(
          (a, b) =>
            a.lgaId.localeCompare(b.lgaId) ||
            a.wardCode.localeCompare(b.wardCode) ||
            a.name.localeCompare(b.name)
        );
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'wards');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function observePollingUnits(
  user: UserAccount,
  onData: (units: PollingUnit[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const base = collection(db, 'polling_units');
  let q: Query;

  if (user.role === UserRole.FULL_CONTROL_ADMIN) {
    q = base;
  } else if (user.role === UserRole.VERIFICATION_OFFICER) {
    if (user.assignedWardId) {
      q = query(base, where('wardId', '==', user.assignedWardId));
    } else if (user.assignedLgaId) {
      q = query(base, where('lgaId', '==', user.assignedLgaId));
    } else {
      q = base;
    }
  } else if (user.role === UserRole.FUNTUA_SUPER_ADMIN) {
    q = query(base, where('lgaId', '==', 'funtua'));
  } else if (user.role === UserRole.DANDUME_SUPER_ADMIN) {
    q = query(base, where('lgaId', '==', 'dandume'));
  } else if (user.role === UserRole.WARD_COORDINATOR && user.assignedWardId) {
    q = query(base, where('wardId', '==', user.assignedWardId));
  } else if (user.role === UserRole.POLLING_UNIT_AGENT) {
    q = query(base, where('assignedAgentUid', '==', user.uid));
  } else {
    onData([]);
    return () => {};
  }

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<PollingUnit, 'id'>) }))
        .sort(
          (a, b) =>
            a.lgaId.localeCompare(b.lgaId) ||
            a.wardName.localeCompare(b.wardName) ||
            a.puCode.localeCompare(b.puCode)
        );
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'polling_units');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function observePuAssignments(
  user: UserAccount,
  onData: (assignments: PuAssignment[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const base = collection(db, 'pu_assignments');
  let q: Query;

  if (user.role === UserRole.FULL_CONTROL_ADMIN) {
    q = base;
  } else if (user.role === UserRole.VERIFICATION_OFFICER) {
    if (user.assignedWardId) {
      q = query(base, where('wardId', '==', user.assignedWardId));
    } else if (user.assignedLgaId) {
      q = query(base, where('lgaId', '==', user.assignedLgaId));
    } else {
      q = base;
    }
  } else if (user.role === UserRole.FUNTUA_SUPER_ADMIN) {
    q = query(base, where('lgaId', '==', 'funtua'));
  } else if (user.role === UserRole.DANDUME_SUPER_ADMIN) {
    q = query(base, where('lgaId', '==', 'dandume'));
  } else if (user.role === UserRole.WARD_COORDINATOR && user.assignedWardId) {
    q = query(base, where('wardId', '==', user.assignedWardId));
  } else if (user.role === UserRole.POLLING_UNIT_AGENT) {
    q = query(base, where('agentUid', '==', user.uid));
  } else {
    onData([]);
    return () => {};
  }

  return onSnapshot(
    q,
    (snapshot) => {
      onData(snapshot.docs.map((d) => d.data() as PuAssignment));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'pu_assignments');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function observeUsers(
  user: UserAccount,
  onData: (users: UserAccount[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const base = collection(db, 'users');
  let q: Query;

  if (user.role === UserRole.FULL_CONTROL_ADMIN) {
    q = base;
  } else if (user.role === UserRole.FUNTUA_SUPER_ADMIN) {
    q = query(base, where('assignedLgaId', '==', 'funtua'));
  } else if (user.role === UserRole.DANDUME_SUPER_ADMIN) {
    q = query(base, where('assignedLgaId', '==', 'dandume'));
  } else if (user.role === UserRole.WARD_COORDINATOR && user.assignedWardId) {
    q = query(base, where('assignedWardId', '==', user.assignedWardId));
  } else {
    onData([]);
    return () => {};
  }

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => d.data() as UserAccount)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'users');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function observeAuditLogs(
  user: UserAccount,
  onData: (logs: AuditLog[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  if (!canViewAuditLogs(user.role)) {
    onData([]);
    return () => {};
  }

  const q = query(
    collection(db, 'audit_logs'),
    orderBy('createdAt', 'desc'),
    limit(200)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<AuditLog, 'id'>),
      }));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'audit_logs');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function importOfficialDirectory(
  actor: UserAccount
): Promise<DirectoryImportSummary> {
  const uid = requireAuthUid();
  if (actor.role !== UserRole.FULL_CONTROL_ADMIN) {
    throw new Error('Only the Full Control Admin can import the official INEC directory.');
  }

  const dataset = getOfficialDirectoryDataset();
  const validation = validateOfficialDirectory(dataset);
  if (!validation.isValid) {
    throw new Error(`Official directory integrity check failed: ${validation.errors.join('; ')}`);
  }

  let existingWardIds: Set<string>;
  try {
    const wardSnap = await getDocs(collection(db, 'wards'));
    existingWardIds = new Set(wardSnap.docs.map((d) => d.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'wards');
  }

  const missingWards = dataset.wards.filter(
    (w) => !existingWardIds.has(getWardDocId(w.lgaId, w.wardCode))
  );

  if (missingWards.length > 0) {
    const wardBatch = writeBatch(db);
    for (const w of missingWards) {
      const wardId = getWardDocId(w.lgaId, w.wardCode);
      wardBatch.set(doc(db, 'wards', wardId), {
        lgaId: w.lgaId,
        wardCode: w.wardCode,
        name: w.name,
        coordinatorUid: '',
        coordinatorName: '',
        expectedPollingUnits: w.expectedPollingUnits,
        isTestData: false,
        createdByUid: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    try {
      await wardBatch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'wards');
    }
  }

  let existingPuIds: Set<string>;
  try {
    const puSnap = await getDocs(collection(db, 'polling_units'));
    existingPuIds = new Set(puSnap.docs.map((d) => d.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'polling_units');
  }

  const missingPus = dataset.pollingUnits.filter(
    (pu) => !existingPuIds.has(getPuDocId(pu.puCode))
  );

  let funtuaImported = 0;
  let dandumeImported = 0;

  for (let i = 0; i < missingPus.length; i += 180) {
    const chunk = missingPus.slice(i, i + 180);
    const puBatch = writeBatch(db);
    for (const pu of chunk) {
      const puId = getPuDocId(pu.puCode);
      const wardId = getWardDocId(pu.lgaId, pu.wardCode);
      puBatch.set(doc(db, 'polling_units', puId), {
        lgaId: pu.lgaId,
        wardId,
        wardName: pu.wardName,
        puCode: pu.puCode,
        name: pu.name,
        locationDescription: `${pu.wardName} Ward · ${pu.status}`,
        coordinatesVerified: false,
        assignedAgentUid: '',
        assignedAgentName: '',
        operationalStatus: PuOperationalStatus.NOT_STARTED,
        registeredVoters: 0,
        puStatusLabel: pu.status,
        isMasterRecord: true,
        isTestData: false,
        createdByUid: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (pu.lgaId === 'funtua') funtuaImported += 1;
      if (pu.lgaId === 'dandume') dandumeImported += 1;
    }
    try {
      await puBatch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'polling_units');
    }
  }

  let verifiedFuntua = 0;
  let verifiedDandume = 0;
  try {
    const finalPuSnap = await getDocs(collection(db, 'polling_units'));
    for (const d of finalPuSnap.docs) {
      const lgaId = d.data().lgaId;
      if (lgaId === 'funtua') verifiedFuntua += 1;
      if (lgaId === 'dandume') verifiedDandume += 1;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'polling_units');
  }

  const totalVerified = verifiedFuntua + verifiedDandume;
  const countsVerified = verifiedFuntua >= 298 && verifiedDandume >= 177;

  await writeAuditLog(
    actor,
    'OFFICIAL_DIRECTORY_IMPORTED',
    'polling_units',
    dataset.datasetVersion,
    `Imported ${missingWards.length} missing wards and ${funtuaImported + dandumeImported} polling units (Funtua: ${verifiedFuntua}, Dandume: ${verifiedDandume}).`
  );

  return {
    datasetVersion: dataset.datasetVersion,
    wardsImported: missingWards.length,
    funtuaNewlyImported: funtuaImported,
    dandumeNewlyImported: dandumeImported,
    totalVerifiedInDatabase: totalVerified,
    funtuaVerifiedInDatabase: verifiedFuntua,
    dandumeVerifiedInDatabase: verifiedDandume,
    countsVerified,
  };
}

export async function createWard(
  actor: UserAccount,
  input: { lgaId: LgaId; wardCode: string; name: string; expectedPollingUnits: number }
): Promise<void> {
  const uid = requireAuthUid();
  if (actor.role !== UserRole.FULL_CONTROL_ADMIN) {
    throw new Error('Only Full Control Admin can add official wards.');
  }

  const cleanCode = input.wardCode.trim().toUpperCase().slice(0, 32);
  const cleanName = input.name.trim().slice(0, 120);
  if (!cleanCode || cleanName.length < 2) {
    throw new Error('Ward code and ward name (min 2 characters) are required.');
  }

  const wardId = getWardDocId(input.lgaId, cleanCode);
  try {
    await setDoc(doc(db, 'wards', wardId), {
      lgaId: input.lgaId,
      wardCode: cleanCode,
      name: cleanName,
      coordinatorUid: '',
      coordinatorName: '',
      expectedPollingUnits: Math.max(0, Math.min(500, Math.floor(input.expectedPollingUnits))),
      isTestData: false,
      createdByUid: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `wards/${wardId}`);
  }

  await writeAuditLog(
    actor,
    'WARD_CREATED',
    'wards',
    wardId,
    `Created ward ${cleanCode} (${cleanName}) in ${input.lgaId.toUpperCase()}.`
  );
}

export async function assignWardCoordinator(
  actor: UserAccount,
  ward: Ward,
  coordinator: UserAccount | null
): Promise<void> {
  requireAuthUid();
  if (actor.role !== UserRole.FULL_CONTROL_ADMIN) {
    throw new Error('Only Full Control Admin can assign Ward Coordinators on master ward records.');
  }

  const wardRef = doc(db, 'wards', ward.id);
  try {
    await updateDoc(wardRef, {
      coordinatorUid: coordinator ? coordinator.uid : '',
      coordinatorName: coordinator ? coordinator.displayName.slice(0, 120) : '',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `wards/${ward.id}`);
  }

  await writeAuditLog(
    actor,
    'WARD_COORDINATOR_ASSIGNED',
    'wards',
    ward.id,
    coordinator
      ? `Assigned ${coordinator.displayName} as Ward Coordinator for ${ward.name} (${ward.wardCode}).`
      : `Cleared Ward Coordinator assignment on ${ward.name} (${ward.wardCode}).`
  );
}

export async function createPollingUnit(
  actor: UserAccount,
  input: {
    lgaId: LgaId;
    ward: Ward;
    puCode: string;
    name: string;
    locationDescription: string;
    registeredVoters: number;
  }
): Promise<void> {
  const uid = requireAuthUid();
  if (actor.role !== UserRole.FULL_CONTROL_ADMIN) {
    throw new Error('Only Full Control Admin can add new polling unit records.');
  }

  const cleanCode = input.puCode.trim().toUpperCase().slice(0, 40);
  const cleanName = input.name.trim().slice(0, 160);
  if (cleanCode.length < 2 || cleanName.length < 2) {
    throw new Error('Valid Polling Unit Code and Name are required.');
  }

  const puId = toValidDocId(cleanCode);
  const existing = await getDocs(
    query(collection(db, 'polling_units'), where('puCode', '==', cleanCode))
  );
  if (!existing.empty) {
    throw new Error(`A polling unit with code ${cleanCode} already exists.`);
  }

  try {
    await setDoc(doc(db, 'polling_units', puId), {
      lgaId: input.lgaId,
      wardId: input.ward.id,
      wardName: input.ward.name.slice(0, 120),
      puCode: cleanCode,
      name: cleanName,
      locationDescription: input.locationDescription.trim().slice(0, 300),
      coordinatesVerified: false,
      assignedAgentUid: '',
      assignedAgentName: '',
      operationalStatus: PuOperationalStatus.NOT_STARTED,
      registeredVoters: Math.max(0, Math.min(50000, Math.floor(input.registeredVoters))),
      puStatusLabel: 'MANUAL ENTRY',
      isMasterRecord: false,
      isTestData: false,
      createdByUid: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `polling_units/${puId}`);
  }

  await writeAuditLog(
    actor,
    'POLLING_UNIT_CREATED',
    'polling_units',
    puId,
    `Added polling unit ${cleanCode} (${cleanName}) in ${input.ward.name} Ward.`
  );
}

/**
 * Atomic 1-to-1 Polling Unit assignment transaction.
 * Rejects assignment if the PU is already locked to another agent unless released first.
 */
export async function assignAgentToPollingUnit(
  actor: UserAccount,
  pu: PollingUnit,
  agent: UserAccount | null
): Promise<void> {
  const actorUid = requireAuthUid();
  if (!canAssignFieldUsers(actor.role)) {
    throw new Error('You are not authorized to assign polling unit agents.');
  }

  if (actor.role === UserRole.FUNTUA_SUPER_ADMIN && pu.lgaId !== 'funtua') {
    throw new Error('Funtua Super Admin cannot modify Dandume polling units.');
  }
  if (actor.role === UserRole.DANDUME_SUPER_ADMIN && pu.lgaId !== 'dandume') {
    throw new Error('Dandume Super Admin cannot modify Funtua polling units.');
  }
  if (actor.role === UserRole.WARD_COORDINATOR && pu.wardId !== actor.assignedWardId) {
    throw new Error('Ward Coordinator can only assign agents inside their assigned ward.');
  }

  const puRef = doc(db, 'polling_units', pu.id);
  const assignRef = doc(db, 'pu_assignments', pu.id);

  try {
    await runTransaction(db, async (tx) => {
      const puSnap = await tx.get(puRef);
      if (!puSnap.exists()) {
        throw new Error(`Polling unit ${pu.puCode} no longer exists.`);
      }
      const livePu = puSnap.data() as PollingUnit;
      const assignSnap = await tx.get(assignRef);
      const existingAssignment = assignSnap.exists() ? (assignSnap.data() as PuAssignment) : null;

      if (agent) {
        if (
          (existingAssignment && existingAssignment.agentUid !== agent.uid) ||
          (livePu.assignedAgentUid && livePu.assignedAgentUid !== agent.uid)
        ) {
          throw new Error(
            `Polling unit ${pu.puCode} is already assigned to ${existingAssignment?.agentName || livePu.assignedAgentName}. Use Controlled Reassignment or select an available Polling Unit.`
          );
        }

        // Release previous PU lock if this agent was already assigned elsewhere
        if (agent.assignedPollingUnitId && agent.assignedPollingUnitId !== pu.id) {
          const oldPuRef = doc(db, 'polling_units', agent.assignedPollingUnitId);
          const oldAssignRef = doc(db, 'pu_assignments', agent.assignedPollingUnitId);
          const oldPuSnap = await tx.get(oldPuRef);
          const oldAssignSnap = await tx.get(oldAssignRef);
          if (oldAssignSnap.exists() && (oldAssignSnap.data() as PuAssignment).agentUid === agent.uid) {
            tx.delete(oldAssignRef);
          }
          if (oldPuSnap.exists() && (oldPuSnap.data() as PollingUnit).assignedAgentUid === agent.uid) {
            const oldPuData = oldPuSnap.data() as PollingUnit;
            tx.update(oldPuRef, {
              assignedAgentUid: '',
              assignedAgentName: '',
              operationalStatus:
                oldPuData.operationalStatus === PuOperationalStatus.AGENT_ASSIGNED
                  ? PuOperationalStatus.NOT_STARTED
                  : oldPuData.operationalStatus,
              updatedAt: serverTimestamp(),
            });
          }
        }

        const nextStatus =
          livePu.operationalStatus === PuOperationalStatus.NOT_STARTED
            ? PuOperationalStatus.AGENT_ASSIGNED
            : livePu.operationalStatus;

        tx.update(puRef, {
          assignedAgentUid: agent.uid,
          assignedAgentName: agent.displayName.slice(0, 120),
          operationalStatus: nextStatus,
          updatedAt: serverTimestamp(),
        });

        if (!existingAssignment) {
          tx.set(assignRef, {
            puId: pu.id,
            puCode: pu.puCode.slice(0, 40),
            lgaId: pu.lgaId,
            wardId: pu.wardId,
            agentUid: agent.uid,
            agentName: agent.displayName.slice(0, 120),
            assignedByUid: actorUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        // Sync user's assignedPollingUnitId if they are a PU agent
        if (agent.role === UserRole.POLLING_UNIT_AGENT && agent.assignedPollingUnitId !== pu.id) {
          tx.update(doc(db, 'users', agent.uid), {
            assignedLgaId: pu.lgaId,
            assignedWardId: pu.wardId,
            assignedPollingUnitId: pu.id,
            updatedAt: serverTimestamp(),
          });
        }
      } else {
        // Clear assignment explicitly
        const nextStatus =
          livePu.operationalStatus === PuOperationalStatus.AGENT_ASSIGNED
            ? PuOperationalStatus.NOT_STARTED
            : livePu.operationalStatus;

        tx.update(puRef, {
          assignedAgentUid: '',
          assignedAgentName: '',
          operationalStatus: nextStatus,
          updatedAt: serverTimestamp(),
        });

        if (assignSnap.exists()) {
          tx.delete(assignRef);
        }

        if (livePu.assignedAgentUid) {
          const prevUserRef = doc(db, 'users', livePu.assignedAgentUid);
          const prevUserSnap = await tx.get(prevUserRef);
          if (
            prevUserSnap.exists() &&
            (prevUserSnap.data() as UserAccount).assignedPollingUnitId === pu.id
          ) {
            tx.update(prevUserRef, {
              assignedPollingUnitId: '',
              updatedAt: serverTimestamp(),
            });
          }
        }
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('already assigned')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `pu_assignments/${pu.id}`);
  }

  await writeAuditLog(
    actor,
    'POLLING_UNIT_AGENT_ASSIGNED',
    'polling_units',
    pu.id,
    agent
      ? `Assigned ${agent.displayName} to ${pu.puCode} (${pu.name}) with atomic pu_assignments lock.`
      : `Released field agent assignment on ${pu.puCode} (${pu.name}).`
  );
}

/**
 * Full Control Admin controlled reassignment of an already-occupied Polling Unit.
 */
export async function controlledReassignPollingUnit(
  actor: UserAccount,
  pu: PollingUnit,
  newAgent: UserAccount,
  reason: string
): Promise<void> {
  const actorUid = requireAuthUid();
  if (actor.role !== UserRole.FULL_CONTROL_ADMIN) {
    throw new Error('Only Full Control Admin can perform controlled polling unit reassignment.');
  }

  const cleanReason = reason.trim().slice(0, 400);
  if (cleanReason.length < 4) {
    throw new Error('An audit reason (min 4 characters) is required for controlled reassignment.');
  }

  const puRef = doc(db, 'polling_units', pu.id);
  const assignRef = doc(db, 'pu_assignments', pu.id);

  let previousAgentName = pu.assignedAgentName || 'None';

  try {
    await runTransaction(db, async (tx) => {
      const puSnap = await tx.get(puRef);
      if (!puSnap.exists()) throw new Error('Polling unit not found.');
      const livePu = puSnap.data() as PollingUnit;
      const assignSnap = await tx.get(assignRef);
      const prevAgentUid = assignSnap.exists()
        ? (assignSnap.data() as PuAssignment).agentUid
        : livePu.assignedAgentUid;
      previousAgentName = assignSnap.exists()
        ? (assignSnap.data() as PuAssignment).agentName
        : livePu.assignedAgentName || 'None';

      // Clear previous agent's user doc pointer if different
      if (prevAgentUid && prevAgentUid !== newAgent.uid) {
        const oldAgentSnap = await tx.get(doc(db, 'users', prevAgentUid));
        if (
          oldAgentSnap.exists() &&
          (oldAgentSnap.data() as UserAccount).assignedPollingUnitId === pu.id
        ) {
          tx.update(doc(db, 'users', prevAgentUid), {
            assignedPollingUnitId: '',
            updatedAt: serverTimestamp(),
          });
        }
      }

      // If newAgent currently owns another PU, release that old PU lock atomically
      if (newAgent.assignedPollingUnitId && newAgent.assignedPollingUnitId !== pu.id) {
        const oldNewAgentPuRef = doc(db, 'polling_units', newAgent.assignedPollingUnitId);
        const oldNewAgentAssignRef = doc(db, 'pu_assignments', newAgent.assignedPollingUnitId);
        const [oldNewPuSnap, oldNewAssignSnap] = await Promise.all([
          tx.get(oldNewAgentPuRef),
          tx.get(oldNewAgentAssignRef),
        ]);
        if (oldNewAssignSnap.exists() && (oldNewAssignSnap.data() as PuAssignment).agentUid === newAgent.uid) {
          tx.delete(oldNewAgentAssignRef);
        }
        if (oldNewPuSnap.exists() && (oldNewPuSnap.data() as PollingUnit).assignedAgentUid === newAgent.uid) {
          const oldData = oldNewPuSnap.data() as PollingUnit;
          tx.update(oldNewAgentPuRef, {
            assignedAgentUid: '',
            assignedAgentName: '',
            operationalStatus:
              oldData.operationalStatus === PuOperationalStatus.AGENT_ASSIGNED
                ? PuOperationalStatus.NOT_STARTED
                : oldData.operationalStatus,
            updatedAt: serverTimestamp(),
          });
        }
      }

      const nextStatus =
        livePu.operationalStatus === PuOperationalStatus.NOT_STARTED
          ? PuOperationalStatus.AGENT_ASSIGNED
          : livePu.operationalStatus;

      tx.update(puRef, {
        assignedAgentUid: newAgent.uid,
        assignedAgentName: newAgent.displayName.slice(0, 120),
        operationalStatus: nextStatus,
        updatedAt: serverTimestamp(),
      });

      if (assignSnap.exists()) {
        tx.update(assignRef, {
          agentUid: newAgent.uid,
          agentName: newAgent.displayName.slice(0, 120),
          assignedByUid: actorUid,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(assignRef, {
          puId: pu.id,
          puCode: pu.puCode.slice(0, 40),
          lgaId: pu.lgaId,
          wardId: pu.wardId,
          agentUid: newAgent.uid,
          agentName: newAgent.displayName.slice(0, 120),
          assignedByUid: actorUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      tx.update(doc(db, 'users', newAgent.uid), {
        role:
          newAgent.role === UserRole.PENDING ? UserRole.POLLING_UNIT_AGENT : newAgent.role,
        status: AccountStatus.ACTIVE,
        assignedLgaId: pu.lgaId,
        assignedWardId: pu.wardId,
        assignedPollingUnitId: pu.id,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `pu_assignments/${pu.id}`);
  }

  await writeAuditLog(
    actor,
    'POLLING_UNIT_CONTROLLED_REASSIGNMENT',
    'pu_assignments',
    pu.id,
    `Controlled reassignment of ${pu.puCode}: ${previousAgentName} -> ${newAgent.displayName}. Reason: ${cleanReason}`
  );
}

export async function updateUserRoleAndScope(
  actor: UserAccount,
  target: UserAccount,
  updates: {
    role: UserRole;
    status: AccountStatus;
    assignedLgaId: string;
    assignedWardId: string;
    assignedPollingUnitId: string;
  }
): Promise<void> {
  const actorUid = requireAuthUid();
  if (!canManageUsers(actor.role)) {
    throw new Error('You do not have permission to manage user roles.');
  }

  if (target.uid === actor.uid && updates.role !== target.role) {
    throw new Error('Security policy: operators cannot modify their own role.');
  }

  if (actor.role !== UserRole.FULL_CONTROL_ADMIN) {
    const allowedLga = actor.role === UserRole.FUNTUA_SUPER_ADMIN ? 'funtua' : 'dandume';
    if (updates.assignedLgaId !== allowedLga) {
      throw new Error(`Area restriction: you can only assign users to ${allowedLga.toUpperCase()} LGA.`);
    }
    if (target.role === UserRole.FULL_CONTROL_ADMIN) {
      throw new Error('Cannot modify a Full Control Admin account.');
    }
    if (
      ![
        UserRole.VERIFICATION_OFFICER,
        UserRole.WARD_COORDINATOR,
        UserRole.POLLING_UNIT_AGENT,
        UserRole.PENDING,
      ].includes(updates.role)
    ) {
      throw new Error(
        'LGA Super Admins can only assign Verification Officer, Ward Coordinator, Polling Unit Agent, or Pending roles.'
      );
    }
  }

  const normalizedLga =
    updates.role === UserRole.FULL_CONTROL_ADMIN || updates.role === UserRole.PENDING
      ? ''
      : updates.role === UserRole.FUNTUA_SUPER_ADMIN
        ? 'funtua'
        : updates.role === UserRole.DANDUME_SUPER_ADMIN
          ? 'dandume'
          : updates.assignedLgaId;

  const normalizedWard =
    updates.role === UserRole.WARD_COORDINATOR ||
    updates.role === UserRole.POLLING_UNIT_AGENT ||
    updates.role === UserRole.VERIFICATION_OFFICER
      ? updates.assignedWardId
      : '';

  const normalizedPu =
    updates.role === UserRole.POLLING_UNIT_AGENT ? updates.assignedPollingUnitId : '';

  const userRef = doc(db, 'users', target.uid);

  try {
    await runTransaction(db, async (tx) => {
      // If a PU is being assigned to this user, ensure atomic 1-to-1 availability!
      if (normalizedPu) {
        const nextPuRef = doc(db, 'polling_units', normalizedPu);
        const nextAssignRef = doc(db, 'pu_assignments', normalizedPu);
        const [nextPuSnap, nextAssignSnap] = await Promise.all([
          tx.get(nextPuRef),
          tx.get(nextAssignRef),
        ]);
        if (!nextPuSnap.exists()) {
          throw new Error('Selected Polling Unit was not found in directory.');
        }
        const livePu = nextPuSnap.data() as PollingUnit;
        const existingAssign = nextAssignSnap.exists()
          ? (nextAssignSnap.data() as PuAssignment)
          : null;

        if (
          (existingAssign && existingAssign.agentUid !== target.uid) ||
          (livePu.assignedAgentUid && livePu.assignedAgentUid !== target.uid)
        ) {
          throw new Error(
            `Polling Unit ${livePu.puCode} is already assigned to ${existingAssign?.agentName || livePu.assignedAgentName}. Choose an unassigned Polling Unit.`
          );
        }

        // Release previous PU if the agent was previously on another PU
        if (target.assignedPollingUnitId && target.assignedPollingUnitId !== normalizedPu) {
          const prevPuRef = doc(db, 'polling_units', target.assignedPollingUnitId);
          const prevAssignRef = doc(db, 'pu_assignments', target.assignedPollingUnitId);
          const [prevPuSnap, prevAssignSnap] = await Promise.all([
            tx.get(prevPuRef),
            tx.get(prevAssignRef),
          ]);
          if (prevAssignSnap.exists() && (prevAssignSnap.data() as PuAssignment).agentUid === target.uid) {
            tx.delete(prevAssignRef);
          }
          if (prevPuSnap.exists() && (prevPuSnap.data() as PollingUnit).assignedAgentUid === target.uid) {
            const prevData = prevPuSnap.data() as PollingUnit;
            tx.update(prevPuRef, {
              assignedAgentUid: '',
              assignedAgentName: '',
              operationalStatus:
                prevData.operationalStatus === PuOperationalStatus.AGENT_ASSIGNED
                  ? PuOperationalStatus.NOT_STARTED
                  : prevData.operationalStatus,
              updatedAt: serverTimestamp(),
            });
          }
        }

        if (!existingAssign) {
          tx.set(nextAssignRef, {
            puId: normalizedPu,
            puCode: livePu.puCode.slice(0, 40),
            lgaId: livePu.lgaId,
            wardId: livePu.wardId,
            agentUid: target.uid,
            agentName: target.displayName.slice(0, 120),
            assignedByUid: actorUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        tx.update(nextPuRef, {
          assignedAgentUid: target.uid,
          assignedAgentName: target.displayName.slice(0, 120),
          operationalStatus:
            livePu.operationalStatus === PuOperationalStatus.NOT_STARTED
              ? PuOperationalStatus.AGENT_ASSIGNED
              : livePu.operationalStatus,
          updatedAt: serverTimestamp(),
        });
      } else if (
        target.assignedPollingUnitId &&
        updates.role !== UserRole.POLLING_UNIT_AGENT
      ) {
        // Role changed away from PU agent -> release previous PU lock
        const prevPuRef = doc(db, 'polling_units', target.assignedPollingUnitId);
        const prevAssignRef = doc(db, 'pu_assignments', target.assignedPollingUnitId);
        const [prevPuSnap, prevAssignSnap] = await Promise.all([
          tx.get(prevPuRef),
          tx.get(prevAssignRef),
        ]);
        if (prevAssignSnap.exists() && (prevAssignSnap.data() as PuAssignment).agentUid === target.uid) {
          tx.delete(prevAssignRef);
        }
        if (prevPuSnap.exists() && (prevPuSnap.data() as PollingUnit).assignedAgentUid === target.uid) {
          const prevData = prevPuSnap.data() as PollingUnit;
          tx.update(prevPuRef, {
            assignedAgentUid: '',
            assignedAgentName: '',
            operationalStatus:
              prevData.operationalStatus === PuOperationalStatus.AGENT_ASSIGNED
                ? PuOperationalStatus.NOT_STARTED
                : prevData.operationalStatus,
            updatedAt: serverTimestamp(),
          });
        }
      }

      tx.update(userRef, {
        role: updates.role,
        status: updates.status,
        assignedLgaId: normalizedLga,
        assignedWardId: normalizedWard,
        assignedPollingUnitId: normalizedPu,
        sessionRevoked: updates.status === AccountStatus.SUSPENDED,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('already assigned')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, `users/${target.uid}`);
  }

  if (actor.role === UserRole.FULL_CONTROL_ADMIN) {
    const adminRef = doc(db, 'admins', target.uid);
    if (updates.role === UserRole.FULL_CONTROL_ADMIN && updates.status === AccountStatus.ACTIVE) {
      try {
        await setDoc(adminRef, {
          uid: target.uid,
          email: target.email,
          grantedByUid: actorUid,
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `admins/${target.uid}`);
      }
    }
  }

  await writeAuditLog(
    actor,
    'USER_ROLE_AND_SCOPE_UPDATED',
    'users',
    target.uid,
    `Updated ${target.displayName} (${target.email}) -> role=${updates.role}, status=${updates.status}, lga=${normalizedLga || 'CONSTITUENCY'}, ward=${normalizedWard || 'ALL'}, pu=${normalizedPu || 'NONE'}.`
  );
}

/**
 * Suspending a user intentionally preserves their PU assignment and historical submissions.
 */
export async function revokeOrSuspendUser(
  actor: UserAccount,
  target: UserAccount,
  reason: string
): Promise<void> {
  requireAuthUid();
  if (!canManageUsers(actor.role)) {
    throw new Error('Not authorized to revoke user access.');
  }
  if (target.uid === actor.uid) {
    throw new Error('You cannot revoke your own active session.');
  }
  if (actor.role !== UserRole.FULL_CONTROL_ADMIN && target.role === UserRole.FULL_CONTROL_ADMIN) {
    throw new Error('Cannot revoke a Full Control Admin.');
  }

  const cleanReason = reason.trim().slice(0, 300);
  if (cleanReason.length < 4) {
    throw new Error('A revocation reason (at least 4 characters) is required for audit accountability.');
  }

  try {
    await updateDoc(doc(db, 'users', target.uid), {
      status: AccountStatus.SUSPENDED,
      sessionRevoked: true,
      revokedReason: cleanReason,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${target.uid}`);
  }

  await writeAuditLog(
    actor,
    'EMERGENCY_ACCESS_REVOCATION',
    'users',
    target.uid,
    `Suspended ${target.displayName} (${target.email}); PU assignment preserved (${target.assignedPollingUnitId || 'none'}). Reason: ${cleanReason}`
  );
}

export async function reactivateUser(
  actor: UserAccount,
  target: UserAccount
): Promise<void> {
  requireAuthUid();
  if (!canManageUsers(actor.role)) {
    throw new Error('Not authorized to reactivate user access.');
  }

  try {
    await updateDoc(doc(db, 'users', target.uid), {
      status: AccountStatus.ACTIVE,
      sessionRevoked: false,
      revokedReason: null,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${target.uid}`);
  }

  await writeAuditLog(
    actor,
    'ACCOUNT_REACTIVATED',
    'users',
    target.uid,
    `Cleared session revocation and reactivated ${target.displayName} (${target.email}).`
  );
}

/**
 * Permanent user deletion (Full Control Admin only).
 * Deletes users/{uid} (and admins/{uid} if any) and releases assigned Polling Unit lock in pu_assignments
 * & polling_units, while strictly preserving all historical check-ins, incidents, result submissions, and audit logs.
 */
export async function permanentlyDeleteUser(
  actor: UserAccount,
  target: UserAccount,
  reason: string
): Promise<void> {
  requireAuthUid();
  if (!canDeleteUsers(actor.role)) {
    throw new Error('Only the Full Control Admin can permanently delete user accounts.');
  }
  if (target.uid === actor.uid) {
    throw new Error('You cannot permanently delete your own active Full Control Admin account.');
  }

  const cleanReason = reason.trim().slice(0, 300);
  if (cleanReason.length < 4) {
    throw new Error('A permanent deletion reason (at least 4 characters) is required.');
  }

  const userRef = doc(db, 'users', target.uid);
  const adminRef = doc(db, 'admins', target.uid);

  try {
    await runTransaction(db, async (tx) => {
      const userSnap = await tx.get(userRef);
      const adminSnap = await tx.get(adminRef);
      const livePuId = userSnap.exists()
        ? (userSnap.data() as UserAccount).assignedPollingUnitId
        : target.assignedPollingUnitId;

      if (livePuId) {
        const puRef = doc(db, 'polling_units', livePuId);
        const assignRef = doc(db, 'pu_assignments', livePuId);
        const [puSnap, assignSnap] = await Promise.all([tx.get(puRef), tx.get(assignRef)]);

        if (assignSnap.exists() && (assignSnap.data() as PuAssignment).agentUid === target.uid) {
          tx.delete(assignRef);
        }
        if (puSnap.exists() && (puSnap.data() as PollingUnit).assignedAgentUid === target.uid) {
          const livePu = puSnap.data() as PollingUnit;
          tx.update(puRef, {
            assignedAgentUid: '',
            assignedAgentName: '',
            operationalStatus:
              livePu.operationalStatus === PuOperationalStatus.AGENT_ASSIGNED
                ? PuOperationalStatus.NOT_STARTED
                : livePu.operationalStatus,
            updatedAt: serverTimestamp(),
          });
        }
      }

      if (adminSnap.exists()) {
        tx.delete(adminRef);
      }
      if (userSnap.exists()) {
        tx.delete(userRef);
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${target.uid}`);
  }

  await writeAuditLog(
    actor,
    'USER_PERMANENTLY_DELETED',
    'users',
    target.uid,
    `Permanently deleted user ${target.displayName} (${target.email}) and released Polling Unit ${target.assignedPollingUnitId || 'none'}. Historical operational records preserved. Reason: ${cleanReason}`
  );
}

export async function updateGlobalSettings(
  actor: UserAccount,
  updates: Pick<
    GlobalSettings,
    | 'inactivityTimeoutMinutes'
    | 'mfaPrepared'
    | 'publicSummaryEnabled'
    | 'smsFallbackConfigured'
    | 'whatsappConfigured'
    | 'emailConfigured'
    | 'whatsappGroupName'
    | 'whatsappGroupUrl'
    | 'whatsappGroupEnabled'
  >
): Promise<void> {
  const uid = requireAuthUid();
  if (!canManageSettings(actor.role)) {
    throw new Error('Only Full Control Admin can modify global system settings.');
  }

  const timeout = Math.max(5, Math.min(480, Math.floor(updates.inactivityTimeoutMinutes)));
  const cleanGroupName = (updates.whatsappGroupName || DEFAULT_WHATSAPP_GROUP_NAME)
    .trim()
    .slice(0, 120);
  const cleanGroupUrl = (updates.whatsappGroupUrl ?? '').trim().slice(0, 400);
  const groupEnabled = updates.whatsappGroupEnabled ?? true;

  if (cleanGroupName.length < 1) {
    throw new Error('WhatsApp group name cannot be empty.');
  }
  if (cleanGroupUrl && !isValidWhatsAppInviteUrl(cleanGroupUrl)) {
    throw new Error(
      'WhatsApp group invitation link must be a valid https://chat.whatsapp.com/... URL.'
    );
  }
  if (groupEnabled && !cleanGroupUrl) {
    throw new Error('Provide a valid WhatsApp group invite URL or disable the group link.');
  }

  try {
    await updateDoc(doc(db, 'system_settings', 'global'), {
      inactivityTimeoutMinutes: timeout,
      mfaPrepared: updates.mfaPrepared,
      publicSummaryEnabled: updates.publicSummaryEnabled,
      smsFallbackConfigured: updates.smsFallbackConfigured,
      whatsappConfigured: updates.whatsappConfigured,
      emailConfigured: updates.emailConfigured,
      whatsappGroupName: cleanGroupName,
      whatsappGroupUrl: cleanGroupUrl,
      whatsappGroupEnabled: groupEnabled,
      updatedByUid: uid,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'system_settings/global');
  }

  await writeAuditLog(
    actor,
    'SYSTEM_SETTINGS_UPDATED',
    'system_settings',
    'global',
    `Updated inactivityTimeoutMinutes=${timeout}, mfaPrepared=${updates.mfaPrepared}, publicSummaryEnabled=${updates.publicSummaryEnabled}, whatsappGroupEnabled=${groupEnabled}, whatsappGroupName=${cleanGroupName}.`
  );
}

export { canManageDirectory };
