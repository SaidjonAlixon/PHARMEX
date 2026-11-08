import ExcelJS from 'exceljs';
import type { CashRegisterRow, MoneyTransaction } from '@workspace/api-client-react';
import { dateTime, money, num, round2 } from '@/components/kit';
import { moneyTypeLabels } from '@/lib/labels';

const REGISTER_HEADERS = [
  '#',
  'Hisob',
  'Turi',
  'Filial',
  'Boshlangʻich',
  'Kirim',
  'Chiqim',
  'Yakuniy',
  'Savdo tushumi',
  'Inkassatsiya',
  'Op.',
] as const;

const REGISTER_WIDTHS = [5, 28, 12, 22, 16, 14, 14, 16, 16, 14, 8];

const TX_HEADERS = [
  '#',
  'Sana-vaqt',
  'Operatsiya',
  'Hisob',
  'Filial',
  'Hamkor',
  'Hujjat / izoh',
  'Kirim',
  'Chiqim',
] as const;

const TX_WIDTHS = [5, 18, 18, 22, 18, 22, 28, 14, 14];

const thin: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  left: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  bottom: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  right: { style: 'thin', color: { argb: 'FFB8C9D4' } },
};

function sheetName(title: string) {
  return title.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'List';
}

function paint(cell: ExcelJS.Cell, fill?: string, align: 'left' | 'right' | 'center' = 'left') {
  cell.border = thin;
  cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF13306E' } };
  cell.alignment = { vertical: 'middle', horizontal: align, wrapText: false };
  if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
}

function styleHeader(row: ExcelJS.Row, count: number) {
  row.height = 26;
  for (let i = 1; i <= count; i++) {
    const cell = row.getCell(i);
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13306E' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thin;
  }
}

function metaRow(ws: ExcelJS.Worksheet, text: string, cols: number) {
  ws.mergeCells(1, 1, 1, cols);
  const c = ws.getCell(1, 1);
  c.value = text;
  c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF13306E' } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F7FA' } };
  c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 20;
}

function kindLabel(kind: CashRegisterRow['kind']) {
  return kind === 'cash' ? 'Naqd kassa' : 'Bank hisobi';
}

function fillRegisterSheet(
  ws: ExcelJS.Worksheet,
  title: string,
  rows: CashRegisterRow[],
  periodLabel: string,
  branchLabel: string,
) {
  REGISTER_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  metaRow(ws, `Kassa hisoboti · ${title} · ${branchLabel} · Davr: ${periodLabel} · ${rows.length} ta hisob · soʻm`, REGISTER_HEADERS.length);

  const hr = ws.getRow(2);
  REGISTER_HEADERS.forEach((h, i) => { hr.getCell(i + 1).value = h; });
  styleHeader(hr, REGISTER_HEADERS.length);

  if (!rows.length) {
    const empty = ws.addRow(['', 'Hisob yoʻq.']);
    empty.getCell(2).font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FF6B7C8A' } };
    return;
  }

  const sum = (pick: (r: CashRegisterRow) => string) => round2(rows.reduce((s, r) => s + num(pick(r)), 0));

  rows.forEach((r, idx) => {
    const fill = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF3F8FB';
    const row = ws.addRow([
      idx + 1,
      r.accountName,
      kindLabel(r.kind),
      r.branchName,
      money(r.openingBalance),
      money(r.inflow),
      money(r.outflow),
      money(r.closingBalance),
      money(r.cashSales),
      money(r.encashment),
      r.operations,
    ]);
    row.height = 22;
    row.eachCell((cell, col) => {
      paint(cell, fill, col === 1 || col === 11 ? 'center' : col >= 5 && col <= 10 ? 'right' : 'left');
    });
  });

  const total = ws.addRow([
    '',
    'Jami',
    '',
    '',
    money(sum(r => r.openingBalance)),
    money(sum(r => r.inflow)),
    money(sum(r => r.outflow)),
    money(sum(r => r.closingBalance)),
    money(sum(r => r.cashSales)),
    money(sum(r => r.encashment)),
    rows.reduce((s, r) => s + r.operations, 0),
  ]);
  total.height = 24;
  total.eachCell((cell, col) => {
    paint(cell, 'FFE8F7FA', col === 1 || col === 11 ? 'center' : col >= 5 && col <= 10 ? 'right' : 'left');
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF13306E' } };
  });
}

function fillTxSheet(ws: ExcelJS.Worksheet, title: string, rows: MoneyTransaction[], periodLabel: string) {
  TX_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  metaRow(ws, `Pul harakati · ${title} · Davr: ${periodLabel} · ${rows.length} ta operatsiya · soʻm`, TX_HEADERS.length);

  const hr = ws.getRow(2);
  TX_HEADERS.forEach((h, i) => { hr.getCell(i + 1).value = h; });
  styleHeader(hr, TX_HEADERS.length);

  if (!rows.length) {
    const empty = ws.addRow(['', 'Bu hisobda operatsiya yoʻq.']);
    empty.getCell(2).font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FF6B7C8A' } };
    return;
  }

  let inTotal = 0;
  let outTotal = 0;
  rows.forEach((t, idx) => {
    const fill = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF3F8FB';
    const kirim = t.direction === 'in' ? num(t.amount) : 0;
    const chiqim = t.direction === 'out' ? num(t.amount) : 0;
    inTotal += kirim;
    outTotal += chiqim;
    const note = [t.documentNo, t.note, t.category].filter(Boolean).join(' · ') || '—';
    const row = ws.addRow([
      idx + 1,
      dateTime(t.date),
      moneyTypeLabels[t.type] ?? t.type,
      t.accountName,
      t.branchName,
      t.counterpartyName || '—',
      note,
      kirim ? money(kirim) : '',
      chiqim ? money(chiqim) : '',
    ]);
    row.height = 22;
    row.eachCell((cell, col) => {
      paint(cell, fill, col === 1 ? 'center' : col >= 8 ? 'right' : 'left');
    });
  });

  const total = ws.addRow(['', 'Jami', '', '', '', '', '', money(round2(inTotal)), money(round2(outTotal))]);
  total.height = 24;
  total.eachCell((cell, col) => {
    paint(cell, 'FFE8F7FA', col === 1 ? 'center' : col >= 8 ? 'right' : 'left');
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF13306E' } };
  });
}

async function downloadWorkbook(wb: ExcelJS.Workbook, fileName: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportCashRegisterExcel(opts: {
  rows: CashRegisterRow[];
  periodLabel: string;
  branchLabel: string;
  title?: string;
  fileName?: string;
  transactions?: MoneyTransaction[];
}) {
  const {
    rows,
    periodLabel,
    branchLabel,
    title = 'Umumiy',
    fileName,
    transactions,
  } = opts;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'PHARMEX';
  wb.created = new Date();

  fillRegisterSheet(
    wb.addWorksheet(sheetName('Kassa hisoboti')),
    title,
    rows,
    periodLabel,
    branchLabel,
  );

  if (transactions) {
    fillTxSheet(
      wb.addWorksheet(sheetName('Pul harakati')),
      title,
      transactions,
      periodLabel,
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const safe = (fileName || `Kassa_hisoboti_${stamp}`).replace(/[\\/:*?"<>|]+/g, '_');
  await downloadWorkbook(wb, `${safe}.xlsx`);
}
