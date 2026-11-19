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
import {
  buildAutomaticReportData,
  computeAnalyticsDashboardMetrics,
  type AnalyticsDashboardMetrics,
  type AnalyticsDatasetInputs,
  type AnalyticsReportFilters,
  type CompiledAutomaticReport,
} from '../utils/analyticsReportsEngine';
import type { ReportExportContext } from '../utils/reportDocumentExport';
import type {
  ReportWorkerRequest,
  ReportWorkerResponse,
} from '../workers/reportProcessor.worker';
import { toValidDocId } from './officialDirectory';
import {
  enqueueOfflineSubmission,
  generateClientSubmissionId,
  purgeDeletedRecordsEverywhere,
} from './offlineQueue';

// --- DEDICATED WEB WORKER POOL FOR OFF-MAIN-THREAD REPORT PROCESSING ---

let sharedReportWorker: Worker | null = null;
let workerInitializationFailed = false;
let workerJobSeq = 0;

interface PendingWorkerJob {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

const pendingWorkerJobs = new Map<string, PendingWorkerJob>();

function serializeTimestampsForWorker<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString() as unknown as T;
  if (typeof value === 'object') {
    const maybeTs = value as { toDate?: () => Date; seconds?: number };
    if (typeof maybeTs.toDate === 'function') {
      try {
        return maybeTs.toDate().toISOString() as unknown as T;
      } catch {
        return null as unknown as T;
      }
    }
    if (Array.isArray(value)) {
      return value.map((item) => serializeTimestampsForWorker(item)) as unknown as T;
    }
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
      out[k] = serializeTimestampsForWorker(v);
    });
    return out as T;
  }
  return value;
}

function getReportProcessorWorker(): Worker | null {
  if (workerInitializationFailed || typeof Worker === 'undefined') return null;
  if (sharedReportWorker) return sharedReportWorker;

  try {
    const worker = new Worker(
      new URL('../workers/reportProcessor.worker.ts', import.meta.url),
      { type: 'module' }
    );
    worker.onmessage = (event: MessageEvent<ReportWorkerResponse>) => {
      const msg = event.data;
      if (!msg || !msg.id) return;
      const pending = pendingWorkerJobs.get(msg.id);
      if (!pending) return;
      pendingWorkerJobs.delete(msg.id);
      if (msg.ok) {
        pending.resolve(msg.result);
      } else {
        pending.reject(new Error(msg.error || 'Report worker failed.'));
      }
    };
    worker.onerror = () => {
      workerInitializationFailed = true;
      sharedReportWorker = null;
      pendingWorkerJobs.forEach((job) =>
        job.reject(new Error('Report worker encountered an error; falling back to main thread.'))
      );
      pendingWorkerJobs.clear();
    };
    sharedReportWorker = worker;
    return worker;
  } catch {
    workerInitializationFailed = true;
    return null;
  }
}

type DistributeOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function runReportWorkerJob<TResult>(
  payload: DistributeOmit<ReportWorkerRequest, 'id'>,
  signal?: AbortSignal
): Promise<TResult> {
  return new Promise<TResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Report processing was cancelled.', 'AbortError'));
      return;
    }

    const worker = getReportProcessorWorker();
    if (!worker) {
      reject(new Error('WEB_WORKER_UNAVAILABLE'));
      return;
    }

    workerJobSeq += 1;
    const id = `rjob_${Date.now()}_${workerJobSeq}`;

    const onAbort = () => {
      pendingWorkerJobs.delete(id);
      reject(new DOMException('Report processing was cancelled.', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    pendingWorkerJobs.set(id, {
      resolve: (val) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(val as TResult);
      },
      reject: (err) => {
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      },
    });

    try {
      worker.postMessage({ ...payload, id });
    } catch (err) {
      pendingWorkerJobs.delete(id);
      signal?.removeEventListener('abort', onAbort);
      reject(err instanceof Error ? err : new Error('Unable to dispatch worker job.'));
    }
  });
}

/**
 * Compiles any of the 12 FDMIS analytical reports inside a dedicated Web Worker
 * so large datasets never freeze the UI thread on mobile devices or Android WebView.
 * Automatically falls back to yielded main-thread computation if Workers are unavailable.
 */
