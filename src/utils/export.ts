import { NextResponse } from 'next/server';

const encoder = new TextEncoder();

const csvEscape = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

export const objectsToCsv = (
  rows: Array<Record<string, unknown>>,
  columns?: string[]
): string => {
  const headers = columns && columns.length > 0
    ? columns
    : Array.from(new Set(rows.flatMap((row) => Object.keys(row))));

  const lines: string[] = [headers.map(csvEscape).join(',')];

  for (const row of rows) {
    const line = headers.map((header) => csvEscape(row[header])).join(',');
    lines.push(line);
  }

  return lines.join('\n');
};

export const createCsvDownloadResponse = (
  csvContent: string,
  filename: string
): NextResponse => {
  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
};

const escapePdfText = (value: string): string => {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
};

export const buildSimplePdf = (title: string, lines: string[]): Uint8Array => {
  const safeLines = [title, ...lines]
    .map((line) => line.replace(/[^\x20-\x7E]/g, ' ').trim())
    .filter((line) => line.length > 0)
    .slice(0, 220);

  const contentParts: string[] = ['BT', '/F1 12 Tf', '50 770 Td'];
  for (let i = 0; i < safeLines.length; i++) {
    if (i > 0) contentParts.push('0 -16 Td');
    contentParts.push(`(${escapePdfText(safeLines[i])}) Tj`);
  }
  contentParts.push('ET');
  const contentStream = `${contentParts.join('\n')}\n`;
  const contentLength = encoder.encode(contentStream).length;

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${contentLength} >>\nstream\n${contentStream}endstream\nendobj\n`,
  ];

  const parts: string[] = ['%PDF-1.4\n'];
  const offsets: number[] = [0];

  for (const objectText of objects) {
    const current = parts.join('');
    offsets.push(encoder.encode(current).length);
    parts.push(objectText);
  }

const body = parts.join('');
  const xrefOffset = encoder.encode(body).length;

  const xrefLines: string[] = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
  ];

  for (let i = 1; i <= objects.length; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, '0')} 00000 n `);
  }

const trailer = [
    ...xrefLines,
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n');

  return encoder.encode(`${body}${trailer}`);
};

export const createPdfDownloadResponse = (
  pdfBytes: Uint8Array,
  filename: string
): NextResponse => {
  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
};
