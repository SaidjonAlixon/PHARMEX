import { useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, Banknote, CalendarClock, FileText, PackagePlus, Plus, Trash2, Truck, Undo2, Wallet } from 'lucide-react';
import { getGetPurchaseQueryKey, useCreatePurchase, useGetPurchase, useListPurchases } from '@workspace/api-client-react';
import type { Purchase } from '@workspace/api-client-react';
import {
  AccountSelect, BranchSelect, Chips, CounterpartyField, DataState, Drawer, FormError, InfoGrid, KpiStrip, Modal,
  PageHeading, Panel, ProductPicker, SearchBox, StatusBadge, TableWrap, Totals, date, dateTime, filterParams, includedVat,
  localToIso, money, nowLocal, num, qty, round2, toMoney, today, useRefreshAll, type Filters, type PickedProduct,
} from '@/components/kit';
import { debtOperationLabels, purchaseStatusLabels } from '@/lib/labels';
import { DebtOperationModal } from './debts';
import { StockDocumentModal } from './stock';
import { useAccess } from '@/lib/access';

type Status = 'all' | 'unpaid' | 'partial' | 'paid' | 'overdue';

export function PurchasesPage({ filters }: { filters: Filters }) {
  const { canEdit } = useAccess();
  const [status, setStatus] = useState<Status>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const q = useListPurchases({ ...filterParams(filters), search: search || undefined });
  const all = q.data || [];
  const rows = status === 'all' ? all : all.filter(p => p.paymentStatus === status);
  const stats = useMemo(() => {
    const sum = (pick: (p: Purchase) => string) => round2(all.reduce((s, p) => s + num(pick(p)), 0));
    const count = (s: string) => all.filter(p => p.paymentStatus === s).length;
    return {
      total: sum(p => p.totalAmount), paid: sum(p => p.paidAmount), balance: sum(p => p.balance), discount: sum(p => p.discount),
      extra: sum(p => p.extraCosts), vat: sum(p => p.vatAmount), returned: sum(p => p.returnedAmount),
      overdue: round2(all.filter(p => p.paymentStatus === 'overdue').reduce((s, p) => s + num(p.balance), 0)),
      counts: { all: all.length, unpaid: count('unpaid'), partial: count('partial'), paid: count('paid'), overdue: count('overdue') },
    };
  }, [all]);

  return <>
    <PageHeading eyebrow="KIRIM · ПРИХОД" title="Kirim" subtitle="Yetkazib beruvchilardan tovar qabul qilish: nakladnoy, hisob-faktura, xarid narxi, chegirma, qoʻshimcha xarajat va qarz" actions={canEdit && <button className="button primary" onClick={() => setCreating(true)} data-testid="button-new-purchase"><Plus size={16} /> Yangi kirim</button>} />
    <KpiStrip items={[
      { label: 'Kirim hujjatlari', value: all.length, count: true, icon: FileText },
      { label: 'Jami summa', value: stats.total, icon: Truck, hint: `Chegirma ${money(stats.discount)} · Xarajat ${money(stats.extra)}` },
      { label: 'Shu jumladan QQS', value: stats.vat, icon: FileText },
      { label: 'Toʻlangan', value: stats.paid, icon: Banknote, tone: 'good' },
      { label: 'Qaytarilgan tovar', value: stats.returned, icon: Undo2 },
      { label: 'Qolgan qarz', value: stats.balance, icon: Wallet, tone: stats.balance ? 'warn' : undefined },
      { label: 'Muddati oʻtgan', value: stats.overdue, icon: AlertCircle, tone: stats.overdue ? 'bad' : undefined, hint: `${stats.counts.overdue} ta hujjat` },
    ]} />
    <Panel title="Kirim hujjatlari" subtitle="Qatorni bosib tafsilot, toʻlov tarixi va qaytarishlarni koʻring" action={<div className="toolbar"><Chips value={status} onChange={setStatus} options={[
      { id: 'all', label: 'Barchasi', count: stats.counts.all }, { id: 'unpaid', label: 'Toʻlanmagan', count: stats.counts.unpaid }, { id: 'partial', label: 'Qisman', count: stats.counts.partial }, { id: 'paid', label: 'Toʻlangan', count: stats.counts.paid }, { id: 'overdue', label: 'Muddati oʻtgan', count: stats.counts.overdue },
    ]} /><SearchBox value={search} onChange={setSearch} placeholder="Yetkazib beruvchi, hujjat, EHF" /></div>}>
      <DataState loading={q.isLoading} error={q.isError} empty={!q.isLoading && !q.isError && !rows.length} retry={() => q.refetch()} emptyText="Kirim hujjatlari yoʻq. “Yangi kirim” orqali yetkazib beruvchidan tovar qabul qiling." />
      {!!rows.length && <TableWrap><thead><tr><th>HUJJAT / SANA</th><th>YETKAZIB BERUVCHI</th><th>HISOB-FAKTURA / EHF</th><th>FILIAL</th><th className="num">POZ.</th><th className="num">CHEGIRMA</th><th className="num">QOʻSH. XARAJAT</th><th className="num">JAMI</th><th className="num">TOʻLANGAN</th><th className="num">QOLDIQ</th><th>MUDDAT</th><th>HOLAT</th></tr></thead>
        <tbody>{rows.map(p => <tr key={p.id} className="clickable" onClick={() => setSelected(p.id)} data-testid={`row-purchase-${p.id}`}>
          <td><span className="table-main-link">{p.documentNo}</span><small>{dateTime(p.receivedAt)}</small></td>
          <td className="cell-strong">{p.supplierName}</td>
          <td>{p.invoiceNo || '—'}<small>{p.eInvoiceId ? `EHF ${p.eInvoiceId}` : 'EHF yoʻq'}</small></td>
          <td>{p.branchName}</td>
          <td className="num">{p.itemsCount}</td>
          <td className="num">{num(p.discount) ? money(p.discount) : '—'}</td>
          <td className="num">{num(p.extraCosts) ? money(p.extraCosts) : '—'}</td>
          <td className="num cell-strong">{money(p.totalAmount)}</td>
          <td className="num positive">{money(p.paidAmount)}</td>
          <td className={`num ${num(p.balance) ? 'cell-strong' : ''}`}>{money(p.balance)}</td>
          <td className={p.paymentStatus === 'overdue' ? 'negative' : ''}>{date(p.dueDate)}</td>
          <td><StatusBadge tone={purchaseStatusLabels[p.paymentStatus].tone}>{purchaseStatusLabels[p.paymentStatus].label}</StatusBadge></td>
        </tr>)}</tbody></TableWrap>}
    </Panel>
    {selected != null && <PurchaseDrawer id={selected} onClose={() => setSelected(null)} />}
    {creating && <NewPurchaseModal defaultBranch={filters.branchId} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); setSelected(id); }} />}
  </>;
}

function PurchaseDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const params = { purchaseId: id };
  const q = useGetPurchase(params, { query: { queryKey: getGetPurchaseQueryKey(params) } });
  const [action, setAction] = useState<'pay' | 'return' | null>(null);
  const { canEdit } = useAccess();
  const d = q.data;
  const p = d?.purchase;
  return <Drawer eyebrow="KIRIM HUJJATI" title={p ? `${p.documentNo} · ${p.supplierName}` : 'Kirim'} subtitle={p && <><StatusBadge tone={purchaseStatusLabels[p.paymentStatus].tone}>{purchaseStatusLabels[p.paymentStatus].label}</StatusBadge> <span>{dateTime(p.receivedAt)}</span></>} onClose={onClose}
    actions={canEdit && p && <>
      <button className="button primary" disabled={!p.debtId || !num(p.balance)} onClick={() => setAction('pay')} data-testid="button-pay-purchase"><Banknote size={15} /> Toʻlov qilish</button>
      <button className="button secondary" onClick={() => setAction('return')} data-testid="button-return-purchase"><Undo2 size={15} /> Yetkazib beruvchiga qaytarish</button>
    </>}>
    <DataState loading={q.isLoading} error={q.isError} empty={false} retry={() => q.refetch()} />
    {d && p && <>
      <InfoGrid items={[
        { label: 'Yetkazib beruvchi', value: p.supplierName },
        { label: 'Qabul qiluvchi', value: p.branchName },
        { label: 'Nakladnoy', value: p.documentNo },
        { label: 'Hisob-faktura', value: p.invoiceNo ? `${p.invoiceNo}${p.invoiceDate ? ` · ${date(p.invoiceDate)}` : ''}` : '—' },
        { label: 'Elektron hisob-faktura (EHF)', value: p.eInvoiceId || '—' },
        { label: 'Qabul vaqti', value: dateTime(p.receivedAt) },
        { label: 'Toʻlov muddati', value: <span className={p.paymentStatus === 'overdue' ? 'negative' : ''}>{date(p.dueDate)}</span> },
        { label: 'Kiritgan', value: p.createdBy || '—' },
        ...(p.extraCostsNote ? [{ label: 'Qoʻshimcha xarajat izohi', value: p.extraCostsNote }] : []),
        ...(p.note ? [{ label: 'Izoh', value: p.note }] : []),
      ]} />
      <h3 className="subhead">Tovarlar</h3>
      <TableWrap><thead><tr><th>MAHSULOT / KOD</th><th className="num">MIQDOR</th><th className="num">XARID NARXI</th><th className="num">CHEGIRMA</th><th className="num">SUMMA</th><th className="num">QQS</th><th className="num">TANNARX (TAQSIMLANGAN)</th><th>YAROQLILIK</th></tr></thead>
        <tbody>{d.lines.map(l => <tr key={l.id}><td className="cell-strong">{l.productName}<small>{l.productCode || '—'} · {l.unit}</small></td><td className="num">{qty(l.quantity)}</td><td className="num">{money(l.unitCost)}</td><td className="num">{num(l.discount) ? money(l.discount) : '—'}</td><td className="num">{money(l.total)}</td><td className="num">{l.vatRate ? `${l.vatRate}%` : 'QQSsiz'}</td><td className="num cell-strong">{money(l.landedUnitCost)}</td><td>{date(l.expiryDate)}</td></tr>)}</tbody></TableWrap>
      <div className="detail-columns">
        <div>
          <h3 className="subhead">Toʻlovlar va qarz tarixi</h3>
          {d.operations.length ? <div className="timeline">{d.operations.map(o => <div key={`${o.kind}-${o.id}`} className={`timeline-item ${o.kind}`}><span className="dot" /><div><b>{debtOperationLabels[o.kind]}</b><small>{dateTime(o.date)}{o.accountName ? ` · ${o.accountName}` : ''}{o.note ? ` · ${o.note}` : ''}</small></div><div className="timeline-amount"><b className={o.kind === 'initial' ? '' : 'positive'}>{o.kind === 'initial' ? '' : '−'}{money(o.amount)}</b><small>Qoldiq {money(o.balanceAfter)}</small></div></div>)}</div> : <div className="inline-empty">Toʻlovlar yoʻq</div>}
        </div>
        <Totals rows={[
          { label: 'Tovarlar summasi', value: p.itemsTotal },
          { label: 'Hujjat chegirmasi', value: p.discount },
          { label: 'Qoʻshimcha xarajatlar', value: p.extraCosts },
          { label: 'Jami', value: p.totalAmount, strong: true },
          { label: 'Shu jumladan QQS', value: p.vatAmount },
          { label: 'Toʻlangan', value: p.paidAmount, tone: 'good' },
          { label: 'Qaytarilgan tovar', value: p.returnedAmount },
          { label: 'Qolgan qarz', value: p.balance, strong: true, tone: num(p.balance) ? 'bad' : 'good' },
        ]} />
      </div>
      {!!d.returns.length && <><h3 className="subhead">Yetkazib beruvchiga qaytarishlar</h3>
        <TableWrap><thead><tr><th>HUJJAT</th><th>SANA</th><th>SABAB</th><th className="num">QIYMAT</th></tr></thead><tbody>{d.returns.map(r => <tr key={r.id}><td className="cell-strong">{r.documentNo}</td><td>{dateTime(r.occurredAt)}</td><td>{r.reason || '—'}</td><td className="num">{money(r.totalCost)}</td></tr>)}</tbody></TableWrap></>}
    </>}
    {action === 'pay' && p?.debtId && <DebtOperationModal debtId={p.debtId} kind="payment" balance={p.balance} title={`${p.documentNo} · ${p.supplierName}`} debtKind="payable" branchId={String(p.branchId)} onClose={() => setAction(null)} />}
    {action === 'return' && p && <StockDocumentModal docType="supplier_return" defaultBranch={String(p.branchId)} purchase={p} onClose={() => setAction(null)} />}
  </Drawer>;
}