export async function compileReportOffMainThread(
  inputs: AnalyticsDatasetInputs,
  filters: AnalyticsReportFilters,
  signal?: AbortSignal
): Promise<CompiledAutomaticReport> {
  const nowMs = Date.now();
  try {
    const cleanInputs = serializeTimestampsForWorker(inputs);
    return await runReportWorkerJob<CompiledAutomaticReport>(
      {
        type: 'COMPILE_REPORT',
        inputs: cleanInputs,
        filters,
        nowMs,
      },
      signal
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    await yieldToMainThread();
    assertNotAborted(signal);
    return buildAutomaticReportData(inputs, filters, nowMs);
  }
}

export async function computeMetricsOffMainThread(
  inputs: AnalyticsDatasetInputs,
  filters: Pick<
    AnalyticsReportFilters,
    'startDateIso' | 'endDateIso' | 'lgaId' | 'wardId' | 'puId' | 'officerUid'
  >,
  signal?: AbortSignal
): Promise<AnalyticsDashboardMetrics> {
  const nowMs = Date.now();
  try {
    const cleanInputs = serializeTimestampsForWorker(inputs);
    return await runReportWorkerJob<AnalyticsDashboardMetrics>(
      {
        type: 'COMPUTE_METRICS',
        inputs: cleanInputs,
        filters,
        nowMs,
      },
      signal
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    await yieldToMainThread();
    assertNotAborted(signal);
    return computeAnalyticsDashboardMetrics(inputs, filters, nowMs);
  }
}

async function preparePdfRowChunksOffMainThread(
  rows: (string | number)[][],
  chunkSize: number,
  signal?: AbortSignal
): Promise<string[][][]> {
  try {
    return await runReportWorkerJob<string[][][]>(
      {
        type: 'PREPARE_PDF_CHUNKS',
        rows,
        chunkSize,
      },
      signal
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    const chunks: string[][][] = [];
    for (let i = 0; i < rows.length; i += chunkSize) {
      chunks.push(
        rows.slice(i, i + chunkSize).map((r) =>
          r.map((c) => {
            const s = String(c ?? '');
            return s.length > 260 ? `${s.slice(0, 257)}...` : s;
          })
        )
      );
    }
    return chunks;
  }
}

export type AsyncPdfGenerationPhase =
  | 'preparing'
  | 'rendering_rows'
  | 'finalizing'
  | 'completed';

export interface AsyncPdfGenerationProgress {
  phase: AsyncPdfGenerationPhase;
  processedRows: number;
  totalRows: number;
  percent: number;
}

export interface AsyncPdfGenerationOptions {
  /** Number of table rows rendered per cooperative slice before yielding back to the UI thread. */
  chunkSize?: number;
  /** Automatically trigger a browser download once the PDF Blob is ready (default: true). */
  autoDownload?: boolean;
  /** Optional AbortSignal to cancel a long-running report generation cleanly. */
  signal?: AbortSignal;
  /** Optional progress callback fired between chunks. */
  onProgress?: (progress: AsyncPdfGenerationProgress) => void;
}

export interface AsyncPdfGenerationResult {
  fileName: string;
  bytes: Uint8Array;
  blob: Blob;
  pageCount: number;
  rowCount: number;
  durationMs: number;
  usedWebWorker: boolean;
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.setTimeout(resolve, 0);
      return;
    }
    setTimeout(resolve, 0);
  });
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('PDF report generation was cancelled.', 'AbortError');
  }
}

function sanitizePdfFileSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Generates large FDMIS PDF reports asynchronously by offloading row normalization/chunking
 * to a dedicated Web Worker and rendering PDF table chunks cooperatively so the UI thread
 * stays completely responsive on mobile devices and Android WebView.
 */
