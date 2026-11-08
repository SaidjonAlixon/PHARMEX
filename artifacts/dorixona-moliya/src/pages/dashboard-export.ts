import ExcelJS from 'exceljs';
import type { Dashboard, InventoryItem } from '@workspace/api-client-react';
import { date, money, num, round2 } from '@/components/kit';
import { expiryDay, expiryDaysOf } from '@/pages/warehouse-shared';
import { profitOf, retailValueOf } from '@/pages/warehouse-export';

export type ExpiryDashItem = InventoryItem & { days: number };

const thin: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  left: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  bottom: { style: 'thin', color: { argb: 'FFB8C9D4' } },
  right: { style: 'thin', color: { argb: 'FFB8C9D4' } },
};

function sheetName(title: string) {
  return title.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'List';
}

function styleHeader(row: ExcelJS.Row, count: number) {
  row.height = 24;
  for (let i = 1; i <= count; i++) {
    const cell = row.getCell(i);
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13306E' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thin;
  }
}

function paint(cell: ExcelJS.Cell, fill?: string) {
  cell.border = thin;
  cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF13306E' } };
  cell.alignment = { vertical: 'middle', wrapText: false };
  if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
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

function fillExpirySheet(ws: ExcelJS.Worksheet, title: string, rows: ExpiryDashItem[], periodLabel: string) {
  const headers = ['#', 'Mahsulot', 'Ombor', 'Qoldiq', 'Tannarx jami', 'Qoʻyilgan narx', 'Olinadigan foyda', 'Yaroqlilik', 'Holat'];
  const widths = [5, 40, 14, 10, 16, 16, 16, 14, 22];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  metaRow(ws, `Bosh dashboard · ${title} · Davr: ${periodLabel} · ${rows.length} ta`, headers.length);
  const hr = ws.getRow(2);
  headers.forEach((h, i) => { hr.getCell(i + 1).value = h; });
  styleHeader(hr, headers.length);

  rows.forEach((x, idx) => {
    const fill = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF3F8FB';
    const status = x.days < 0
      ? `Muddati oʻtgan · ${Math.abs(x.days)} kun`
      : x.days === 0
        ? 'Muddati bugun tugaydi'
        : `Muddati ${x.days} kun qoldi`;
    const row = ws.addRow([
      idx + 1,
      x.productName,
      x.branchName,
      x.quantity,
      money(x.value),
      money(retailValueOf(x)),
      money(profitOf(x)),
      expiryDay(x.expiryDate) ? date(expiryDay(x.expiryDate)) : '—',
      status,
    ]);
    row.height = 22;
    row.eachCell((cell, col) => {
      paint(cell, fill);
      cell.alignment = {
        vertical: 'middle',
        horizontal: col === 1 || col === 4 ? 'center' : col >= 5 && col <= 7 ? 'right' : 'left',
      };
      if (x.days < 0 && col === 9) {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFC62F3A' } };
      }
    });
  });
}

export async function exportDashboardExcel(opts: {
  dashboard: Dashboard;
  periodLabel: string;
  branchLabel: string;
  expiring: ExpiryDashItem[];
  expired: ExpiryDashItem[];
}) {
  const { dashboard: d, periodLabel, branchLabel, expiring, expired } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PHARMEX';
  wb.created = new Date();

  // KPI sheet
  {
    const ws = wb.addWorksheet(sheetName('KPI'));
    ws.getColumn(1).width = 28;
    ws.getColumn(2).width = 22;
    metaRow(ws, `Bosh dashboard · KPI · ${branchLabel} · ${periodLabel}`, 2);
    const hr = ws.getRow(2);
    hr.getCell(1).value = 'Koʻrsatkich';
    hr.getCell(2).value = 'Qiymat (soʻm)';
    styleHeader(hr, 2);
    const kpis: [string, string | number | null | undefined][] = [
      ['Sotuv hajmi', d.totals.sales],
      ['Yalpi foyda', d.totals.grossProfit],
      ['Xarajatlar', d.totals.expenses],
      ['Pul qoldigʻi', d.totals.cashBalance],
      ['Tovar zaxirasi', d.totals.inventoryValue],
      ['Muddati oʻtgan qarz', d.totals.overdueDebt],
    ];
    kpis.forEach(([label, value], i) => {
      const row = ws.addRow([label, money(value)]);
      row.eachCell(cell => paint(cell, i % 2 ? 'FFF3F8FB' : 'FFFFFFFF'));
      row.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' };
    });
  }

  // Trend
  {
    const ws = wb.addWorksheet(sheetName('Savdo dinamikasi'));
    [14, 16, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    metaRow(ws, `Savdo va tannarx · ${periodLabel}`, 3);
    const hr = ws.getRow(2);
    ['Sana', 'Savdo', 'Tannarx'].forEach((h, i) => { hr.getCell(i + 1).value = h; });
    styleHeader(hr, 3);
    d.salesTrend.forEach((p, i) => {
      const row = ws.addRow([p.label, money(p.sales), money(p.cost)]);
      row.eachCell(cell => paint(cell, i % 2 ? 'FFF3F8FB' : 'FFFFFFFF'));
      row.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' };
      row.getCell(3).alignment = { vertical: 'middle', horizontal: 'right' };
    });
  }

  // Branches
  {
    const ws = wb.addWorksheet(sheetName('Filiallar'));
    const headers = ['Filial', 'Savdo', 'Yalpi foyda', 'Sof foyda', 'Pul qoldigʻi'];
    [22, 16, 16, 16, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    metaRow(ws, `Filiallar taqqoslanishi · ${periodLabel}`, headers.length);
    const hr = ws.getRow(2);
    headers.forEach((h, i) => { hr.getCell(i + 1).value = h; });
    styleHeader(hr, headers.length);
    d.branchComparison.forEach((b, i) => {
      const row = ws.addRow([b.name, money(b.sales), money(b.grossProfit), money(b.netProfit), money(b.cashBalance)]);
      row.eachCell((cell, col) => {
        paint(cell, i % 2 ? 'FFF3F8FB' : 'FFFFFFFF');
        if (col > 1) cell.alignment = { vertical: 'middle', horizontal: 'right' };
      });
    });
  }

  // Top products
  {
    const ws = wb.addWorksheet(sheetName('Top mahsulotlar'));
    const headers = ['Mahsulot', 'Miqdor', 'Savdo', 'Yalpi foyda'];
    [40, 12, 16, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    metaRow(ws, `Eng koʻp sotilganlar · ${periodLabel}`, headers.length);
    const hr = ws.getRow(2);
    headers.forEach((h, i) => { hr.getCell(i + 1).value = h; });
    styleHeader(hr, headers.length);
    d.topProducts.forEach((p, i) => {
      const row = ws.addRow([p.name, p.quantity, money(p.sales), money(p.grossProfit)]);
      row.eachCell((cell, col) => {
        paint(cell, i % 2 ? 'FFF3F8FB' : 'FFFFFFFF');
        if (col > 1) cell.alignment = { vertical: 'middle', horizontal: 'right' };
      });
    });
  }

  // Money flow
  {
    const ws = wb.addWorksheet(sheetName('Pul oqimi'));
    [18, 16, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    metaRow(ws, `Pul oqimi · ${periodLabel}`, 3);
    const hr = ws.getRow(2);
    ['Tur', 'Tushum', 'Chiqim'].forEach((h, i) => { hr.getCell(i + 1).value = h; });
    styleHeader(hr, 3);
    d.moneyFlow.forEach((p, i) => {
      const row = ws.addRow([p.label, money(p.inflow), money(p.outflow)]);
      row.eachCell((cell, col) => {
        paint(cell, i % 2 ? 'FFF3F8FB' : 'FFFFFFFF');
        if (col > 1) cell.alignment = { vertical: 'middle', horizontal: 'right' };
      });
    });
  }

  fillExpirySheet(wb.addWorksheet(sheetName('Muddati yaqin')), 'Muddati yaqin tovarlar', expiring, periodLabel);
  fillExpirySheet(wb.addWorksheet(sheetName('Muddati otgan')), 'Muddat eng koʻp oʻtgan tovarlar', expired, periodLabel);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Bosh_dashboard_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function buildExpiryLists(inventory: InventoryItem[]) {
  const withDays = inventory
    .filter(i => i.quantity > 0 && i.expiryDate)
    .map(i => {
      const days = expiryDaysOf(i.expiryDate);
      return days == null ? null : { ...i, days };
    })
    .filter((x): x is ExpiryDashItem => x != null);

  const expiring = withDays
    .filter(i => i.days >= 0 && i.days <= 90)
    .sort((a, b) => a.days - b.days);

  const expired = withDays
    .filter(i => i.days < 0)
    .sort((a, b) => a.days - b.days);

  return {
    expiring,
    expired,
    expiringValue: round2(expiring.reduce((s, i) => s + num(i.value), 0)),
    expiredValue: round2(expired.reduce((s, i) => s + num(i.value), 0)),
  };
}
