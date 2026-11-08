import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReceiptDetail } from '@workspace/api-client-react';
import { dateTime, money, num, qty, sourceText } from '@/components/kit';
import { paymentLabels } from '@/lib/labels';
import { ensurePdfFonts } from '@/pages/pdf-fonts';

const NAVY: [number, number, number] = [19, 48, 110];
const TEAL: [number, number, number] = [15, 179, 199];
const MUTED: [number, number, number] = [100, 116, 139];
const LINE: [number, number, number] = [226, 232, 240];
const GOOD: [number, number, number] = [18, 138, 67];
const BAD: [number, number, number] = [198, 47, 58];
const WARN: [number, number, number] = [165, 103, 10];

/** Compact amount for table cells — one line, no wrapping. */
function som(value: string | number | null | undefined) {
  if (value == null || value === '') return '—';
  return money(value).replace(/\s+/g, ' ').trim();
}

function statusInfo(detail: ReceiptDetail) {
  const r = detail.receipt;
  if (r.status === 'voided') return { label: 'Bekor qilingan', color: BAD };
  if (r.kind === 'return') return { label: 'Qaytarish', color: WARN };
  if (num(r.returnedAmount) > 0) return { label: 'Qisman qaytarilgan', color: WARN };
  return { label: 'Yakunlangan', color: GOOD };
}

function drawBadge(doc: jsPDF, x: number, y: number, text: string, color: [number, number, number]) {
  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(9);
  const w = doc.getTextWidth(text) + 10;
  const h = 7;
  doc.setFillColor(color[0], color[1], color[2]);
  doc.roundedRect(x, y - 5, w, h, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text(text, x + 5, y);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  return w;
}

function drawInfoCard(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
) {
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, y, w, h, 2, 2, 'FD');
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(label, x + 3.5, y + 5);
  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  const lines = doc.splitTextToSize((value || '—').replace(/\s+/g, ' '), w - 7);
  doc.text(lines.slice(0, 2), x + 3.5, y + 11);
}

