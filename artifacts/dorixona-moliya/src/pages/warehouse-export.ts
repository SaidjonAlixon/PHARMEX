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

const COL_WIDTHS = [5, 38, 20, 14, 12, 10, 9, 16, 16, 18, 18, 18, 16, 24];

const thin: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  left: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  bottom: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  right: { style: 'thin', color: { argb: 'FFB8C9D4' } },
};

function som(value: number) {
  return money(value);
}

function applyDataCell(cell: ExcelJS.Cell, opts?: { align?: 'left' | 'right' | 'center'; bold?: boolean; fill?: string }) {
  cell.border = thin;
  cell.alignment = { vertical: 'middle', horizontal: opts?.align || 'left', wrapText: true };
  cell.font = { name: 'Calibri', size: 11, bold: !!opts?.bold, color: { argb: 'FF13306E' } };
  if (opts?.fill) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
  }
}

export async function exportWarehouseExcel(rows: InventoryItem[], sectionTitle: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PHARMEX';
  wb.created = new Date();

  const ws = wb.addWorksheet('Ombor', {
    views: [{ state: 'frozen', ySplit: 3 }],
    properties: { defaultRowHeight: 18 },
  });

  COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Title
  ws.mergeCells(1, 1, 1, HEADERS.length);
  const title = ws.getCell(1, 1);
  title.value = `PHARMEX · Ombor hisoboti — ${sectionTitle}`;
  title.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0FB3C7' } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 28;

  // Meta
  ws.mergeCells(2, 1, 2, HEADERS.length);
  const meta = ws.getCell(2, 1);
  const stamp = new Date().toLocaleString('uz-UZ');
  meta.value = `Sana: ${stamp} · Mahsulotlar: ${rows.length} ta · Pul birligi: soʻm`;
  meta.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF5A6B7A' } };
  meta.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F7FA' } };
  meta.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;

  // Header row
  const headerRow = ws.getRow(3);
  headerRow.height = 24;
  HEADERS.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13306E' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thin;
  });

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
    const fill = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF3F8FB';
    const row = ws.addRow([
      idx + 1,
      x.productName,
      x.manufacturer || '—',
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
    row.height = 20;
    row.eachCell((cell, col) => {
      const align = col === 1 || col === 6 || col === 7 ? 'center' : col >= 8 && col <= 12 ? 'right' : 'left';
      applyDataCell(cell, { align, fill });
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

  // JAMI row
  const totalRow = ws.addRow([
    '',
    `JAMI · ${sectionTitle}`,
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
    `Umumiy: tannarx ${som(costTotal)} · qoʻyilgan ${som(retailTotal)} · foyda ${som(profitTotal)}`,
  ]);
  totalRow.height = 26;
  totalRow.eachCell((cell, col) => {
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF0FB3C7' } },
      left: { style: 'thin', color: { argb: 'FF0FB3C7' } },
      bottom: { style: 'medium', color: { argb: 'FF0FB3C7' } },
      right: { style: 'thin', color: { argb: 'FF0FB3C7' } },
    };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9F5F8' } };
    cell.font = {
      name: 'Calibri',
      size: col === 2 || col >= 10 ? 12 : 11,
      bold: true,
      color: { argb: 'FF0A5F6B' },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: col >= 10 && col <= 12 ? 'right' : col === 7 ? 'center' : 'left',
      wrapText: true,
    };
  });

  // Footer note
  const noteRow = ws.addRow([]);
  ws.mergeCells(noteRow.number, 1, noteRow.number, HEADERS.length);
  const note = ws.getCell(noteRow.number, 1);
  note.value = 'Izoh: Qoldiq qiymati = qoldiq × tannarx. Qoʻyilgan narx jami = qoldiq × sotuv narxi. Olinadigan foyda = (sotuv − tannarx) × qoldiq. Barcha summalar soʻmda.';
  note.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF6B7C8A' } };
  note.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  ws.getRow(noteRow.number).height = 32;

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const day = new Date().toISOString().slice(0, 10);
  const safe = sectionTitle.replace(/[^\w\u0400-\u04FF\- ]+/g, '').trim().replace(/\s+/g, '_') || 'ombor';
  a.href = url;
  a.download = `Ombor_${safe}_${day}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
