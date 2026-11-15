function escapeCsvCell(value: unknown): string {
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

export function downloadStructuredCsv(options: CsvExportOptions): void {
  const generatedAt = new Date().toISOString();
  const metadataRows: (string | number | boolean | null | undefined)[][] = [
    ['Report Title', options.reportTitle],
    ['Generated At (UTC)', generatedAt],
    ['Geographical Scope', options.scopeLabel],
    ['Data Status', options.dataStatus],
    ...(options.disclaimer ? [['Verification Notice', options.disclaimer]] : []),
    [],
    options.headers,
    ...options.rows,
  ];

  const csvBody = metadataRows
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(','))
    .join('\r\n');

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
