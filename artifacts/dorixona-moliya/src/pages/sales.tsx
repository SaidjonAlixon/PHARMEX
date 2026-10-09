import { useMemo, useState, type FormEvent } from 'react';
import {
  Ban, Banknote, CreditCard, HandCoins, Percent, Plus, Receipt as ReceiptIcon, RotateCcw, ShoppingCart, Trash2, TrendingUp, Undo2,
} from 'lucide-react';
import {
  getGetReceiptQueryKey, useCreateReceipt, useGetReceipt, useListReceipts, useListSales, useReturnReceipt, useVoidReceipt,
} from '@workspace/api-client-react';
import type { PaymentMethod, Receipt, ReceiptDetail } from '@workspace/api-client-react';
import {
  AccountSelect, BranchSelect, Chips, CounterpartyField, DataState, Drawer, FormError, InfoGrid, KpiStrip, Modal,
  PageHeading, Panel, ProductPicker, SearchBox, StatusBadge, TableWrap, Totals, dateTime, filterParams, includedVat,
  localToIso, money, nowLocal, num, qty, round2, sourceText, toMoney, today, useRefreshAll, type Filters, type PickedProduct,
} from '@/components/kit';
import { paymentLabels } from '@/lib/labels';
import { paymentMenu } from '@/lib/menu-options';
import { SelectMenu } from '@/components/select-menu';

type Tab = 'sales' | 'returns' | 'voided' | 'lines';

function PaymentChips({ receipt }: { receipt: Receipt }) {
  return <div className="pay-chips">{receipt.payments.map((p, i) => <span key={i} className={`pay-chip ${p.method}`}>{paymentLabels[p.method] ?? p.method} {money(p.amount)}</span>)}</div>;
}

function ReceiptStatus({ receipt }: { receipt: Receipt }) {
  if (receipt.status === 'voided') return <StatusBadge tone="bad">Bekor qilingan</StatusBadge>;
  if (receipt.kind === 'return') return <StatusBadge tone="warn">Qaytarish</StatusBadge>;
  if (num(receipt.returnedAmount) > 0) return <StatusBadge tone="warn">Qisman qaytarilgan</StatusBadge>;
  return <StatusBadge tone="good">Yakunlangan</StatusBadge>;
}

