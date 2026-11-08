import * as XLSX from 'xlsx';
import type { InventoryItem } from '@workspace/api-client-react';
import { date, num, qty, round2, unitLabel } from '@/components/kit';
import { expiryDay, expiryDaysOf } from '@/pages/warehouse-shared';

export function retailValueOf(i: InventoryItem) {
  return round2(Math.max(0, i.quantity) * num(i.retailPrice));
}

/** (sotuv − tannarx) × qoldiq — qolgan tovardan olinadigan foyda. */
export function profitOf(i: InventoryItem) {
  const q = Math.max(0, i.quantity);
  return round2((num(i.retailPrice) - num(i.costPrice)) * q);
}

export function exportWarehouseExcel(rows: InventoryItem[], sectionTitle: string) {
  const sheet = rows.map((x, i) => {
    const days = expiryDaysOf(x.expiryDate);
    let yaroqlilik = '—';
    if (days != null) {
      if (days < 0) yaroqlilik = `Muddati oʻtgan · ${Math.abs(days)} kun`;
      else if (days === 0) yaroqlilik = 'Muddati bugun tugaydi';
      else yaroqlilik = `Muddati ${days} kun qoldi`;
    }
    return {
      '#': i + 1,
      Mahsulot: x.productName,
      Ishlab_chiqaruvchi: x.manufacturer || '',
      Shtrix_kod: x.barcode || '',
      Ombor: x.branchName,
      Qoldiq: qty(x.quantity),
      Birlik: unitLabel(x.unit),
      '1_dona_tannarx': num(x.costPrice),
      '1_dona_sotuv': num(x.retailPrice),
      Qoldiq_qiymati: num(x.value),
      Qoyilgan_narx_jami: retailValueOf(x),
      Olinadigan_foyda: profitOf(x),
      Yaroqlilik_sanasi: expiryDay(x.expiryDate) ? date(expiryDay(x.expiryDate)) : '',
      Yaroqlilik_holati: yaroqlilik,
    };
  });

  const totals = {
    '#': '',
    Mahsulot: `JAMI · ${sectionTitle}`,
    Ishlab_chiqaruvchi: '',
    Shtrix_kod: '',
    Ombor: '',
    Qoldiq: '',
    Birlik: `${rows.length} ta`,
    '1_dona_tannarx': '',
    '1_dona_sotuv': '',
    Qoldiq_qiymati: round2(rows.reduce((s, x) => s + num(x.value), 0)),
    Qoyilgan_narx_jami: round2(rows.reduce((s, x) => s + retailValueOf(x), 0)),
    Olinadigan_foyda: round2(rows.reduce((s, x) => s + profitOf(x), 0)),
    Yaroqlilik_sanasi: '',
    Yaroqlilik_holati: '',
  };

  const ws = XLSX.utils.json_to_sheet([...sheet, totals]);
  ws['!cols'] = [
    { wch: 5 }, { wch: 40 }, { wch: 18 }, { wch: 14 }, { wch: 12 },
    { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 22 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ombor');
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = sectionTitle.replace(/[^\w\u0400-\u04FF\- ]+/g, '').trim().replace(/\s+/g, '_') || 'ombor';
  XLSX.writeFile(wb, `Ombor_${safe}_${stamp}.xlsx`);
}
