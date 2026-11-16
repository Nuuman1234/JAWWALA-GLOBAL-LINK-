import {
  LGA_DEFINITIONS,
  formatFirestoreTime,
  type ApprovedPuResult,
  type IncidentReport,
  type LgaId,
  type ResultSubmission,
} from '../types/fdmis';

export function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(str) ? `'${str}` : str;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export interface CsvExportOptions {
  fileName: string;
  reportTitle: string;
  scopeLabel: string;
  dataStatus: string;
  disclaimer?: string;
  headers: string[];
  rows: (string | number | boolean | null | undefined)[][];
}

export function buildCsvString(
  options: CsvExportOptions,
  generatedAtIso: string = new Date().toISOString()
): string {
  const metadataRows: (string | number | boolean | null | undefined)[][] = [
    ['Report Title', options.reportTitle],
    ['Generated At (UTC)', generatedAtIso],
    ['Geographical Scope', options.scopeLabel],
    ['Data Status', options.dataStatus],
    ...(options.disclaimer ? [['Verification Notice', options.disclaimer]] : []),
    [],
    options.headers,
    ...options.rows,
  ];

  return metadataRows
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(','))
    .join('\r\n');
}

export function downloadStructuredCsv(options: CsvExportOptions): void {
  const csvBody = buildCsvString(options);
  const blob = new Blob(['\uFEFF' + csvBody], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = options.fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface DataManagementCsvMeta {
  viewMode: 'MARKED_TEST' | 'MANUAL_SELECTION';
  lgaFilter: 'all' | LgaId;
  searchQuery?: string;
  dateSlug?: string;
}

function formatScopeLabel(meta: DataManagementCsvMeta): string {
  const lgaLabel =
    meta.lgaFilter === 'all' ? 'All LGAs (Funtua & Dandume)' : LGA_DEFINITIONS[meta.lgaFilter].displayName;
  const modeLabel =
    meta.viewMode === 'MARKED_TEST' ? 'Marked Test Records Only' : 'All Scoped Records';
  const queryPart = meta.searchQuery?.trim() ? ` · Filter: "${meta.searchQuery.trim()}"` : '';
  return `${lgaLabel} · ${modeLabel}${queryPart}`;
}

export function buildDataManagementResultSubmissionsCsv(
  results: ResultSubmission[],
  meta: DataManagementCsvMeta
): CsvExportOptions {
  const dateSlug = meta.dateSlug || new Date().toISOString().slice(0, 10);
  const modeSlug = meta.viewMode === 'MARKED_TEST' ? 'test_only' : 'all_filtered';

  return {
    fileName: `fdmis_result_submissions_${modeSlug}_${meta.lgaFilter}_${dateSlug}.csv`,
    reportTitle: 'FDMIS Data Management — Filtered Election Result Submissions',
    scopeLabel: formatScopeLabel(meta),
    dataStatus: `${results.length} filtered result submission(s)`,
    disclaimer:
      'FDMIS Operational Export — Figures reflect current submission workflow state. Unverified submissions are NOT officially declared INEC results.',
    headers: [
      'Submission ID',
      'PU Code',
      'Polling Unit',
      'Ward',
      'LGA',
      'APC',
      'PDP',
      'ADC',
      'OTHERS',
      'Registered Voters',
      'Accredited Voters',
      'Valid Votes',
      'Rejected Votes',
      'Total Cast',
      'BVAS Status',
      'Verification Status',
      'Publicly Approved',
      'Submitted By',
      'Reviewed By',
      'Record Flag',
      'Updated At',
    ],
    rows: results.map((r) => [
      r.id,
      r.puCode,
      r.puName,
      r.wardName,
      LGA_DEFINITIONS[r.lgaId]?.shortName || r.lgaId,
      r.apcVotes ?? 0,
      r.pdpVotes ?? 0,
      r.adcVotes ?? 0,
      r.othersVotes ?? 0,
      r.registeredVoters,
      r.accreditedVoters,
      r.validVotes,
      r.rejectedVotes,
      r.totalVotesCast,
      r.bvasStatus,
      r.verificationStatus,
      r.publiclyApproved ? 'Yes' : 'No',
      r.submittedByName,
      r.reviewedByName || '-',
      r.isTestData ? 'TEST RECORD' : 'Operational',
      formatFirestoreTime(r.updatedAt),
    ]),
  };
}

export function buildDataManagementApprovedResultsCsv(
  approvedResults: ApprovedPuResult[],
  markedTestResultIds: Set<string>,
  meta: DataManagementCsvMeta
): CsvExportOptions {
  const dateSlug = meta.dateSlug || new Date().toISOString().slice(0, 10);
  const modeSlug = meta.viewMode === 'MARKED_TEST' ? 'test_only' : 'all_filtered';

  return {
    fileName: `fdmis_verified_results_${modeSlug}_${meta.lgaFilter}_${dateSlug}.csv`,
    reportTitle: 'FDMIS Data Management — Filtered Verified Polling Unit Results',
    scopeLabel: formatScopeLabel(meta),
    dataStatus: `${approvedResults.length} filtered verified polling unit result(s)`,
    disclaimer:
      'FDMIS Internally Verified — These figures represent internally verified operational records within FDMIS and are NOT officially declared INEC results.',
    headers: [
      'PU ID',
      'PU Code',
      'Polling Unit',
      'Ward',
      'LGA',
      'APC',
      'PDP',
      'ADC',
      'OTHERS',
      'Registered Voters',
      'Accredited Voters',
      'Valid Votes',
      'Rejected Votes',
      'Total Cast',
      'Submitted By',
      'Approved By',
      'Record Flag',
      'Approved At',
    ],
    rows: approvedResults.map((a) => [
      a.puId,
      a.puCode,
      a.puName,
      a.wardName,
      LGA_DEFINITIONS[a.lgaId]?.shortName || a.lgaId,
      a.apcVotes,
      a.pdpVotes,
      a.adcVotes,
      a.othersVotes,
      a.registeredVoters,
      a.accreditedVoters,
      a.validVotes,
      a.rejectedVotes,
      a.totalVotesCast,
      a.submittedByName,
      a.approvedByName,
      markedTestResultIds.has(a.sourceSubmissionId) ? 'LINKED TO TEST' : 'Verified Tally',
      formatFirestoreTime(a.approvedAt),
    ]),
  };
}

export function buildDataManagementIncidentsCsv(
  incidents: IncidentReport[],
  meta: DataManagementCsvMeta
): CsvExportOptions {
  const dateSlug = meta.dateSlug || new Date().toISOString().slice(0, 10);
  const modeSlug = meta.viewMode === 'MARKED_TEST' ? 'test_only' : 'all_filtered';

  return {
    fileName: `fdmis_incident_reports_${modeSlug}_${meta.lgaFilter}_${dateSlug}.csv`,
    reportTitle: 'FDMIS Data Management — Filtered Incident Reports',
    scopeLabel: formatScopeLabel(meta),
    dataStatus: `${incidents.length} filtered incident report(s)`,
    headers: [
      'Incident ID',
      'PU Code',
      'Polling Unit',
      'LGA',
      'Ward ID',
      'Category',
      'Title',
      'Description',
      'Urgency',
      'Workflow Status',
      'Reported By',
      'Escalated To',
      'Internal Notes',
      'Record Flag',
      'Created At',
    ],
    rows: incidents.map((i) => [
      i.id,
      i.puCode,
      i.puName,
      LGA_DEFINITIONS[i.lgaId]?.shortName || i.lgaId,
      i.wardId,
      i.category,
      i.title,
      i.description,
      i.urgency,
      i.status,
      i.reporterName,
      i.escalatedTo || '-',
      i.internalNotes || '-',
      i.isTestData ? 'TEST RECORD' : 'Operational',
      formatFirestoreTime(i.createdAt),
    ]),
  };
}

export type CsvPreviewDatasetKey = 'resultSubmissions' | 'verifiedResults' | 'incidentReports';

export interface CsvPreviewSlice {
  headers: string[];
  previewRows: (string | number | boolean | null | undefined)[][];
  totalRows: number;
  truncatedCount: number;
}

export function sliceCsvPreviewRows(
  options: CsvExportOptions,
  maxRows: number = 5
): CsvPreviewSlice {
  const safeLimit = Math.max(1, Math.floor(maxRows));
  const previewRows = options.rows.slice(0, safeLimit);
  return {
    headers: options.headers,
    previewRows,
    totalRows: options.rows.length,
    truncatedCount: Math.max(0, options.rows.length - previewRows.length),
  };
}

export function filterCsvExportColumns(
  options: CsvExportOptions,
  hiddenHeaders: ReadonlySet<string> | readonly string[]
): CsvExportOptions {
  const hiddenSet =
    hiddenHeaders instanceof Set ? hiddenHeaders : new Set(hiddenHeaders);

  if (hiddenSet.size === 0) {
    return options;
  }

  const keptIndices: number[] = [];
  const filteredHeaders: string[] = [];

  options.headers.forEach((header, idx) => {
    if (!hiddenSet.has(header)) {
      keptIndices.push(idx);
      filteredHeaders.push(header);
    }
  });

  return {
    ...options,
    headers: filteredHeaders,
    rows: options.rows.map((row) => keptIndices.map((idx) => row[idx])),
  };
}
