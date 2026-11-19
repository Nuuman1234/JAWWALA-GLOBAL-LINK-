/// <reference lib="webworker" />

import {
  buildAutomaticReportData,
  computeAnalyticsDashboardMetrics,
  type AnalyticsDashboardMetrics,
  type AnalyticsDatasetInputs,
  type AnalyticsReportFilters,
  type CompiledAutomaticReport,
} from '../utils/analyticsReportsEngine';

export type ReportWorkerRequest =
  | {
      id: string;
      type: 'COMPILE_REPORT';
      inputs: AnalyticsDatasetInputs;
      filters: AnalyticsReportFilters;
      nowMs: number;
    }
  | {
      id: string;
      type: 'COMPUTE_METRICS';
      inputs: AnalyticsDatasetInputs;
      filters: Pick<
        AnalyticsReportFilters,
        'startDateIso' | 'endDateIso' | 'lgaId' | 'wardId' | 'puId' | 'officerUid'
      >;
      nowMs: number;
    }
  | {
      id: string;
      type: 'PREPARE_PDF_CHUNKS';
      rows: (string | number)[][];
      chunkSize: number;
    };

export type ReportWorkerResponse =
  | { id: string; ok: true; type: 'COMPILE_REPORT'; result: CompiledAutomaticReport }
  | { id: string; ok: true; type: 'COMPUTE_METRICS'; result: AnalyticsDashboardMetrics }
  | { id: string; ok: true; type: 'PREPARE_PDF_CHUNKS'; result: string[][][] }
  | { id: string; ok: false; error: string };

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<ReportWorkerRequest>) => {
  const msg = event.data;
  if (!msg || !msg.id) return;

  try {
    if (msg.type === 'COMPILE_REPORT') {
      const result = buildAutomaticReportData(msg.inputs, msg.filters, msg.nowMs);
      const response: ReportWorkerResponse = {
        id: msg.id,
        ok: true,
        type: 'COMPILE_REPORT',
        result,
      };
      workerScope.postMessage(response);
      return;
    }

    if (msg.type === 'COMPUTE_METRICS') {
      const result = computeAnalyticsDashboardMetrics(msg.inputs, msg.filters, msg.nowMs);
      const response: ReportWorkerResponse = {
        id: msg.id,
        ok: true,
        type: 'COMPUTE_METRICS',
        result,
      };
      workerScope.postMessage(response);
      return;
    }

    if (msg.type === 'PREPARE_PDF_CHUNKS') {
      const size = Math.max(25, Math.min(500, Math.round(msg.chunkSize || 120)));
      const chunks: string[][][] = [];
      for (let i = 0; i < msg.rows.length; i += size) {
        const slice = msg.rows
          .slice(i, i + size)
          .map((row) =>
            row.map((cell) => {
              const str = String(cell ?? '');
              return str.length > 260 ? `${str.slice(0, 257)}...` : str;
            })
          );
        chunks.push(slice);
      }
      const response: ReportWorkerResponse = {
        id: msg.id,
        ok: true,
        type: 'PREPARE_PDF_CHUNKS',
        result: chunks,
      };
      workerScope.postMessage(response);
    }
  } catch (err) {
    const response: ReportWorkerResponse = {
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : 'Report worker processing failed.',
    };
    workerScope.postMessage(response);
  }
};
