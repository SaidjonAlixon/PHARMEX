import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { MoneyTransaction } from '@workspace/api-client-react';
import { dateTime, money, num, round2, sourceText } from '@/components/kit';
import { moneyTypeLabels } from '@/lib/labels';
import { ensurePdfFonts } from '@/pages/pdf-fonts';

const NAVY: [number, number, number] = [19, 48, 110];
const TEAL: [number, number, number] = [15, 179, 199];
const MUTED: [number, number, number] = [100, 116, 139];
const LINE: [number, number, number] = [226, 232, 240];
const GOOD: [number, number, number] = [18, 138, 67];
const BAD: [number, number, number] = [198, 47, 58];

function drawInfoCard(doc: jsPDF, x: number, y: number, w: number, h: number, label: string, value: string) {
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

function relatedOf(tx: MoneyTransaction, all: MoneyTransaction[]) {
  if (!tx.transferGroupId) return [];
  return all.filter(x => x.transferGroupId === tx.transferGroupId && x.id !== tx.id);
}

export async function downloadMoneyTransactionPdf(
  tx: MoneyTransaction,
  related: MoneyTransaction[] = [],
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await ensurePdfFonts(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = 14;

  doc.setFillColor(TEAL[0], TEAL[1], TEAL[2]);
  doc.rect(0, 0, pageW, 3, 'F');

  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(TEAL[0], TEAL[1], TEAL[2]);
  doc.text('PHARMEX', margin, y);
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text('Pul harakati · operatsiya', margin + 28, y);
  y += 10;

  const typeLabel = moneyTypeLabels[tx.type] ?? tx.type;
  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text(typeLabel, margin, y);
  y += 6;
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(dateTime(tx.date), margin, y);
  y += 8;

  const isIn = tx.direction === 'in';
  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(isIn ? GOOD[0] : BAD[0], isIn ? GOOD[1] : BAD[1], isIn ? GOOD[2] : BAD[2]);
  doc.text(`${isIn ? '+' : '−'}${money(tx.amount)}`, margin, y);
  y += 8;

  const cards: [string, string][] = [
    ['Sana-vaqt', dateTime(tx.date)],
    ['Operatsiya', typeLabel],
    ['Yoʻnalish', isIn ? 'Kirim' : 'Chiqim'],
    ['Hisob', `${tx.accountName} · ${tx.accountKind === 'cash' ? 'Kassa' : 'Bank'}`],
    ['Filial', tx.branchName || '—'],
    ['Hamkor', tx.counterpartyName || '—'],
    ['Hujjat', tx.documentNo || '—'],
    ['Kategoriya', tx.category || '—'],
    ['Manba', sourceText(tx.source)],
    ['Yaratgan', tx.createdBy || '—'],
  ];
  if (tx.note) cards.push(['Izoh', tx.note]);
  if (tx.saleId) cards.push(['Chek ID', String(tx.saleId)]);
  if (tx.purchaseId) cards.push(['Kirim ID', String(tx.purchaseId)]);
  if (tx.debtId) cards.push(['Qarz ID', String(tx.debtId)]);
  if (tx.transferGroupId) cards.push(['Oʻtkazma guruhi', tx.transferGroupId]);

  const cols = 3;
  const gap = 3;
  const cardW = (contentW - gap * (cols - 1)) / cols;
  const cardH = 18;
  cards.forEach((card, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    drawInfoCard(doc, margin + col * (cardW + gap), y + row * (cardH + gap), cardW, cardH, card[0], card[1]);
  });
  y += Math.ceil(cards.length / cols) * (cardH + gap) + 4;

  if (related.length) {
    doc.setFont('NotoSans', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.text('Bogʻliq oʻtkazmalar', margin, y);
    y += 3;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Sana-vaqt', 'Operatsiya', 'Hisob', 'Filial', 'Kirim', 'Chiqim']],
      body: related.map(x => [
        dateTime(x.date),
        moneyTypeLabels[x.type] ?? x.type,
        x.accountName,
        x.branchName,
        x.direction === 'in' ? money(x.amount) : '',
        x.direction === 'out' ? money(x.amount) : '',
      ]),
      styles: { font: 'NotoSans', fontSize: 8, textColor: NAVY, lineColor: LINE, lineWidth: 0.2 },
      headStyles: { font: 'NotoSans', fontStyle: 'bold', fillColor: NAVY, textColor: [255, 255, 255] },
      columnStyles: {
        4: { halign: 'right', textColor: GOOD },
        5: { halign: 'right', textColor: BAD },
      },
    });
    y = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y) + 8;
  }

  doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
  doc.line(margin, y, pageW - margin, y);
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(`PHARMEX · Pul harakati PDF · ${new Date().toLocaleString('uz-UZ')}`, margin, y + 5);

  doc.save(`Pul_operatsiya_${tx.id}.pdf`);
}

export async function downloadMoneyTransactionsPdf(opts: {
  rows: MoneyTransaction[];
  periodLabel: string;
  branchLabel: string;
  title?: string;
}) {
  const { rows, periodLabel, branchLabel, title = 'Pul harakati' } = opts;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  await ensurePdfFonts(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 12;

  doc.setFillColor(TEAL[0], TEAL[1], TEAL[2]);
  doc.rect(0, 0, pageW, 3, 'F');

  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text(title, margin, 14);
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(`${branchLabel} · Davr: ${periodLabel} · ${rows.length} ta · soʻm`, margin, 20);

  const inTotal = round2(rows.filter(t => t.direction === 'in').reduce((s, t) => s + num(t.amount), 0));
  const outTotal = round2(rows.filter(t => t.direction === 'out').reduce((s, t) => s + num(t.amount), 0));

  autoTable(doc, {
    startY: 24,
    margin: { left: margin, right: margin },
    head: [['#', 'Sana-vaqt', 'Operatsiya', 'Hisob', 'Filial', 'Hamkor', 'Hujjat / izoh', 'Kirim', 'Chiqim']],
    body: rows.map((t, i) => [
      i + 1,
      dateTime(t.date),
      moneyTypeLabels[t.type] ?? t.type,
      t.accountName,
      t.branchName,
      t.counterpartyName || '—',
      [t.documentNo, t.note].filter(Boolean).join(' · ') || '—',
      t.direction === 'in' ? money(t.amount) : '',
      t.direction === 'out' ? money(t.amount) : '',
    ]),
    foot: [['', 'Jami', '', '', '', '', '', money(inTotal), money(outTotal)]],
    styles: { font: 'NotoSans', fontSize: 7.5, textColor: NAVY, lineColor: LINE, lineWidth: 0.15, cellPadding: 1.6 },
    headStyles: { font: 'NotoSans', fontStyle: 'bold', fillColor: NAVY, textColor: [255, 255, 255], halign: 'center' },
    footStyles: { font: 'NotoSans', fontStyle: 'bold', fillColor: [232, 247, 250], textColor: NAVY },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      7: { halign: 'right', textColor: GOOD },
      8: { halign: 'right', textColor: BAD },
    },
    alternateRowStyles: { fillColor: [243, 248, 251] },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`Pul_harakati_${stamp}.pdf`);
}

export { relatedOf };