export function SalesPage({ filters }: { filters: Filters }) {
  const [tab, setTab] = useState<Tab>('sales');
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const base = filterParams(filters);
  const receiptsQ = useListReceipts({ ...base, search: search || undefined, paymentMethod: method || undefined, limit: 500 });
  const linesQ = useListSales({ ...base, search: search || undefined, limit: 300 }, { query: { enabled: tab === 'lines', queryKey: ['sales-lines', base, search] } });
  const all = receiptsQ.data || [];

  const stats = useMemo(() => {
    const sales = all.filter(r => r.kind === 'sale' && r.status === 'completed');
    const returns = all.filter(r => r.kind === 'return' && r.status === 'completed');
    const sum = (rows: Receipt[], pick: (r: Receipt) => string | null) => rows.reduce((s, r) => s + num(pick(r)), 0);
    const byMethod: Record<string, number> = {};
    for (const r of sales) for (const p of r.payments) byMethod[p.method] = (byMethod[p.method] || 0) + num(p.amount);
    for (const r of returns) for (const p of r.payments) byMethod[p.method] = (byMethod[p.method] || 0) - num(p.amount);
    const costKnown = [...sales, ...returns].every(r => r.cost != null);
    return {
      count: sales.length,
      gross: sum(sales, r => r.grossAmount),
      net: sum(sales, r => r.total) - sum(returns, r => r.total),
      returns: sum(returns, r => r.total),
      discount: sum(sales, r => r.discount) - sum(returns, r => r.discount),
      vat: sum(sales, r => r.vatAmount) - sum(returns, r => r.vatAmount),
      cost: costKnown ? sum(sales, r => r.cost) - sum(returns, r => r.cost) : null,
      profit: costKnown ? sum(sales, r => r.grossProfit) - sum(returns, r => r.grossProfit) : null,
      voided: all.filter(r => r.status === 'voided').length,
      returnCount: returns.length,
      byMethod,
    };
  }, [all]);

  const rows = all.filter(r => tab === 'sales' ? r.kind === 'sale' && r.status === 'completed' : tab === 'returns' ? r.kind === 'return' : tab === 'voided' ? r.status === 'voided' : false);
  const methodTotal = Object.values(stats.byMethod).reduce((s, v) => s + v, 0);

  return <>
    <PageHeading eyebrow="SAVDO · ПРОДАЖА" title="Savdolar" subtitle="Cheklar, toʻlov turlari, chegirma, QQS, tannarx va yalpi foyda; bekor qilish va qaytarishlar" actions={<button className="button primary" onClick={() => setCreating(true)} data-testid="button-new-receipt"><Plus size={16} /> Yangi chek</button>} />
    <KpiStrip items={[
      { label: 'Cheklar', value: stats.count, count: true, icon: ReceiptIcon, hint: `${stats.voided} ta bekor qilingan` },
      { label: 'Sof savdo', value: round2(stats.net), icon: ShoppingCart, tone: 'good', hint: `Yalpi ${money(stats.gross)} soʻm` },
      { label: 'Qaytarishlar', value: round2(stats.returns), icon: Undo2, tone: stats.returns ? 'warn' : undefined, hint: `${stats.returnCount} ta hujjat` },
      { label: 'Chegirmalar', value: round2(stats.discount), icon: Percent },
      { label: 'QQS (narx ichida)', value: round2(stats.vat), icon: HandCoins },
      { label: 'Tannarx', value: stats.cost == null ? null : round2(stats.cost), icon: Banknote, hint: stats.cost == null ? 'Ayrim tannarxlar yoʻq' : 'soʻm' },
      { label: 'Yalpi foyda', value: stats.profit == null ? null : round2(stats.profit), icon: TrendingUp, tone: 'good', hint: stats.profit == null ? 'Tannarx toʻliq emas' : stats.net ? `Marja ${Math.round((stats.profit / stats.net) * 1000) / 10}%` : 'soʻm' },
    ]} />
    <div className="split-grid">
      <Panel title="Toʻlov turlari" subtitle="Sof tushum (qaytarishlar ayirilgan)">
        {methodTotal ? <div className="breakdown-list">{Object.entries(stats.byMethod).filter(([, v]) => v).map(([m, v]) => <div className="breakdown-row" key={m}><div><span className="pay-label">{m === 'card' ? <CreditCard size={13} /> : <Banknote size={13} />} {paymentLabels[m] ?? m}</span><b>{money(round2(v))} soʻm</b></div><div className="bar-track"><i style={{ width: `${Math.max(3, Math.abs(v) / Math.max(1, ...Object.values(stats.byMethod).map(Math.abs)) * 100)}%` }} /></div></div>)}</div> : <div className="inline-empty">Toʻlovlar yoʻq</div>}
      </Panel>
      <Panel title="Qanday ishlaydi" subtitle="Hujjatlar zanjiri">
        <ul className="hint-list">
          <li><b>Chek</b> — tovar filial qoldigʻidan chiqadi, tannarx oʻrtacha narxda yoziladi, naqd/karta tushumi kassa yoki bankka tushadi, nasiya mijoz qarziga yoziladi.</li>
          <li><b>Bekor qilish</b> — xato chek: tovar qoldiqqa, pul kassadan qaytadi, nasiya bekor boʻladi.</li>
          <li><b>Qaytarish</b> — mijoz tovarni qaytardi: alohida hujjat, pul qaytariladi yoki nasiya kamayadi.</li>
        </ul>
      </Panel>
    </div>
    <div className="tabs">
      <button className={tab === 'sales' ? 'selected' : ''} onClick={() => setTab('sales')} data-testid="tab-receipts"><ReceiptIcon size={15} /> Cheklar</button>
      <button className={tab === 'returns' ? 'selected' : ''} onClick={() => setTab('returns')} data-testid="tab-returns"><RotateCcw size={15} /> Qaytarishlar</button>
      <button className={tab === 'voided' ? 'selected' : ''} onClick={() => setTab('voided')} data-testid="tab-voided"><Ban size={15} /> Bekor qilinganlar</button>
      <button className={tab === 'lines' ? 'selected' : ''} onClick={() => setTab('lines')} data-testid="tab-lines"><ShoppingCart size={15} /> Mahsulot qatorlari</button>
    </div>
    <Panel title={tab === 'sales' ? 'Sotuv cheklari' : tab === 'returns' ? 'Mijozdan qaytarishlar' : tab === 'voided' ? 'Bekor qilingan cheklar' : 'Sotilgan mahsulotlar'} subtitle={tab === 'lines' ? 'Har bir chek qatori: miqdor, narx, foyda' : 'Qatorni bosib chek tafsilotini oching'} action={<div className="toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Chek, kassir, mijoz, mahsulot" />{tab !== 'lines' && <SelectMenu ariaLabel="Toʻlov turi" value={method} onChange={setMethod} options={paymentMenu} align="right" />}</div>}>
      {tab === 'lines' ? <>
        <DataState loading={linesQ.isLoading} error={linesQ.isError} empty={!linesQ.isLoading && !linesQ.isError && !(linesQ.data || []).length} retry={() => linesQ.refetch()} />
        {!!linesQ.data?.length && <TableWrap><thead><tr><th>SANA / CHEK</th><th>MAHSULOT</th><th>FILIAL / KASSIR</th><th className="num">MIQDOR</th><th className="num">NARX</th><th className="num">CHEGIRMA</th><th className="num">SUMMA</th><th className="num">TANNARX</th><th className="num">FOYDA</th><th>TOʻLOV</th></tr></thead><tbody>{linesQ.data.map(s => <tr key={s.id}><td>{dateTime(s.date)}<small>{s.receiptNo}</small></td><td className="cell-strong">{s.productName}</td><td>{s.branchName}<small>{s.cashier || '—'}</small></td><td className={`num ${s.quantity < 0 ? 'negative' : ''}`}>{qty(s.quantity)}</td><td className="num">{money(s.unitPrice)}</td><td className="num">{money(s.discount)}</td><td className="num">{money(s.revenue)}</td><td className="num">{money(s.costPrice)}</td><td className={`num ${s.grossProfit == null ? 'missing' : 'positive'}`}>{money(s.grossProfit)}</td><td>{paymentLabels[s.paymentType] ?? s.paymentType}</td></tr>)}</tbody></TableWrap>}
      </> : <>
        <DataState loading={receiptsQ.isLoading} error={receiptsQ.isError} empty={!receiptsQ.isLoading && !receiptsQ.isError && !rows.length} retry={() => receiptsQ.refetch()} emptyText={tab === 'sales' ? 'Bu davrda chek yoʻq. “Yangi chek” tugmasi orqali sotuvni rasmiylashtiring.' : undefined} />
        {!!rows.length && <TableWrap><thead><tr><th>CHEK / SANA-VAQT</th><th>FILIAL / KASSIR</th><th>MIJOZ</th><th className="num">POZ.</th><th className="num">SUMMA</th><th className="num">CHEGIRMA</th><th className="num">QQS</th><th className="num">JAMI</th><th className="num">TANNARX</th><th className="num">YALPI FOYDA</th><th>TOʻLOV</th><th>HOLAT</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id} className="clickable" onClick={() => setSelected(r.id)} data-testid={`row-receipt-${r.id}`}>
            <td><span className="table-main-link">{r.receiptNo}</span><small>{dateTime(r.soldAt)}</small></td>
            <td>{r.branchName}<small>{r.cashier || '—'}</small></td>
            <td>{r.customerName || '—'}{r.originalReceiptNo && <small>Asosiy chek: {r.originalReceiptNo}</small>}</td>
            <td className="num">{r.itemsCount}</td>
            <td className="num">{money(r.grossAmount)}</td>
            <td className="num">{num(r.discount) ? money(r.discount) : '—'}</td>
            <td className="num">{num(r.vatAmount) ? money(r.vatAmount) : '—'}</td>
            <td className={`num cell-strong ${r.kind === 'return' ? 'negative' : ''}`}>{r.kind === 'return' ? '−' : ''}{money(r.total)}</td>
            <td className="num">{money(r.cost)}</td>
            <td className={`num ${r.grossProfit == null ? 'missing' : r.kind === 'return' ? 'negative' : 'positive'}`}>{money(r.grossProfit)}</td>
            <td><PaymentChips receipt={r} /></td>
            <td><ReceiptStatus receipt={r} /></td>
          </tr>)}</tbody></TableWrap>}
      </>}
    </Panel>
    {selected != null && <ReceiptDrawer id={selected} onClose={() => setSelected(null)} onOpen={setSelected} />}
    {creating && <NewReceiptModal defaultBranch={filters.branchId} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); setSelected(id); }} />}
  </>;
}