type Line = { productId: number; name: string; code: string; unit: string; quantity: string; unitCost: string; discount: string; vatRate: string; retailPrice: string; expiryDate: string };

function NewPurchaseModal({ defaultBranch, onClose, onCreated }: { defaultBranch: string; onClose: () => void; onCreated: (id: number) => void }) {
  const refresh = useRefreshAll();
  const create = useCreatePurchase();
  const [form, setForm] = useState({ branchId: defaultBranch, documentNo: '', invoiceNo: '', eInvoiceId: '', invoiceDate: today, receivedAt: nowLocal(), discount: '', extraCosts: '', extraCostsNote: '', dueDate: '', paidAmount: '', paymentAccountId: '', note: '' });
  const [supplier, setSupplier] = useState({ name: '', id: null as number | null });
  const [lines, setLines] = useState<Line[]>([]);
  const [localError, setLocalError] = useState('');
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  const nets = lines.map(l => round2(num(l.quantity) * num(l.unitCost) - num(l.discount)));
  const itemsTotal = round2(nets.reduce((s, v) => s + v, 0));
  const total = round2(itemsTotal - num(form.discount) + num(form.extraCosts));
  const vat = round2(lines.reduce((s, l, i) => s + includedVat(nets[i], num(l.vatRate)), 0));
  const paid = num(form.paidAmount);
  const adjustment = num(form.extraCosts) - num(form.discount);
  const landed = (i: number) => num(lines[i].quantity) > 0 ? round2((nets[i] + (itemsTotal ? adjustment * nets[i] / itemsTotal : 0)) / num(lines[i].quantity)) : 0;

  const addProduct = (p: PickedProduct) => {
    if (lines.some(l => l.productId === p.id)) return;
    setLines([...lines, { productId: p.id, name: p.name, code: p.code || p.barcode || '', unit: p.unit, quantity: '1', unitCost: p.costPrice || '', discount: '0', vatRate: String(p.vatRate ?? 0), retailPrice: p.retailPrice, expiryDate: '' }]);
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => j === i ? { ...l, ...patch } : l));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError('');
    if (!lines.length) return setLocalError('Kamida bitta mahsulot qoʻshing.');
    if (num(form.discount) > itemsTotal) return setLocalError('Hujjat chegirmasi tovarlar summasidan katta.');
    if (paid > total) return setLocalError('Toʻlangan summa hujjat summasidan katta.');
    if (paid > 0 && !form.paymentAccountId) return setLocalError('Toʻlov qaysi kassa yoki bank hisobidan qilinganini tanlang.');
    create.mutate({ data: {
      branchId: Number(form.branchId), counterpartyId: supplier.id, supplierName: supplier.name.trim(), documentNo: form.documentNo, invoiceNo: form.invoiceNo, eInvoiceId: form.eInvoiceId,
      invoiceDate: form.invoiceDate || null, receivedAt: localToIso(form.receivedAt), discount: toMoney(num(form.discount)), extraCosts: toMoney(num(form.extraCosts)), extraCostsNote: form.extraCostsNote,
      dueDate: form.dueDate || null, note: form.note, paidAmount: toMoney(paid), paymentAccountId: form.paymentAccountId ? Number(form.paymentAccountId) : null,
      items: lines.map(l => ({ productId: l.productId, quantity: num(l.quantity), unitCost: toMoney(num(l.unitCost)), discount: toMoney(num(l.discount)), vatRate: num(l.vatRate), expiryDate: l.expiryDate || null, retailPrice: l.retailPrice ? toMoney(num(l.retailPrice)) : undefined })),
    } }, { onSuccess: res => { refresh(); onCreated(res.purchase.id); } });
  };

  return <Modal eyebrow="KIRIM · ПРИХОД" title="Yetkazib beruvchidan kirim" onClose={onClose} busy={create.isPending} size="xl">
    <form className="form-stack" onSubmit={submit}>
      <div className="form-section"><span className="eyebrow">HUJJAT</span>
        <div className="form-grid four">
          <CounterpartyField kind="supplier" label="Yetkazib beruvchi" value={supplier.name} onChange={(name, id) => setSupplier({ name, id })} />
          <BranchSelect value={form.branchId} onChange={v => set({ branchId: v })} label="Qabul qiluvchi (filial / ombor)" />
          <label>Nakladnoy raqami <span className="optional">ixtiyoriy</span><input value={form.documentNo} onChange={e => set({ documentNo: e.target.value })} placeholder="Avtomatik: KRM-000123" /></label>
          <label>Qabul vaqti<input type="datetime-local" required value={form.receivedAt} onChange={e => set({ receivedAt: e.target.value })} /></label>
          <label>Hisob-faktura raqami<input value={form.invoiceNo} onChange={e => set({ invoiceNo: e.target.value })} placeholder="HF-..." /></label>
          <label>Hisob-faktura sanasi<input type="date" value={form.invoiceDate} onChange={e => set({ invoiceDate: e.target.value })} /></label>
          <label>Elektron hisob-faktura ID<input value={form.eInvoiceId} onChange={e => set({ eInvoiceId: e.target.value })} placeholder="Didox / Faktura.uz ID" /></label>
          <label>Toʻlov muddati<input type="date" value={form.dueDate} onChange={e => set({ dueDate: e.target.value })} /><span className="field-hint">Boʻsh qolsa — qabul kuni</span></label>
        </div>
      </div>
      <div className="line-editor">
        <div className="line-editor-head"><b>Tovarlar</b><ProductPicker branchId={form.branchId || undefined} onPick={addProduct} /></div>
        {lines.length ? <TableWrap><thead><tr><th>MAHSULOT / KOD</th><th className="num">MIQDOR</th><th className="num">XARID NARXI</th><th className="num">CHEGIRMA</th><th className="num">QQS %</th><th className="num">SUMMA</th><th className="num">TANNARX</th><th className="num">SOTUV NARXI</th><th>YAROQLILIK</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => <tr key={l.productId}>
            <td className="cell-strong">{l.name}<small>{l.code || '—'} · {l.unit}</small></td>
            <td className="num"><input className="cell-input" type="number" min="0.001" step="0.001" required value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} /></td>
            <td className="num"><input className="cell-input wide" type="number" min="0" step="0.01" required value={l.unitCost} onChange={e => setLine(i, { unitCost: e.target.value })} /></td>
            <td className="num"><input className="cell-input wide" type="number" min="0" step="0.01" value={l.discount} onChange={e => setLine(i, { discount: e.target.value })} /></td>
            <td className="num"><input className="cell-input narrow" type="number" min="0" max="100" step="0.01" value={l.vatRate} onChange={e => setLine(i, { vatRate: e.target.value })} /></td>
            <td className="num cell-strong">{money(nets[i])}</td>
            <td className="num">{money(landed(i))}</td>
            <td className="num"><input className="cell-input wide" type="number" min="0" step="0.01" value={l.retailPrice} onChange={e => setLine(i, { retailPrice: e.target.value })} /></td>
            <td><input className="cell-input date" type="date" value={l.expiryDate} onChange={e => setLine(i, { expiryDate: e.target.value })} /></td>
            <td><button type="button" className="icon-button" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Oʻchirish"><Trash2 size={15} /></button></td>
          </tr>)}</tbody></TableWrap> : <div className="inline-empty"><PackagePlus size={17} /> Mahsulot qidirib qoʻshing. Yangi mahsulot boʻlsa — avval “Maʼlumotnomalar”da yarating.</div>}
      </div>
      <div className="detail-columns">
        <div className="form-section"><span className="eyebrow">CHEGIRMA, XARAJAT VA TOʻLOV</span>
          <div className="form-grid">
            <label>Hujjat chegirmasi (soʻm)<input type="number" min="0" step="0.01" value={form.discount} onChange={e => set({ discount: e.target.value })} placeholder="0" /></label>
            <label>Qoʻshimcha xarajatlar (soʻm)<input type="number" min="0" step="0.01" value={form.extraCosts} onChange={e => set({ extraCosts: e.target.value })} placeholder="0" /></label>
            <label className="span-2">Xarajat izohi<input value={form.extraCostsNote} onChange={e => set({ extraCostsNote: e.target.value })} placeholder="Yetkazib berish, yuklash, sertifikat…" /></label>
            <label>Hozir toʻlangan (soʻm)<input type="number" min="0" step="0.01" value={form.paidAmount} onChange={e => set({ paidAmount: e.target.value })} placeholder="0" /></label>
            <AccountSelect value={form.paymentAccountId} onChange={v => set({ paymentAccountId: v })} label="Toʻlov hisobi" emptyLabel="Toʻlov yoʻq" />
            <label className="span-2">Izoh<input value={form.note} onChange={e => set({ note: e.target.value })} /></label>
          </div>
          <span className="field-hint"><CalendarClock size={13} /> Chegirma va qoʻshimcha xarajatlar tovarlar tannarxiga summasiga mutanosib taqsimlanadi.</span>
        </div>
        <Totals rows={[
          { label: 'Tovarlar summasi', value: itemsTotal },
          { label: 'Hujjat chegirmasi', value: num(form.discount) },
          { label: 'Qoʻshimcha xarajatlar', value: num(form.extraCosts) },
          { label: 'Jami hujjat', value: total, strong: true },
          { label: 'Shu jumladan QQS', value: vat },
          { label: 'Toʻlangan', value: paid, tone: 'good' },
          { label: 'Qarz qoldigʻi', value: round2(total - paid), strong: true, tone: total - paid > 0 ? 'bad' : 'good' },
        ]} />
      </div>
      <FormError error={localError || create.error} />
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Bekor qilish</button><button className="button primary" disabled={create.isPending || !lines.length} data-testid="button-save-purchase">{create.isPending ? 'Saqlanmoqda…' : `Kirimni saqlash · ${money(total)} soʻm`}</button></div>
    </form>
  </Modal>;
}
