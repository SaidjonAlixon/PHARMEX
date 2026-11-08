import ExcelJS from 'exceljs';
import type { InventoryItem } from '@workspace/api-client-react';
import { date, money, num, qty, round2, unitLabel } from '@/components/kit';
import { expiryDay, expiryDaysOf } from '@/pages/warehouse-shared';

export function retailValueOf(i: InventoryItem) {
  return round2(Math.max(0, i.quantity) * num(i.retailPrice));
}

/** (sotuv − tannarx) × qoldiq — qolgan tovardan olinadigan foyda. */
export function profitOf(i: InventoryItem) {
  const q = Math.max(0, i.quantity);
  return round2((num(i.retailPrice) - num(i.costPrice)) * q);
}

export type WarehouseExcelSheet = {
  title: string;
  rows: InventoryItem[];
};

const HEADERS = [
  '#',
  'Mahsulot',
  'Ishlab chiqaruvchi',
  'Shtrix-kod',
  'Ombor',
  'Qoldiq',
  'Birlik',
  '1 dona tannarx',
  '1 dona sotuv',
  'Qoldiq qiymati',
  'Qoʻyilgan narx jami',
  'Olinadigan foyda',
  'Yaroqlilik sanasi',
  'Yaroqlilik holati',
] as const;

/** Wide enough so product / manufacturer / money totals stay fully readable. */
const COL_WIDTHS = [5, 44, 36, 16, 12, 10, 9, 18, 18, 24, 24, 24, 16, 26];

const thin: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  left: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  bottom: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  right: { style: 'thin', color: { argb: 'FFB8C9D4' } },
};

function som(value: number) {
  return money(value);
}

function sheetName(title: string) {
  const clean = title.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
  return (clean || 'List').slice(0, 31);
}

function wrapLines(text: string, colWidth: number) {
  const s = String(text || '');
  if (!s) return 1;
  // Excel width ≈ characters; keep a bit of slack for Cyrillic.
  const perLine = Math.max(12, Math.floor(colWidth * 0.95));
  let lines = 0;
  for (const part of s.split(/\r?\n/)) {
    lines += Math.max(1, Math.ceil(part.length / perLine));
  }
  return lines;
}

function applyDataCell(cell: ExcelJS.Cell, opts?: { align?: 'left' | 'right' | 'center'; fill?: string; wrap?: boolean }) {
  cell.border = thin;
  cell.alignment = {
    vertical: 'middle',
    horizontal: opts?.align || 'left',
    wrapText: opts?.wrap ?? false,
    shrinkToFit: false,
  };
  cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF13306E' } };
  if (opts?.fill) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
  }
}