export function ReceiptDrawer({ id, onClose, onOpen }: { id: number; onClose: () => void; onOpen?: (id: number) => void }) {
  const params = { receiptId: id };
  const q = useGetReceipt(params, { query: { queryKey: getGetReceiptQueryKey(params) } });
  const [action, setAction] = useState<'void' | 'return' | null>(null);
  const d = q.data;
  const r = d?.receipt;
  const returnable = !!d && d.lines.some(l => l.quantity - l.returnedQuantity > 0);
  const canAct = r?.kind === 'sale' && r.status === 'completed';
  return <Drawer eyebrow={r?.kind === 'return' ? 'QAYTARISH HUJJATI' : 'SAVDO CHEKI'} title={r ? `Chek ${r.receiptNo}` : 'Chek'} subtitle={r && <><ReceiptStatus receipt={r} /> <span>{dateTime(r.soldAt)}</span></>} onClose={onClose}
    actions={canAct && <>
      <button className="button secondary" disabled={!returnable} onClick={() => setAction('return')} data-testid="button-return-receipt"><Undo2 size={15} /> Qaytarish</button>
      <button className="button danger" disabled={num(r!.returnedAmount) > 0} title={num(r!.returnedAmount) > 0 ? 'Qaytarish rasmiylashtirilgan chekni bekor qilib boʻlmaydi' : undefined} onClick={() => setAction('void')} data-testid="button-void-receipt"><Ban size={15} /> Chekni bekor qilish</button>
    </>}>
    <DataState loading={q.isLoading} error={q.isError} empty={false} retry={() => q.refetch()} />
    {d && r && <>
      <InfoGrid items={[
        { label: 'Chek raqami', value: r.receiptNo },
        { label: 'Sana va vaqt', value: dateTime(r.soldAt) },
        { label: 'Filial', value: r.branchName },
        { label: 'Kassir', value: r.cashier || '—' },
        { label: 'Mijoz', value: r.customerName || '—' },
        { label: 'Manba', value: sourceText(r.source) },
        ...(r.originalReceiptNo ? [{ label: 'Asosiy chek', value: <button className="link-button" onClick={() => r.originalSaleId && onOpen?.(r.originalSaleId)}>{r.originalReceiptNo}</button> }] : []),
        ...(r.status === 'voided' ? [{ label: 'Bekor qilindi', value: `${dateTime(r.voidedAt)} — ${r.voidReason}` }] : []),
        ...(r.note ? [{ label: r.kind === 'return' ? 'Qaytarish sababi' : 'Izoh', value: r.note }] : []),
      ]} />
      <h3 className="subhead">Mahsulotlar</h3>
      <TableWrap><thead><tr><th>MAHSULOT / KOD</th><th className="num">MIQDOR</th><th className="num">NARX</th><th className="num">CHEGIRMA</th><th className="num">SUMMA</th><th className="num">QQS</th><th className="num">TANNARX</th><th className="num">FOYDA</th>{r.kind === 'sale' && <th className="num">QAYTGAN</th>}</tr></thead>
        <tbody>{d.lines.map(l => <tr key={l.id}><td className="cell-strong">{l.productName}<small>{l.productCode || '—'} · {l.unit}</small></td><td className="num">{qty(l.quantity)}</td><td className="num">{money(l.unitPrice)}</td><td className="num">{num(l.discount) ? money(l.discount) : '—'}</td><td className="num">{money(l.total)}</td><td className="num">{l.vatRate ? <>{money(l.vatAmount)}<small>{l.vatRate}%</small></> : 'QQSsiz'}</td><td className="num">{money(l.cost)}<small>{l.costPrice ? `${money(l.costPrice)} / ${l.unit}` : ''}</small></td><td className={`num ${l.grossProfit == null ? 'missing' : 'positive'}`}>{money(l.grossProfit)}</td>{r.kind === 'sale' && <td className={`num ${l.returnedQuantity ? 'negative' : ''}`}>{l.returnedQuantity ? qty(l.returnedQuantity) : '—'}</td>}</tr>)}</tbody></TableWrap>
      <div className="detail-columns">
        <div>
          <h3 className="subhead">Toʻlovlar</h3>
          <div className="pay-list">{r.payments.map((p, i) => <div key={i}><span className={`pay-chip ${p.method}`}>{paymentLabels[p.method] ?? p.method}</span><span>{p.accountName || '—'}</span><b>{money(p.amount)} soʻm</b></div>)}</div>
        </div>
        <Totals rows={[
          { label: 'Summa (chegirmagacha)', value: r.grossAmount },
          { label: 'Chegirma', value: r.discount },
          { label: 'Shu jumladan QQS', value: r.vatAmount },
          { label: 'Jami', value: r.total, strong: true },
          { label: 'Tannarx', value: r.cost },
          { label: 'Yalpi foyda', value: r.grossProfit, tone: 'good' },
          ...(num(r.returnedAmount) ? [{ label: 'Qaytarilgan', value: r.returnedAmount, tone: 'bad' as const }] : []),
        ]} />
      </div>
      {!!d.returns.length && <><h3 className="subhead">Ushbu chek boʻyicha qaytarishlar</h3>
        <TableWrap><thead><tr><th>HUJJAT</th><th>SANA</th><th>SABAB</th><th className="num">SUMMA</th><th>QAYTARISH USULI</th></tr></thead><tbody>{d.returns.map(x => <tr key={x.id} className="clickable" onClick={() => onOpen?.(x.id)}><td className="table-main-link">{x.receiptNo}</td><td>{dateTime(x.soldAt)}</td><td>{x.note || '—'}</td><td className="num negative">{money(x.total)}</td><td><PaymentChips receipt={x} /></td></tr>)}</tbody></TableWrap></>}
    </>}
    {action === 'void' && d && <VoidModal detail={d} onClose={() => setAction(null)} />}
    {action === 'return' && d && <ReturnModal detail={d} onClose={() => setAction(null)} onDone={newId => { setAction(null); onOpen?.(newId); }} />}
  </Drawer>;
}

