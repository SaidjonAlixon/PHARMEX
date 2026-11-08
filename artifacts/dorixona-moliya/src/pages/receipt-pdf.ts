import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReceiptDetail } from '@workspace/api-client-react';
import { dateTime, money, num, qty, sourceText } from '@/components/kit';
import { paymentLabels } from '@/lib/labels';

const NAVY: [number, number, number] = [19, 48, 110];
const TEAL: [number, number, number] = [15, 179, 199];
const MUTED: [number, number, number] = [100, 116, 139];
const LINE: [number, number, number] = [226, 232, 240];
const GOOD: [number, number, number] = [18, 138, 67];
const BAD: [number, number, number] = [198, 47, 58];
const WARN: [number, number, number] = [165, 103, 10];

let fontReady: Promise<void> | null = null;
let fontCache: { regular: string; bold: string } | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function ensureFonts(doc: jsPDF) {
  if (!fontCache) {
    fontReady ??= (async () => {
      const [regular, bold] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}fonts/NotoSans-Regular.ttf`).then(r => {
          if (!r.ok) throw new Error('NotoSans-Regular topilmadi');
          return r.arrayBuffer();
        }),
        fetch(`${import.meta.env.BASE_URL}fonts/NotoSans-Bold.ttf`).then(r => {
          if (!r.ok) throw new Error('NotoSans-Bold topilmadi');
          return r.arrayBuffer();
        }),
      ]);
      fontCache = {
        regular: arrayBufferToBase64(regular),
        bold: arrayBufferToBase64(bold),
      };
    })();
    await fontReady;
  }
  doc.addFileToVFS('NotoSans-Regular.ttf', fontCache!.regular);
  doc.addFileToVFS('NotoSans-Bold.ttf', fontCache!.bold);
  doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
  doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
  doc.setFont('NotoSans', 'normal');
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
  doc.setDrawColor(color[0], color[1], color[2]);
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
  doc.setFontSize(8);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(label, x + 3.5, y + 5);
  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  const lines = doc.splitTextToSize(value || '—', w - 7);
  doc.text(lines.slice(0, 2), x + 3.5, y + 11);
}

export async function downloadReceiptPdf(detail: ReceiptDetail) {
  const r = detail.receipt;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await ensureFonts(doc);

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = 14;

  // Brand bar
  doc.setFillColor(TEAL[0], TEAL[1], TEAL[2]);
  doc.rect(0, 0, pageW, 3, 'F');

  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(TEAL[0], TEAL[1], TEAL[2]);
  doc.text('PHARMEX', margin, y);
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text('Savdo cheki', margin + 28, y);
  y += 10;

  // Title + status
  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  const title = `Chek ${r.receiptNo}`;
  doc.text(title, margin, y);
  const status = statusInfo(detail);
  drawBadge(doc, margin + doc.getTextWidth(title) + 6, y - 1, status.label, status.color);
  y += 6;
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(dateTime(r.soldAt), margin, y);
  y += 8;

  // Info grid
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

  const cols = 3;
  const gap = 3;
  const cardW = (contentW - gap * (cols - 1)) / cols;
  const cardH = 18;
  cards.forEach((card, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (cardW + gap);
    const cy = y + row * (cardH + gap);
    drawInfoCard(doc, x, cy, cardW, cardH, card[0], card[1]);
  });
  y += Math.ceil(cards.length / cols) * (cardH + gap) + 4;

  // Products
  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text('Mahsulotlar', margin, y);
  y += 3;

  const body = detail.lines.map(l => {
    const name = l.productCode ? `${l.productName}\n${l.productCode} · ${l.unit}` : `${l.productName}\n${l.unit}`;
    const vat = l.vatRate
      ? `${money(l.vatAmount)}\n${l.vatRate}%`
      : 'QQSsiz';
    const cost = l.costPrice
      ? `${money(l.cost)}\n${money(l.costPrice)} / ${l.unit}`
      : money(l.cost);
    return [
      name,
      qty(l.quantity),
      money(l.unitPrice),
      num(l.discount) ? money(l.discount) : '—',
      money(l.total),
      vat,
      cost,
      money(l.grossProfit),
    ];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Mahsulot / kod', 'Miqdor', 'Narx', 'Chegirma', 'Summa', 'QQS', 'Tannarx', 'Foyda']],
    body,
    styles: {
      font: 'NotoSans',
      fontSize: 8,
      cellPadding: 2.2,
      textColor: NAVY,
      lineColor: LINE,
      lineWidth: 0.2,
      valign: 'middle',
    },
    headStyles: {
      font: 'NotoSans',
      fontStyle: 'bold',
      fillColor: NAVY,
      textColor: [255, 255, 255],
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: 52, halign: 'left' },
      1: { halign: 'right', cellWidth: 16 },
      2: { halign: 'right', cellWidth: 22 },
      3: { halign: 'right', cellWidth: 20 },
      4: { halign: 'right', cellWidth: 22 },
      5: { halign: 'right', cellWidth: 20 },
      6: { halign: 'right', cellWidth: 24 },
      7: { halign: 'right', cellWidth: 22, textColor: GOOD },
    },
    alternateRowStyles: { fillColor: [243, 248, 251] },
  });

  y = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y) + 8;

  // Payments + totals side by side
  const leftW = contentW * 0.48;
  const rightX = margin + contentW * 0.52;
  const rightW = contentW * 0.48;

  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text('Toʻlovlar', margin, y);

  let payY = y + 4;
  if (!r.payments.length) {
    doc.setFont('NotoSans', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text('Toʻlov yoʻq', margin, payY + 5);
    payY += 12;
  } else {
    for (const p of r.payments) {
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, payY, leftW, 12, 2, 2, 'FD');
      doc.setFont('NotoSans', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
      doc.text(paymentLabels[p.method] ?? p.method, margin + 3, payY + 5);
      doc.setFont('NotoSans', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text(p.accountName || '—', margin + 3, payY + 9.5);
      doc.setFont('NotoSans', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
      const amt = money(p.amount);
      doc.text(amt, margin + leftW - 3 - doc.getTextWidth(amt), payY + 7.5);
      payY += 14;
    }
  }

  const totals: { label: string; value: string; strong?: boolean; tone?: 'good' | 'bad' }[] = [
    { label: 'Summa (chegirmagacha)', value: money(r.grossAmount) },
    { label: 'Chegirma', value: money(r.discount) },
    { label: 'Shu jumladan QQS', value: money(r.vatAmount) },
    { label: 'Jami', value: money(r.total), strong: true },
    { label: 'Tannarx', value: money(r.cost) },
    { label: 'Yalpi foyda', value: money(r.grossProfit), tone: 'good' },
  ];
  if (num(r.returnedAmount)) {
    totals.push({ label: 'Qaytarilgan', value: money(r.returnedAmount), tone: 'bad' });
  }

  let totY = y;
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
  doc.setFillColor(248, 250, 252);
  const boxH = totals.length * 8 + 8;
  doc.roundedRect(rightX, totY, rightW, boxH, 2, 2, 'FD');
  totY += 6;
  for (const row of totals) {
    doc.setFont('NotoSans', row.strong ? 'bold' : 'normal');
    doc.setFontSize(row.strong ? 11 : 9);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(row.label, rightX + 4, totY);
    if (row.tone === 'good') doc.setTextColor(GOOD[0], GOOD[1], GOOD[2]);
    else if (row.tone === 'bad') doc.setTextColor(BAD[0], BAD[1], BAD[2]);
    else if (row.strong) doc.setTextColor(GOOD[0], GOOD[1], GOOD[2]);
    else doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.setFont('NotoSans', 'bold');
    const tw = doc.getTextWidth(row.value);
    doc.text(row.value, rightX + rightW - 4 - tw, totY);
    totY += 8;
  }

  const bottom = Math.max(payY, totY) + 10;
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
  doc.line(margin, bottom, pageW - margin, bottom);
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(`PHARMEX · Chek PDF · ${new Date().toLocaleString('uz-UZ')}`, margin, bottom + 5);

  const safeNo = String(r.receiptNo).replace(/[\\/:*?"<>|]+/g, '_');
  doc.save(`Chek_${safeNo}.pdf`);
}