function fillSheet(ws: ExcelJS.Worksheet, sectionTitle: string, rows: InventoryItem[]) {
  COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  ws.properties.defaultRowHeight = 20;

  ws.mergeCells(1, 1, 1, HEADERS.length);
  const title = ws.getCell(1, 1);
  title.value = `PHARMEX · Ombor hisoboti — ${sectionTitle}`;
  title.font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0FB3C7' } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, HEADERS.length);
  const meta = ws.getCell(2, 1);
  const stamp = new Date().toLocaleString('uz-UZ');
  meta.value = `Sana: ${stamp} · Mahsulotlar: ${rows.length} ta · Pul birligi: soʻm`;
  meta.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF5A6B7A' } };
  meta.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F7FA' } };
  meta.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;

  const headerRow = ws.getRow(3);
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
    const empty = ws.addRow(['', 'Bu boʻlimda mahsulot yoʻq.']);
    empty.getCell(2).font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FF6B7C8A' } };
    return;
  }

  const costTotal = round2(rows.reduce((s, x) => s + num(x.value), 0));
  const retailTotal = round2(rows.reduce((s, x) => s + retailValueOf(x), 0));
  const profitTotal = round2(rows.reduce((s, x) => s + profitOf(x), 0));

  rows.forEach((x, idx) => {
    const days = expiryDaysOf(x.expiryDate);
    let yaroqlilik = '—';
    if (days != null) {
      if (days < 0) yaroqlilik = `Muddati oʻtgan · ${Math.abs(days)} kun`;
      else if (days === 0) yaroqlilik = 'Muddati bugun tugaydi';
      else yaroqlilik = `Muddati ${days} kun qoldi`;
    }
    const profit = profitOf(x);
    const product = x.productName || '—';
    const maker = x.manufacturer || '—';
    const fill = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF3F8FB';
    const row = ws.addRow([
      idx + 1,
      product,
      maker,
      x.barcode || '—',
      x.branchName,
      qty(x.quantity),
      unitLabel(x.unit),
      som(num(x.costPrice)),
      som(num(x.retailPrice)),
      som(num(x.value)),
      som(retailValueOf(x)),
      som(profit),
      expiryDay(x.expiryDate) ? date(expiryDay(x.expiryDate)) : '—',
      yaroqlilik,
    ]);

    const productLines = wrapLines(product, COL_WIDTHS[1]);
    const makerLines = wrapLines(maker, COL_WIDTHS[2]);
    const statusLines = wrapLines(yaroqlilik, COL_WIDTHS[13]);
    row.height = Math.max(22, Math.min(72, Math.max(productLines, makerLines, statusLines) * 15));

    row.eachCell((cell, col) => {
      const wrap = col === 2 || col === 3 || col === 14;
      const align = col === 1 || col === 6 || col === 7 ? 'center' : col >= 8 && col <= 12 ? 'right' : 'left';
      applyDataCell(cell, { align, fill, wrap });
      if (col === 12) {
        cell.font = {
          name: 'Calibri',
          size: 11,
          bold: true,
          color: { argb: profit < 0 ? 'FFC62F3A' : 'FF128A43' },
        };
      }
      if (days != null && days < 0 && col === 14) {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFC62F3A' } };
      }
    });
  });

  const totalRowNum = ws.addRow([
    `JAMI · ${sectionTitle}`,
    '',
    '',
    '',
    '',
    '',
    `${rows.length} ta`,
    '',
    '',
    som(costTotal),
    som(retailTotal),
    som(profitTotal),
    '',
    '',
  ]).number;
  ws.mergeCells(totalRowNum, 1, totalRowNum, 5);
  const totalRow = ws.getRow(totalRowNum);
  totalRow.getCell(1).value = `JAMI · ${sectionTitle}`;
  totalRow.height = 32;
  for (let col = 1; col <= HEADERS.length; col++) {
    const cell = totalRow.getCell(col);
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF0FB3C7' } },
      left: { style: 'thin', color: { argb: 'FF0FB3C7' } },
      bottom: { style: 'medium', color: { argb: 'FF0FB3C7' } },
      right: { style: 'thin', color: { argb: 'FF0FB3C7' } },
    };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9F5F8' } };
    cell.font = {
      name: 'Calibri',
      size: col === 1 || (col >= 10 && col <= 12) ? 12 : 11,
      bold: true,
      color: { argb: 'FF0A5F6B' },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: col >= 10 && col <= 12 ? 'right' : col === 7 ? 'center' : 'left',
      wrapText: false,
      shrinkToFit: false,
    };
  }

  const summaryRowNum = ws.addRow([]).number;
  ws.mergeCells(summaryRowNum, 1, summaryRowNum, HEADERS.length);
  const summary = ws.getCell(summaryRowNum, 1);
  summary.value = `Jami summa (soʻm):  Tannarx ${som(costTotal)}    |    Qoʻyilgan narx ${som(retailTotal)}    |    Olinadigan foyda ${som(profitTotal)}`;
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

  const noteRow = ws.addRow([]);
  ws.mergeCells(noteRow.number, 1, noteRow.number, HEADERS.length);
  const note = ws.getCell(noteRow.number, 1);
  note.value = 'Izoh: Qoldiq qiymati = qoldiq × tannarx. Qoʻyilgan narx jami = qoldiq × sotuv narxi. Olinadigan foyda = (sotuv − tannarx) × qoldiq. Barcha summalar soʻmda.';
  note.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF6B7C8A' } };
  note.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  ws.getRow(noteRow.number).height = 28;
}

async function downloadWorkbook(wb: ExcelJS.Workbook, fileLabel: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const day = new Date().toISOString().slice(0, 10);
  const safe = fileLabel.replace(/[^\w\u0400-\u04FF\- ]+/g, '').trim().replace(/\s+/g, '_') || 'ombor';
  a.href = url;
  a.download = `Ombor_${safe}_${day}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Single-section export, or multi-sheet when `sheets` is provided (Barchasi). */
export async function exportWarehouseExcel(
  rows: InventoryItem[],
  sectionTitle: string,
  options?: { sheets?: WarehouseExcelSheet[] },
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PHARMEX';
  wb.created = new Date();

  const extra = (options?.sheets || []).filter(s => s.rows.length > 0);
  if (extra.length) {
    // First sheet = full "Barchasi", then each section as its own list.
    const main = wb.addWorksheet(sheetName(sectionTitle));
    fillSheet(main, sectionTitle, rows);
    const used = new Set([sheetName(sectionTitle).toLowerCase()]);
    for (const part of extra) {
      let name = sheetName(part.title);
      let n = 2;
      while (used.has(name.toLowerCase())) {
        name = sheetName(`${part.title} ${n++}`);
      }
      used.add(name.toLowerCase());
      const ws = wb.addWorksheet(name);
      fillSheet(ws, part.title, part.rows);
    }
  } else {
    const ws = wb.addWorksheet(sheetName(sectionTitle));
    fillSheet(ws, sectionTitle, rows);
  }

  await downloadWorkbook(wb, sectionTitle);
}