function VoidModal({ detail, onClose }: { detail: ReceiptDetail; onClose: () => void }) {
  const refresh = useRefreshAll();
  const voidReceipt = useVoidReceipt();
  const [reason, setReason] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); voidReceipt.mutate({ data: { receiptId: detail.receipt.id, reason } }, { onSuccess: () => { refresh(); onClose(); } }); };
  return <Modal eyebrow="CHEKNI BEKOR QILISH" title={`Chek ${detail.receipt.receiptNo}`} onClose={onClose} busy={voidReceipt.isPending}>
    <form className="form-stack" onSubmit={submit}>
      <div className="notice warn">Tovarlar qoldiqqa qaytadi, naqd/karta tushumi hisobdan chiqariladi, nasiya qarzi bekor qilinadi. Amalni ortga qaytarib boʻlmaydi.</div>
      <Totals rows={[{ label: 'Chek summasi', value: detail.receipt.total, strong: true }]} />
      <label>Bekor qilish sababi<textarea required minLength={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Masalan: kassir xatosi, ikki marta urilgan chek" /></label>
      <FormError error={voidReceipt.error} />
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Yopish</button><button className="button danger" disabled={voidReceipt.isPending} data-testid="button-confirm-void">{voidReceipt.isPending ? 'Bekor qilinmoqda…' : 'Chekni bekor qilish'}</button></div>
    </form>
  </Modal>;
}

