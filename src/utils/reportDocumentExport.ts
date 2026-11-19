import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { CompiledAutomaticReport, WardPerformanceRow } from './analyticsReportsEngine';

export interface ReportExportContext {
  isLiveData: boolean;
  lastSyncedLabel: string;
  generatedByName: string;
}

function sanitizeFileSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

export function buildReportPdfDocument(
  report: CompiledAutomaticReport,
  ctx: ReportExportContext
): jsPDF {
  const landscape = report.headers.length > 7;
  const doc = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 12;

  // Institutional Masthead Bar
  doc.setFillColor(11, 59, 36); // FDMIS deep emerald #0b3b24
  doc.rect(0, 0, pageWidth, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(report.fdmisName, marginX, 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(report.reportTitle, marginX, 16.5);

  // Freshness pill text on top-right
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  const freshnessText = ctx.isLiveData ? 'SOURCE: LIVE DATABASE' : `SOURCE: OFFLINE CACHE (${ctx.lastSyncedLabel})`;
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
  doc.text(String(report.rows.length), pageWidth / 2 + 26, cursorY + 11.5);

  cursorY += 24;

  // Data Completeness / Unverified Notice
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

  // Main Report Table
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Detailed Report Records', marginX, cursorY + 2);

  autoTable(doc, {
    startY: cursorY + 4,
    margin: { left: marginX, right: marginX },
    head: [report.headers],
    body:
      report.rows.length > 0
        ? report.rows.map((r) => r.map((c) => String(c ?? '')))
        : [['No matching operational records found in the database for the selected filters.']],
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 7.5 },
    bodyStyles: { fontSize: 7.5, textColor: [15, 23, 42] },
    styles: { cellPadding: 2, overflow: 'linebreak' },
  });

  // Page numbers footer
  const totalPages = doc.getNumberOfPages();
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
  }

  return doc;
}

export function buildReportPdfBytes(
  report: CompiledAutomaticReport,
  ctx: ReportExportContext
): Uint8Array {
  const doc = buildReportPdfDocument(report, ctx);
  const arrBuf = doc.output('arraybuffer');
  return new Uint8Array(arrBuf);
}

export function exportReportToPdf(
  report: CompiledAutomaticReport,
  ctx: ReportExportContext
): string {
  const doc = buildReportPdfDocument(report, ctx);
  const dateSlug = report.generatedAtIso.slice(0, 10);
  const fileName = `fdmis_${sanitizeFileSlug(report.reportCategory)}_${dateSlug}.pdf`;
  doc.save(fileName);
  return fileName;
}

export function buildReportExcelWorkbook(
  report: CompiledAutomaticReport,
  wardPerformance: WardPerformanceRow[],
  ctx: ReportExportContext
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary & Metadata
  const summaryRows: (string | number)[][] = [
    ['System', report.fdmisName],
    ['Report Title', report.reportTitle],
    ['Report Category', report.reportCategory],
    ['Reporting Period', report.reportingPeriodLabel],
    ['Geographical Scope', report.scopeLabel],
    ['Generation Timestamp (UTC)', report.generatedAtIso],
    ['Prepared By', ctx.generatedByName],
    ['Data Freshness', ctx.isLiveData ? 'LIVE DATABASE' : `OFFLINE CACHE (${ctx.lastSyncedLabel})`],
    ['Data Status', report.dataStatus],
    ['Data Completeness Notice', report.dataCompletenessNotice],
    [],
    ['Key Operational Metric', 'Actual Value'],
    ...report.summaryMetrics.map((m) => [m.label, m.value]),
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 32 }, { wch: 68 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Report Summary');

  // Sheet 2: Report Data
  const dataSheetRows: (string | number)[][] = [
    report.headers,
    ...(report.rows.length > 0
      ? report.rows
      : [['No matching operational records found in database for selected filters.']]),
  ];
  const dataSheet = XLSX.utils.aoa_to_sheet(dataSheetRows);
  dataSheet['!cols'] = report.headers.map((h) => ({ wch: Math.max(14, Math.min(34, h.length + 6)) }));
  XLSX.utils.book_append_sheet(wb, dataSheet, 'Report Data');

  // Sheet 3: Ward Operational Performance Breakdown
  if (wardPerformance.length > 0) {
    const wardRows: (string | number)[][] = [
      [
        'Ward Code',
        'Ward Name',
        'LGA',
        'Total PUs',
        'Reporting PUs',
        'Non-Reporting PUs',
        'Reporting %',
        'Registered Agents',
        'Active Agents',
        'Ops Officers',
        'Min Required',
        'Tasks Assigned',
        'Tasks Completed',
        'Tasks Overdue',
        'Active Incidents',
        'Verified Results',
        'Unverified Results',
        'Completeness Status',
      ],
      ...wardPerformance.map((wp) => [
        wp.wardCode,
        wp.wardName,
        wp.lgaShortName,
        wp.totalPollingUnits,
        wp.reportingPollingUnits,
        wp.nonReportingPollingUnits,
        `${wp.reportingRatePercent}%`,
        wp.registeredAgents,
        wp.activeAgents,
        wp.operationsOfficersCount,
        wp.officerTarget,
        wp.tasksAssigned,
        wp.tasksCompleted,
        wp.tasksOverdue,
        wp.activeIncidents,
        wp.verifiedResultsCount,
        wp.unverifiedResultsCount,
        wp.completenessStatus,
      ]),
    ];
    const wardSheet = XLSX.utils.aoa_to_sheet(wardRows);
    wardSheet['!cols'] = Array.from({ length: 18 }, () => ({ wch: 16 }));
    XLSX.utils.book_append_sheet(wb, wardSheet, 'Ward Performance');
  }

  return wb;
}

export function buildReportExcelBytes(
  report: CompiledAutomaticReport,
  wardPerformance: WardPerformanceRow[],
  ctx: ReportExportContext
): Uint8Array {
  const wb = buildReportExcelWorkbook(report, wardPerformance, ctx);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Uint8Array(out);
}

export function exportReportToExcel(
  report: CompiledAutomaticReport,
  wardPerformance: WardPerformanceRow[],
  ctx: ReportExportContext
): string {
  const wb = buildReportExcelWorkbook(report, wardPerformance, ctx);
  const dateSlug = report.generatedAtIso.slice(0, 10);
  const fileName = `fdmis_${sanitizeFileSlug(report.reportCategory)}_${dateSlug}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return fileName;
}
