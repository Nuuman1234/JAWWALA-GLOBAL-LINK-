import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  UserRole,
  type GeneratedReportRecord,
  type LgaId,
  type OfflineQueuedItem,
  type UserAccount,
} from '../types/fdmis';
import type { AnalyticsReportFilters, CompiledAutomaticReport } from '../utils/analyticsReportsEngine';
import { toValidDocId } from './officialDirectory';
import {
  enqueueOfflineSubmission,
  generateClientSubmissionId,
  purgeDeletedRecordsEverywhere,
} from './offlineQueue';

function requireAuthUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated user session required.');
  return uid;
}

function toTimestampMs(val: unknown): number {
  if (!val) return 0;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'string') {
    const ms = Date.parse(val);
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof (val as { toMillis?: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  if (typeof (val as { seconds?: number }).seconds === 'number') {
    return (val as { seconds: number }).seconds * 1000;
  }
  return 0;
}

export function observeGeneratedReports(
  user: UserAccount,
  onData: (items: GeneratedReportRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const base = collection(db, 'generated_reports');
  let q: Query | null = null;

  if (user.role === UserRole.FULL_CONTROL_ADMIN) {
    q = base;
  } else if (user.role === UserRole.FUNTUA_SUPER_ADMIN) {
    q = query(base, where('lgaId', '==', 'funtua'));
  } else if (user.role === UserRole.DANDUME_SUPER_ADMIN) {
    q = query(base, where('lgaId', '==', 'dandume'));
  } else if (user.role === UserRole.VERIFICATION_OFFICER) {
    q = user.assignedLgaId
      ? query(base, where('lgaId', '==', user.assignedLgaId))
      : base;
  } else if (
    (user.role === UserRole.WARD_COORDINATOR || user.role === UserRole.OPERATIONS_OFFICER) &&
    user.assignedWardId
  ) {
    q = query(base, where('wardId', '==', user.assignedWardId));
  }

  if (!q) {
    onData([]);
    return () => {};
  }

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<GeneratedReportRecord, 'id'>) }))
        .sort((a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt))
        .slice(0, 100);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'generated_reports');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function archiveGeneratedReport(
  actor: UserAccount,
  report: CompiledAutomaticReport,
  filters: AnalyticsReportFilters,
  generationMode: 'AUTOMATIC_DAILY' | 'ON_DEMAND',
  existingClientSubmissionId?: string
): Promise<string> {
  const uid = requireAuthUid();
  const dateSlug = report.generatedAtIso.slice(0, 10).replace(/-/g, '');
  const scopedLga: 'all' | LgaId =
    actor.role === UserRole.FUNTUA_SUPER_ADMIN
      ? 'funtua'
      : actor.role === UserRole.DANDUME_SUPER_ADMIN
        ? 'dandume'
        : filters.lgaId;
  const scopedWard =
    actor.role === UserRole.WARD_COORDINATOR || actor.role === UserRole.OPERATIONS_OFFICER
      ? actor.assignedWardId
      : filters.wardId === 'all'
        ? ''
        : filters.wardId;

  const clientSubmissionId =
    existingClientSubmissionId ||
    (generationMode === 'AUTOMATIC_DAILY'
      ? `daily_sitrep_${dateSlug}_${scopedLga}_${scopedWard || 'all'}`
      : generateClientSubmissionId('rep'));

  const docId = toValidDocId(clientSubmissionId);
  const ref = doc(db, 'generated_reports', docId);

  let existingCreatedAt: unknown = null;
  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      if (generationMode === 'ON_DEMAND') return docId;
      existingCreatedAt = existing.data()?.createdAt ?? null;
    }
  } catch {
    // Proceed to write
  }

  const sanitizedSummaryMetrics: Record<string, string | number> = {};
  Object.entries(report.summaryMetricsMap).forEach(([k, v]) => {
    sanitizedSummaryMetrics[k.slice(0, 80)] =
      typeof v === 'number' ? v : String(v).slice(0, 160);
  });

  const payload = {
    reportCategory: report.reportCategory,
    reportTitle: report.reportTitle.slice(0, 180),
    reportingPeriodStartIso: report.reportingPeriodStartIso.slice(0, 40),
    reportingPeriodEndIso: report.reportingPeriodEndIso.slice(0, 40),
    lgaId: scopedLga,
    wardId: scopedWard.slice(0, 128),
    puId: (filters.puId === 'all' ? '' : filters.puId).slice(0, 128),
    officerUid: (filters.officerUid === 'all' ? '' : filters.officerUid).slice(0, 128),
    scopeLabel: report.scopeLabel.slice(0, 160),
    generatedByUid: uid,
    generatedByName: actor.displayName.slice(0, 120),
    generationMode,
    dataStatus: report.dataStatus.slice(0, 160),
    dataCompletenessNotice: report.dataCompletenessNotice.slice(0, 600),
    rowCount: Math.min(5000, Math.max(0, report.rows.length)),
    headers: report.headers.slice(0, 40).map((h) => String(h).slice(0, 64)),
    summaryMetrics: sanitizedSummaryMetrics,
    clientSubmissionId: docId,
    clientCreatedAtIso: report.generatedAtIso.slice(0, 64),
    serverSyncedAt: serverTimestamp(),
    createdAt: existingCreatedAt || serverTimestamp(),
  };

  try {
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `generated_reports/${docId}`);
  }

  return docId;
}

export async function deleteArchivedReport(
  actor: UserAccount,
  reportId: string
): Promise<void> {
  requireAuthUid();
  if (actor.role !== UserRole.FULL_CONTROL_ADMIN) {
    throw new Error('Only Full Control Admin can delete archived reports.');
  }
  try {
    await deleteDoc(doc(db, 'generated_reports', reportId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `generated_reports/${reportId}`);
  }
  await purgeDeletedRecordsEverywhere({ ids: [reportId] });
}

export async function enqueueReportArchiveOffline(
  actor: UserAccount,
  report: CompiledAutomaticReport,
  filters: AnalyticsReportFilters,
  generationMode: 'AUTOMATIC_DAILY' | 'ON_DEMAND'
): Promise<OfflineQueuedItem> {
  const scopedLga: 'all' | LgaId =
    actor.role === UserRole.FUNTUA_SUPER_ADMIN
      ? 'funtua'
      : actor.role === UserRole.DANDUME_SUPER_ADMIN
        ? 'dandume'
        : filters.lgaId;

  return enqueueOfflineSubmission({
    ownerUid: actor.uid,
    reportType: 'REPORT_ARCHIVE',
    puId: '',
    puCode: report.reportCategory,
    puName: report.reportTitle,
    lgaId: scopedLga,
    wardId: filters.wardId === 'all' ? '' : filters.wardId,
    summary: `Archive ${report.reportTitle} (${report.scopeLabel})`,
    payload: {
      report,
      filters,
      generationMode,
    },
    status: 'PENDING_SYNC',
  });
}