function ReturnModal({ detail, onClose, onDone }: { detail: ReceiptDetail; onClose: () => void; onDone: (id: number) => void }) {
  const refresh = useRefreshAll();
  const ret = useReturnReceipt();
  const hasCredit = detail.receipt.payments.some(p => p.method === 'credit');
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>(hasCredit ? 'credit' : (detail.receipt.payments[0]?.method === 'card' ? 'card' : 'cash'));
  const [accountId, setAccountId] = useState('');
  const [when, setWhen] = useState(nowLocal());
  const [reason, setReason] = useState('');
  const lines = detail.lines.map(l => {
    const remaining = round2(l.quantity - l.returnedQuantity);
    const q = Math.min(num(quantities[l.id]), remaining);
    const refund = q > 0 ? round2(num(l.unitPrice) * q - num(l.discount) * q / l.quantity) : 0;
    return { ...l, remaining, q, refund };
  });
  const total = round2(lines.reduce((s, l) => s + l.refund, 0));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const items = lines.filter(l => l.q > 0).map(l => ({ lineId: l.id, quantity: l.q }));
    if (!items.length) return;
    ret.mutate({ data: { receiptId: detail.receipt.id, date: localToIso(when), reason, refundMethod, accountId: accountId ? Number(accountId) : null, items } }, { onSuccess: res => { refresh(); onDone(res.receipt.id); } });
  };
  return <Modal eyebrow="MIJOZDAN QAYTARISH · ВОЗВРАТ ОТ ПОКУПАТЕЛЯ" title={`Chek ${detail.receipt.receiptNo}`} onClose={onClose} busy={ret.isPending} size="lg">
    <form className="form-stack" onSubmit={submit}>
      <TableWrap><thead><tr><th>MAHSULOT</th><th className="num">SOTILGAN</th><th className="num">QAYTGAN</th><th className="num">MUMKIN</th><th className="num">QAYTARISH</th><th className="num">SUMMA</th></tr></thead>
        <tbody>{lines.map(l => <tr key={l.id}><td className="cell-strong">{l.productName}<small>{money(l.unitPrice)} soʻm / {l.unit}</small></td><td className="num">{qty(l.quantity)}</td><td className="num">{qty(l.returnedQuantity)}</td><td className="num">{qty(l.remaining)}</td><td className="num"><input className="cell-input" type="number" min={0} max={l.remaining} step="0.001" disabled={l.remaining <= 0} value={quantities[l.id] ?? ''} onChange={e => setQuantities({ ...quantities, [l.id]: e.target.value })} placeholder="0" /></td><td className="num">{l.refund ? money(l.refund) : '—'}</td></tr>)}</tbody></TableWrap>
      <div className="form-grid">
        <label>Qaytarish usuli<select value={refundMethod} onChange={e => setRefundMethod(e.target.value as PaymentMethod)}>{(['cash', 'card', 'transfer', 'other'] as const).map(m => <option key={m} value={m}>{paymentLabels[m]} orqali pul qaytarish</option>)}{hasCredit && <option value="credit">Nasiya qarzidan ayirish</option>}</select></label>
        {refundMethod !== 'credit' && <AccountSelect value={accountId} onChange={setAccountId} branchId={String(detail.receipt.branchId)} kind={refundMethod === 'cash' ? 'cash' : refundMethod === 'other' ? undefined : 'bank'} label="Qaysi hisobdan" />}
        <label>Sana va vaqt<input type="datetime-local" required value={when} onChange={e => setWhen(e.target.value)} /></label>
      </div>
      <label>Qaytarish sababi<input required minLength={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Masalan: mos kelmadi, ortiqcha olingan" /></label>
      <Totals rows={[{ label: refundMethod === 'credit' ? 'Nasiyadan ayiriladi' : 'Mijozga qaytariladi', value: total, strong: true }]} />
      <FormError error={ret.error} />
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Yopish</button><button className="button primary" disabled={ret.isPending || total <= 0} data-testid="button-confirm-return">{ret.isPending ? 'Saqlanmoqda…' : 'Qaytarishni rasmiylashtirish'}</button></div>
    </form>
  </Modal>;
}

