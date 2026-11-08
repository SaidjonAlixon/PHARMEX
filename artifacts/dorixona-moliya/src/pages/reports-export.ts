import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Report } from '@workspace/api-client-react';
import { money } from '@/components/kit';
import { ensurePdfFonts } from '@/pages/pdf-fonts';

const NAVY: [number, number, number] = [19, 48, 110];
const TEAL: [number, number, number] = [15, 179, 199];
const MUTED: [number, number, number] = [100, 116, 139];
const LINE: [number, number, number] = [226, 232, 240];

const thin: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  left: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  bottom: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  right: { style: 'thin', color: { argb: 'FFB8C9D4' } },
};

function cellText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function sheetName(title: string) {
  return title.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Hisobot';
}

export async function exportReportExcel(opts: {
  report: Report;
  title: string;
  periodLabel: string;
  branchLabel: string;
}) {
  const { report, title, periodLabel, branchLabel } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PHARMEX';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName(title));
  const cols = report.columns;
  cols.forEach((_, i) => { ws.getColumn(i + 1).width = i === 0 ? 28 : 16; });
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  ws.mergeCells(1, 1, 1, Math.max(1, cols.length));
  const meta = ws.getCell(1, 1);
  meta.value = `PHARMEX · ${title} · ${branchLabel} · Davr: ${periodLabel} · ${report.rows.length} qator · Jami: ${money(report.total)}`;
  meta.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF13306E' } };
  meta.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F7FA' } };
  meta.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 22;

  const hr = ws.getRow(2);
  hr.height = 24;
  cols.forEach((h, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13306E' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thin;
  });

  report.rows.forEach((row, idx) => {
    const excelRow = ws.addRow(cols.map(c => cellText(row[c])));
    excelRow.height = 20;
    excelRow.eachCell(cell => {
      cell.border = thin;
      cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF13306E' } };
      cell.alignment = { vertical: 'middle', wrapText: false };
      if (idx % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F8FB' } };
    });
  });

  if (report.total != null) {
    const total = ws.addRow([`Jami: ${money(report.total)}`, ...Array(Math.max(0, cols.length - 1)).fill('')]);
    total.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF13306E' } };
    total.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F7FA' } };
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportReportPdf(opts: {
  report: Report;
  title: string;
  periodLabel: string;
  branchLabel: string;
}) {
  const { report, title, periodLabel, branchLabel } = opts;
  const landscape = report.columns.length > 6;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  await ensurePdfFonts(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 12;

  doc.setFillColor(TEAL[0], TEAL[1], TEAL[2]);
  doc.rect(0, 0, pageW, 3.5, 'F');

  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(TEAL[0], TEAL[1], TEAL[2]);
  doc.text('PHARMEX', margin, 12);
  doc.setFontSize(16);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text(title, margin, 20);
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(`${branchLabel} · Davr: ${periodLabel} · ${report.rows.length} qator · Jami: ${money(report.total)}`, margin, 26);

  autoTable(doc, {
    startY: 30,
    margin: { left: margin, right: margin },
    head: [report.columns],
    body: report.rows.map(row => report.columns.map(c => cellText(row[c]))),
    styles: {
      font: 'NotoSans',
      fontSize: landscape ? 7.5 : 8,
      cellPadding: 1.8,
      textColor: NAVY,
      lineColor: LINE,
      lineWidth: 0.15,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      font: 'NotoSans',
      fontStyle: 'bold',
      fillColor: NAVY,
      textColor: [255, 255, 255],
      halign: 'center',
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [243, 248, 251] },
  });

  const finalY = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 30) + 8;
  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text(`Jami: ${money(report.total)}`, margin, finalY);
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(`PHARMEX · Hisobot PDF · ${new Date().toLocaleString('uz-UZ')}`, margin, finalY + 6);

  doc.save(`${title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
