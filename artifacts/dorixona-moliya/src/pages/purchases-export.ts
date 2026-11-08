import ExcelJS from 'exceljs';
import type { Purchase } from '@workspace/api-client-react';
import { date, dateTime, money, num, round2 } from '@/components/kit';
import { purchaseStatusLabels } from '@/lib/labels';

export type PurchasesExcelSheet = {
  title: string;
  rows: Purchase[];
};

const HEADERS = [
  '#',
  'Hujjat',
  'Sana',
  'Yetkazib beruvchi',
  'Hisob-faktura',
  'EHF',
  'Filial',
  'Poz.',
  'Chegirma',
  'Qoʻshimcha xarajat',
  'Jami',
  'Toʻlangan',
  'Qoldiq',
  'Muddat',
  'Holat',
] as const;

const COL_WIDTHS = [5, 14, 18, 28, 16, 14, 16, 8, 14, 16, 16, 14, 14, 14, 16];

const thin: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  left: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  bottom: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  right: { style: 'thin', color: { argb: 'FFB8C9D4' } },
};

function som(value: string | number | null | undefined) {
  return money(value);
}

function sheetName(title: string) {
  const clean = title.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
  return (clean || 'List').slice(0, 31);
}

function applyDataCell(cell: ExcelJS.Cell, opts?: { align?: 'left' | 'right' | 'center'; fill?: string }) {
  cell.border = thin;
  cell.alignment = { vertical: 'middle', horizontal: opts?.align || 'left', wrapText: false };
  cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF13306E' } };
  if (opts?.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
}

function fillSheet(ws: ExcelJS.Worksheet, sectionTitle: string, rows: Purchase[], periodLabel: string) {
  COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  ws.mergeCells(1, 1, 1, HEADERS.length);
  const meta = ws.getCell(1, 1);
  meta.value = `Kirim · ${sectionTitle} · Davr: ${periodLabel} · ${rows.length} ta hujjat · soʻm`;
  meta.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF13306E' } };
  meta.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F7FA' } };
  meta.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 20;

  const headerRow = ws.getRow(2);
  headerRow.height = 26;
  HEADERS.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13306E' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thin;
  });

  if (!rows.length) {
    const empty = ws.addRow(['', 'Bu filtrda hujjat yoʻq.']);
    empty.getCell(2).font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FF6B7C8A' } };
    return;
  }

  const sum = (pick: (p: Purchase) => string) => round2(rows.reduce((s, p) => s + num(pick(p)), 0));
  const totalAmount = sum(p => p.totalAmount);
  const paidAmount = sum(p => p.paidAmount);
  const balance = sum(p => p.balance);
  const discount = sum(p => p.discount);
  const extra = sum(p => p.extraCosts);

  rows.forEach((p, idx) => {
    const status = purchaseStatusLabels[p.paymentStatus]?.label || p.paymentStatus;
    const fill = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF3F8FB';
    const row = ws.addRow([
      idx + 1,
      p.documentNo,
      dateTime(p.receivedAt),
      p.supplierName,
      p.invoiceNo || '—',
      p.eInvoiceId || '—',
      p.branchName,
      p.itemsCount,
      num(p.discount) ? som(p.discount) : '—',
      num(p.extraCosts) ? som(p.extraCosts) : '—',
      som(p.totalAmount),
      som(p.paidAmount),
      som(p.balance),
      date(p.dueDate),
      status,
    ]);
    row.height = 22;
    row.eachCell((cell, col) => {
      const align = col === 1 || col === 8 ? 'center' : col >= 9 && col <= 13 ? 'right' : 'left';
      applyDataCell(cell, { align, fill });
      if (col === 15 && p.paymentStatus === 'overdue') {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFC62F3A' } };
      }
      if (col === 13 && num(p.balance) > 0) {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFA8670A' } };
      }
    });
  });

  const totalRowNum = ws.addRow([
    `JAMI · ${sectionTitle}`,
    '', '', '', '', '', '',
    rows.length,
    som(discount),
    som(extra),
    som(totalAmount),
    som(paidAmount),
    som(balance),
    '',
    '',
  ]).number;
  ws.mergeCells(totalRowNum, 1, totalRowNum, 7);
  const totalRow = ws.getRow(totalRowNum);
  totalRow.getCell(1).value = `JAMI · ${sectionTitle}`;
  totalRow.height = 30;
  for (let col = 1; col <= HEADERS.length; col++) {
    const cell = totalRow.getCell(col);
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF0FB3C7' } },
      left: { style: 'thin', color: { argb: 'FF0FB3C7' } },
      bottom: { style: 'medium', color: { argb: 'FF0FB3C7' } },
      right: { style: 'thin', color: { argb: 'FF0FB3C7' } },
    };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9F5F8' } };
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0A5F6B' } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: col >= 8 && col <= 13 ? 'right' : 'left',
      wrapText: false,
    };
  }

  const summaryRowNum = ws.addRow([]).number;
  ws.mergeCells(summaryRowNum, 1, summaryRowNum, HEADERS.length);
  const summary = ws.getCell(summaryRowNum, 1);
  summary.value = `Jami (soʻm):  Summa ${som(totalAmount)}    |    Toʻlangan ${som(paidAmount)}    |    Qoldiq ${som(balance)}    |    Chegirma ${som(discount)}    |    Qoʻshimcha ${som(extra)}`;
  summary.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0A5F6B' } };
  summary.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F7FA' } };
  summary.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: false };
  summary.border = {
    top: { style: 'thin', color: { argb: 'FF0FB3C7' } },
    bottom: { style: 'thin', color: { argb: 'FF0FB3C7' } },
    left: { style: 'thin', color: { argb: 'FF0FB3C7' } },
    right: { style: 'thin', color: { argb: 'FF0FB3C7' } },
  };
  ws.getRow(summaryRowNum).height = 26;
}

async function downloadWorkbook(wb: ExcelJS.Workbook, fileLabel: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const day = new Date().toISOString().slice(0, 10);
  const safe = fileLabel.replace(/[^\w\u0400-\u04FF\- ]+/g, '').trim().replace(/\s+/g, '_') || 'kirim';
  a.href = url;
  a.download = `Kirim_${safe}_${day}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportPurchasesExcel(
  rows: Purchase[],
  sectionTitle: string,
  periodLabel: string,
  options?: { sheets?: PurchasesExcelSheet[] },
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PHARMEX';
  wb.created = new Date();

  const extra = (options?.sheets || []).filter(s => s.rows.length > 0);
  if (extra.length) {
    const main = wb.addWorksheet(sheetName(sectionTitle));
    fillSheet(main, sectionTitle, rows, periodLabel);
    const used = new Set([sheetName(sectionTitle).toLowerCase()]);
    for (const part of extra) {
      let name = sheetName(part.title);
      let n = 2;
      while (used.has(name.toLowerCase())) name = sheetName(`${part.title} ${n++}`);
      used.add(name.toLowerCase());
      fillSheet(wb.addWorksheet(name), part.title, part.rows, periodLabel);
    }
  } else {
    fillSheet(wb.addWorksheet(sheetName(sectionTitle)), sectionTitle, rows, periodLabel);
  }

  await downloadWorkbook(wb, sectionTitle);
}