type Line = { productId: number; name: string; code: string; unit: string; available: number | null; vatRate: number; quantity: string; unitPrice: string; discount: string };
type Payment = { method: PaymentMethod; amount: string; accountId: string };

function NewReceiptModal({ defaultBranch, onClose, onCreated }: { defaultBranch: string; onClose: () => void; onCreated: (id: number) => void }) {
  const refresh = useRefreshAll();
  const create = useCreateReceipt();
  const [branchId, setBranchId] = useState(defaultBranch);
  const [soldAt, setSoldAt] = useState(nowLocal());
  const [cashier, setCashier] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [customer, setCustomer] = useState({ name: '', id: null as number | null });
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [payments, setPayments] = useState<Payment[]>([{ method: 'cash', amount: '', accountId: '' }]);
  const [localError, setLocalError] = useState('');

  const figures = lines.map(l => {
    const gross = round2(num(l.quantity) * num(l.unitPrice));
    const total = round2(gross - num(l.discount));
    return { gross, total, vat: includedVat(total, l.vatRate) };
  });
  const gross = round2(figures.reduce((s, f) => s + f.gross, 0));
  const discount = round2(lines.reduce((s, l) => s + num(l.discount), 0));
  const total = round2(figures.reduce((s, f) => s + f.total, 0));
  const vat = round2(figures.reduce((s, f) => s + f.vat, 0));
  const effectivePayments = payments.length === 1 && !payments[0].amount ? [{ ...payments[0], amount: toMoney(total) }] : payments;
  const paid = round2(effectivePayments.reduce((s, p) => s + num(p.amount), 0));
  const hasCredit = payments.some(p => p.method === 'credit');

  const addProduct = (p: PickedProduct) => {
    if (lines.some(l => l.productId === p.id)) return;
    setLines([...lines, { productId: p.id, name: p.name, code: p.code || p.barcode || '', unit: p.unit, available: p.available, vatRate: p.vatRate, quantity: '1', unitPrice: p.retailPrice, discount: '0' }]);
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => j === i ? { ...l, ...patch } : l));
  const setPayment = (i: number, patch: Partial<Payment>) => setPayments(payments.map((p, j) => j === i ? { ...p, ...patch } : p));
  const fillRest = (i: number) => { const others = round2(payments.reduce((s, p, j) => j === i ? s : s + num(p.amount), 0)); setPayment(i, { amount: toMoney(total - others) }); };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError('');
    if (!lines.length) return setLocalError('Kamida bitta mahsulot qoʻshing.');
    const over = lines.find(l => l.available != null && num(l.quantity) > l.available);
    if (over) return setLocalError(`“${over.name}” qoldigʻi yetarli emas (mavjud ${qty(over.available)}).`);
    if (Math.abs(paid - total) > 0.001) return setLocalError(`Toʻlovlar jami (${money(paid)}) chek summasiga (${money(total)}) teng boʻlishi kerak.`);
    if (hasCredit && !customer.name.trim()) return setLocalError('Nasiya savdo uchun mijozni kiriting.');
    create.mutate({ data: {
      branchId: Number(branchId), soldAt: localToIso(soldAt), cashier, receiptNo: receiptNo.trim() || undefined,
      customerName: customer.name.trim() || undefined, counterpartyId: customer.id, dueDate: hasCredit && dueDate ? dueDate : null, note,
      items: lines.map(l => ({ productId: l.productId, quantity: num(l.quantity), unitPrice: toMoney(num(l.unitPrice)), discount: toMoney(num(l.discount)) })),
      payments: effectivePayments.filter(p => num(p.amount) > 0).map(p => ({ method: p.method, amount: toMoney(num(p.amount)), accountId: p.accountId ? Number(p.accountId) : null })),
    } }, { onSuccess: res => { refresh(); onCreated(res.receipt.id); } });
  };

  return <Modal eyebrow="SAVDO · ПРОДАЖА" title="Yangi chek" onClose={onClose} busy={create.isPending} size="xl">
    <form className="form-stack" onSubmit={submit}>
      <div className="form-grid four">
        <BranchSelect value={branchId} onChange={v => { setBranchId(v); setLines([]); }} label="Filial" />
        <label>Sana va vaqt<input type="datetime-local" required value={soldAt} onChange={e => setSoldAt(e.target.value)} /></label>
        <label>Kassir<input value={cashier} onChange={e => setCashier(e.target.value)} placeholder="Boʻsh qolsa — siz" /></label>
        <label>Chek raqami <span className="optional">ixtiyoriy</span><input value={receiptNo} onChange={e => setReceiptNo(e.target.value)} placeholder="Avtomatik: CHK-000123" /></label>
      </div>
      <div className="line-editor">
        <div className="line-editor-head"><b>Mahsulotlar</b>{branchId ? <ProductPicker branchId={branchId} onlyInStock onPick={addProduct} /> : <span className="field-hint">Avval filialni tanlang</span>}</div>
        {lines.length ? <TableWrap><thead><tr><th>MAHSULOT / KOD</th><th className="num">QOLDIQ</th><th className="num">MIQDOR</th><th className="num">NARX</th><th className="num">CHEGIRMA</th><th className="num">QQS</th><th className="num">SUMMA</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => <tr key={l.productId}>
            <td className="cell-strong">{l.name}<small>{l.code || '—'} · {l.unit}</small></td>
            <td className={`num ${l.available != null && num(l.quantity) > l.available ? 'negative' : ''}`}>{qty(l.available)}</td>
            <td className="num"><input className="cell-input" type="number" min="0.001" step="0.001" required value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} /></td>
            <td className="num"><input className="cell-input wide" type="number" min="0" step="0.01" required value={l.unitPrice} onChange={e => setLine(i, { unitPrice: e.target.value })} /></td>
            <td className="num"><input className="cell-input wide" type="number" min="0" step="0.01" value={l.discount} onChange={e => setLine(i, { discount: e.target.value })} /></td>
            <td className="num">{l.vatRate ? `${money(figures[i].vat)} (${l.vatRate}%)` : '—'}</td>
            <td className="num cell-strong">{money(figures[i].total)}</td>
            <td><button type="button" className="icon-button" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Oʻchirish"><Trash2 size={15} /></button></td>
          </tr>)}</tbody></TableWrap> : <div className="inline-empty">Mahsulot qidirib qoʻshing — faqat tanlangan filialda qoldigʻi borlari koʻrinadi.</div>}
      </div>
      <div className="detail-columns">
        <div className="payments-editor">
          <div className="line-editor-head"><b>Toʻlov</b><button type="button" className="button secondary small" onClick={() => setPayments([...payments, { method: 'card', amount: '', accountId: '' }])}><Plus size={13} /> Toʻlov turi qoʻshish</button></div>
          {payments.map((p, i) => <div className="payment-row" key={i}>
            <select value={p.method} onChange={e => setPayment(i, { method: e.target.value as PaymentMethod, accountId: '' })}>{(['cash', 'card', 'transfer', 'credit', 'other'] as const).map(m => <option key={m} value={m}>{paymentLabels[m]}</option>)}</select>
            <input type="number" min="0" step="0.01" value={p.amount} onChange={e => setPayment(i, { amount: e.target.value })} placeholder={payments.length === 1 ? toMoney(total) : 'Summa'} />
            <button type="button" className="button ghost small" onClick={() => fillRest(i)}>Qolgani</button>
            {p.method !== 'credit' ? <AccountSelect value={p.accountId} onChange={v => setPayment(i, { accountId: v })} branchId={branchId} kind={p.method === 'cash' ? 'cash' : p.method === 'other' ? undefined : 'bank'} label="" emptyLabel={p.method === 'cash' ? 'Filial kassasi (avto)' : 'Bank hisobi (avto)'} /> : <span className="field-hint">Mijoz qarziga yoziladi</span>}
            {payments.length > 1 && <button type="button" className="icon-button" onClick={() => setPayments(payments.filter((_, j) => j !== i))} aria-label="Oʻchirish"><Trash2 size={15} /></button>}
          </div>)}
          {hasCredit && <div className="form-grid"><CounterpartyField kind="customer" label="Mijoz (nasiya)" value={customer.name} onChange={(name, id) => setCustomer({ name, id })} /><label>Nasiya muddati<input type="date" min={today} value={dueDate} onChange={e => setDueDate(e.target.value)} /><span className="field-hint">Boʻsh qolsa — 30 kun</span></label></div>}
          {!hasCredit && <label>Mijoz <span className="optional">ixtiyoriy</span><input value={customer.name} onChange={e => setCustomer({ name: e.target.value, id: null })} placeholder="Ism yoki tashkilot" /></label>}
          <label>Izoh <span className="optional">ixtiyoriy</span><input value={note} onChange={e => setNote(e.target.value)} /></label>
        </div>
        <Totals rows={[
          { label: 'Summa', value: gross },
          { label: 'Chegirma', value: discount },
          { label: 'Shu jumladan QQS', value: vat },
          { label: 'Jami toʻlanadi', value: total, strong: true },
          { label: 'Toʻlovlar', value: paid, tone: Math.abs(paid - total) < 0.001 ? 'good' : 'bad' },
          ...(Math.abs(paid - total) >= 0.001 ? [{ label: paid > total ? 'Ortiqcha' : 'Yetishmaydi', value: Math.abs(round2(total - paid)), tone: 'bad' as const }] : []),
        ]} />
      </div>
      <FormError error={localError || create.error} />
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Bekor qilish</button><button className="button primary" disabled={create.isPending || !lines.length} data-testid="button-save-receipt">{create.isPending ? 'Saqlanmoqda…' : `Chekni yopish · ${money(total)} soʻm`}</button></div>
    </form>
  </Modal>;
}