export async function generateLargeReportPdfAsync(
  report: CompiledAutomaticReport,
  ctx: ReportExportContext,
  options: AsyncPdfGenerationOptions = {}
): Promise<AsyncPdfGenerationResult> {
  const startedAt = Date.now();
  const chunkSize = Math.max(25, Math.min(500, Math.round(options.chunkSize ?? 120)));
  const autoDownload = options.autoDownload ?? true;
  const { signal, onProgress } = options;
  const totalRows = report.rows.length;

  assertNotAborted(signal);
  onProgress?.({ phase: 'preparing', processedRows: 0, totalRows, percent: 2 });

  // Offload row chunk normalization to the Web Worker in parallel with loading PDF modules
  const workerAvailable = !workerInitializationFailed && typeof Worker !== 'undefined';
  const [[{ jsPDF }, autoTableModule], preparedChunks] = await Promise.all([
    Promise.all([import('jspdf'), import('jspdf-autotable')]),
    totalRows > 0
      ? preparePdfRowChunksOffMainThread(report.rows, chunkSize, signal)
      : Promise.resolve([] as string[][][]),
  ]);
  const autoTable = autoTableModule.default;

  assertNotAborted(signal);

  const landscape = report.headers.length > 7;
  const doc = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 12;

  // Institutional Masthead Bar
  doc.setFillColor(11, 59, 36);
  doc.rect(0, 0, pageWidth, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(report.fdmisName, marginX, 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(report.reportTitle, marginX, 16.5);

  // Freshness metadata on top-right
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  const freshnessText = ctx.isLiveData
    ? 'SOURCE: LIVE DATABASE'
    : `SOURCE: OFFLINE CACHE (${ctx.lastSyncedLabel})`;
  doc.text(freshnessText, pageWidth - marginX, 10, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Generated: ${new Date(report.generatedAtIso).toLocaleString('en-NG')}`,
    pageWidth - marginX,
    16.5,
    { align: 'right' }
  );

  // Metadata Box
  doc.setTextColor(15, 23, 42);
  let cursorY = 28;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(marginX, cursorY, pageWidth - marginX * 2, 20, 2, 2, 'FD');

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Reporting Period:', marginX + 3, cursorY + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.text(report.reportingPeriodLabel, marginX + 34, cursorY + 5.5);

  doc.setFont('helvetica', 'bold');
  doc.text('Scope:', marginX + 3, cursorY + 11.5);
  doc.setFont('helvetica', 'normal');
  doc.text(report.scopeLabel.slice(0, 85), marginX + 18, cursorY + 11.5);

  doc.setFont('helvetica', 'bold');
  doc.text('Prepared By:', marginX + 3, cursorY + 17.5);
  doc.setFont('helvetica', 'normal');
  doc.text(ctx.generatedByName.slice(0, 50), marginX + 26, cursorY + 17.5);

  doc.setFont('helvetica', 'bold');
  doc.text('Data Status:', pageWidth / 2, cursorY + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.text(report.dataStatus.slice(0, 58), pageWidth / 2 + 22, cursorY + 5.5);

  doc.setFont('helvetica', 'bold');
  doc.text('Total Records:', pageWidth / 2, cursorY + 11.5);
  doc.setFont('helvetica', 'normal');
  doc.text(String(totalRows), pageWidth / 2 + 26, cursorY + 11.5);

  cursorY += 24;

  // Data Completeness Notice
  if (report.dataCompletenessNotice) {
    const noticeLines = doc.splitTextToSize(
      report.dataCompletenessNotice,
      pageWidth - marginX * 2 - 6
    );
    const boxHeight = Math.max(10, noticeLines.length * 4.2 + 5);
    doc.setFillColor(254, 243, 199);
    doc.setDrawColor(245, 158, 11);
    doc.roundedRect(marginX, cursorY, pageWidth - marginX * 2, boxHeight, 1.5, 1.5, 'FD');
    doc.setTextColor(120, 53, 15);
    doc.setFontSize(8);
    doc.text(noticeLines, marginX + 3, cursorY + 4.8);
    cursorY += boxHeight + 4;
  }

  // Summary Statistics Table
  if (report.summaryMetrics.length > 0) {
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('Key Operational Statistics', marginX, cursorY + 2);
    autoTable(doc, {
      startY: cursorY + 4,
      margin: { left: marginX, right: marginX },
      head: [['Metric', 'Actual Database Value']],
      body: report.summaryMetrics.map((m) => [m.label, String(m.value)]),
      theme: 'grid',
      headStyles: { fillColor: [11, 59, 36], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: [15, 23, 42] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });
    const lastY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY;
    cursorY = (lastY ?? cursorY + 24) + 6;
  }

  await yieldToMainThread();
  assertNotAborted(signal);

  // Main Report Table rendered in yielded slices
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Detailed Report Records', marginX, cursorY + 2);
  let tableCursorY = cursorY + 4;

  if (totalRows === 0) {
    autoTable(doc, {
      startY: tableCursorY,
      margin: { left: marginX, right: marginX },
      head: [report.headers],
      body: [['No matching operational records found in the database for the selected filters.']],
      theme: 'striped',
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 7.5 },
      bodyStyles: { fontSize: 7.5, textColor: [15, 23, 42] },
      styles: { cellPadding: 2, overflow: 'linebreak' },
    });
    onProgress?.({ phase: 'rendering_rows', processedRows: 0, totalRows: 0, percent: 85 });
  } else {
    let processedRows = 0;
    for (let idx = 0; idx < preparedChunks.length; idx += 1) {
      assertNotAborted(signal);
      const isFirstChunk = idx === 0;
      const slice = preparedChunks[idx];

      autoTable(doc, {
        startY: tableCursorY,
        margin: { left: marginX, right: marginX },
        head: isFirstChunk ? [report.headers] : undefined,
        body: slice,
        showHead: isFirstChunk ? 'everyPage' : 'never',
        theme: 'striped',
        headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 7.5 },
        bodyStyles: { fontSize: 7.5, textColor: [15, 23, 42] },
        styles: { cellPadding: 2, overflow: 'linebreak' },
      });

      const lastY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable
        ?.finalY;
      tableCursorY = lastY ?? tableCursorY;

      processedRows = Math.min(totalRows, processedRows + slice.length);
      const percent = Math.min(88, 10 + Math.round((processedRows / totalRows) * 78));
      onProgress?.({ phase: 'rendering_rows', processedRows, totalRows, percent });

      // Yield back to the main thread after each slice
      await yieldToMainThread();
    }
  }

  assertNotAborted(signal);
  onProgress?.({ phase: 'finalizing', processedRows: totalRows, totalRows, percent: 92 });

  // Page numbers footer applied in yielded batches for very large page counts
  const totalPages = doc.getNumberOfPages();
  const footerBatchSize = 50;
  for (let i = 1; i <= totalPages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `${report.fdmisName} — Internal Operational Report · Page ${i} of ${totalPages}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 6,
      { align: 'center' }
    );
    if (i % footerBatchSize === 0 && i < totalPages) {
      await yieldToMainThread();
      assertNotAborted(signal);
    }
  }

  await yieldToMainThread();
  assertNotAborted(signal);

  const arrBuf = doc.output('arraybuffer');
  const bytes = new Uint8Array(arrBuf);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const dateSlug = report.generatedAtIso.slice(0, 10);
  const fileName = `fdmis_${sanitizePdfFileSlug(report.reportCategory)}_${dateSlug}.pdf`;

  if (autoDownload) {
    triggerBlobDownload(blob, fileName);
  }

  onProgress?.({ phase: 'completed', processedRows: totalRows, totalRows, percent: 100 });

  return {
    fileName,
    bytes,
    blob,
    pageCount: totalPages,
    rowCount: totalRows,
    durationMs: Date.now() - startedAt,
    usedWebWorker: workerAvailable,
  };
}

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
  const uid = requireAuthUid();
  if (actor.role !== UserRole.FULL_CONTROL_ADMIN) {
    throw new Error('Only Full Control Admin can delete archived reports.');
  }
  try {
    await deleteDoc(doc(db, 'generated_reports', reportId));
    await setDoc(doc(db, 'deletion_tombstones', toValidDocId(reportId)), {
      recordId: reportId.slice(0, 128),
      collectionName: 'generated_reports',
      deletedByUid: uid,
      deletedByEmail: actor.email.slice(0, 200),
      reason: 'Archived report deleted by Full Control Admin',
      deletedAtIso: new Date().toISOString(),
      createdAt: serverTimestamp(),
    });
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