export async function downloadReceiptPdf(detail: ReceiptDetail) {
  const r = detail.receipt;
  // Landscape — mahsulot jadvali ustunlari bir qatorda sigʻadi
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  await ensurePdfFonts(doc);

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - margin * 2;
  let y = 12;

  doc.setFillColor(TEAL[0], TEAL[1], TEAL[2]);
  doc.rect(0, 0, pageW, 3.5, 'F');

  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(TEAL[0], TEAL[1], TEAL[2]);
  doc.text('PHARMEX', margin, y);
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text('Savdo cheki · toʻliq koʻrinish', margin + 30, y);
  y += 9;

  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  const title = `Chek ${r.receiptNo}`;
  doc.text(title, margin, y);
  const status = statusInfo(detail);
  drawBadge(doc, margin + doc.getTextWidth(title) + 5, y - 1, status.label, status.color);
  y += 5.5;
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(dateTime(r.soldAt), margin, y);
  y += 7;

  const cards: [string, string][] = [
    ['Chek raqami', r.receiptNo],
    ['Sana va vaqt', dateTime(r.soldAt)],
    ['Filial', r.branchName],
    ['Kassir', r.cashier || '—'],
    ['Mijoz', r.customerName || '—'],
    ['Manba', sourceText(r.source)],
  ];
  if (r.originalReceiptNo) cards.push(['Asosiy chek', r.originalReceiptNo]);
  if (r.status === 'voided') cards.push(['Bekor qilindi', `${dateTime(r.voidedAt)} — ${r.voidReason || '—'}`]);
  if (r.note) cards.push([r.kind === 'return' ? 'Qaytarish sababi' : 'Izoh', r.note]);

  const cols = 4;
  const gap = 3;
  const cardW = (contentW - gap * (cols - 1)) / cols;
  const cardH = 16;
  cards.forEach((card, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    drawInfoCard(doc, margin + col * (cardW + gap), y + row * (cardH + gap), cardW, cardH, card[0], card[1]);
  });
  y += Math.ceil(cards.length / cols) * (cardH + gap) + 3;

  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text('Mahsulotlar', margin, y);
  y += 2;

  const body = detail.lines.map((l, idx) => {
    const product = l.productName.replace(/\s+/g, ' ').trim();
    const code = [l.productCode, l.unit].filter(Boolean).join(' · ');
    const vat = l.vatRate
      ? `${som(l.vatAmount)} (${l.vatRate}%)`
      : 'QQSsiz';
    return [
      String(idx + 1),
      code ? `${product}\n${code}` : product,
      qty(l.quantity),
      som(l.unitPrice),
      num(l.discount) ? som(l.discount) : '—',
      som(l.total),
      vat,
      som(l.cost),
      som(l.grossProfit),
    ];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['#', 'Mahsulot / kod', 'Miqdor', 'Narx', 'Chegirma', 'Summa', 'QQS', 'Tannarx', 'Foyda']],
    body,
    styles: {
      font: 'NotoSans',
      fontSize: 8,
      cellPadding: { top: 2.4, bottom: 2.4, left: 2, right: 2 },
      textColor: NAVY,
      lineColor: LINE,
      lineWidth: 0.2,
      valign: 'middle',
      overflow: 'linebreak',
      minCellHeight: 8,
    },
    headStyles: {
      font: 'NotoSans',
      fontStyle: 'bold',
      fontSize: 8,
      fillColor: NAVY,
      textColor: [255, 255, 255],
      halign: 'center',
      valign: 'middle',
      cellPadding: 2.5,
    },
    bodyStyles: {
      fontSize: 8,
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center', valign: 'middle' },
      1: { cellWidth: 78, halign: 'left', valign: 'middle' },
      2: { cellWidth: 16, halign: 'right', valign: 'middle', overflow: 'ellipsize' },
      3: { cellWidth: 28, halign: 'right', valign: 'middle', overflow: 'ellipsize' },
      4: { cellWidth: 24, halign: 'right', valign: 'middle', overflow: 'ellipsize' },
      5: { cellWidth: 28, halign: 'right', valign: 'middle', fontStyle: 'bold', overflow: 'ellipsize' },
      6: { cellWidth: 32, halign: 'right', valign: 'middle', overflow: 'ellipsize' },
      7: { cellWidth: 28, halign: 'right', valign: 'middle', overflow: 'ellipsize' },
      8: { cellWidth: 26, halign: 'right', valign: 'middle', textColor: GOOD, fontStyle: 'bold', overflow: 'ellipsize' },
    },
    alternateRowStyles: { fillColor: [243, 248, 251] },
    didParseCell: data => {
      // Number columns stay single-line
      if (data.section === 'body' && data.column.index >= 2) {
        data.cell.styles.overflow = 'ellipsize';
        const raw = String(data.cell.raw ?? data.cell.text);
        data.cell.text = [raw.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()];
      }
    },
  });

  y = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y) + 6;

  // Need space for bottom block — new page if tight
  const bottomNeed = 42;
  if (y + bottomNeed > pageH - 10) {
    doc.addPage();
    y = 14;
  }

  const leftW = contentW * 0.42;
  const rightX = margin + contentW * 0.48;
  const rightW = contentW * 0.52;

  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text('Toʻlovlar', margin, y);
  doc.text('Yakuniy hisob', rightX, y);

  let payY = y + 3;
  if (!r.payments.length) {
    doc.setFont('NotoSans', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text('Toʻlov yoʻq', margin, payY + 6);
    payY += 14;
  } else {
    for (const p of r.payments) {
      const method = paymentLabels[p.method] ?? p.method;
      const channel = (p.accountName || '—').replace(/\s+/g, ' ');
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, payY, leftW, 14, 2, 2, 'FD');
      doc.setFont('NotoSans', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
      doc.text(`${method} · ${channel}`, margin + 4, payY + 6);
      doc.setFontSize(11);
      const amt = som(p.amount);
      doc.text(amt, margin + leftW - 4 - doc.getTextWidth(amt), payY + 10.5);
      payY += 16;
    }
  }

  const totals: { label: string; value: string; strong?: boolean; tone?: 'good' | 'bad' }[] = [
    { label: 'Summa (chegirmagacha)', value: som(r.grossAmount) },
    { label: 'Chegirma', value: som(r.discount) },
    { label: 'Shu jumladan QQS', value: som(r.vatAmount) },
    { label: 'Jami', value: som(r.total), strong: true },
    { label: 'Tannarx', value: som(r.cost) },
    { label: 'Yalpi foyda', value: som(r.grossProfit), tone: 'good' },
  ];
  if (num(r.returnedAmount)) {
    totals.push({ label: 'Qaytarilgan', value: som(r.returnedAmount), tone: 'bad' });
  }

  const boxH = totals.length * 7.2 + 8;
  let totY = y + 3;
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(rightX, totY, rightW, boxH, 2, 2, 'FD');
  totY += 6;
  for (const row of totals) {
    doc.setFont('NotoSans', 'normal');
    doc.setFontSize(row.strong ? 10.5 : 9);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(row.label, rightX + 5, totY);
    if (row.tone === 'good') doc.setTextColor(GOOD[0], GOOD[1], GOOD[2]);
    else if (row.tone === 'bad') doc.setTextColor(BAD[0], BAD[1], BAD[2]);
    else if (row.strong) doc.setTextColor(GOOD[0], GOOD[1], GOOD[2]);
    else doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.setFont('NotoSans', 'bold');
    const tw = doc.getTextWidth(row.value);
    doc.text(row.value, rightX + rightW - 5 - tw, totY);
    totY += 7.2;
  }

  const bottom = Math.max(payY, totY) + 6;
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
  doc.line(margin, bottom, pageW - margin, bottom);
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(`PHARMEX · Chek PDF · ${new Date().toLocaleString('uz-UZ')}`, margin, bottom + 5);

  const safeNo = String(r.receiptNo).replace(/[\\/:*?"<>|]+/g, '_');
  doc.save(`Chek_${safeNo}.pdf`);
}
