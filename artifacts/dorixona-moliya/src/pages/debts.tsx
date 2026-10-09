import { useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowDownLeft, ArrowUpRight, Banknote, CalendarClock, FileX2, HandCoins, Plus, Undo2, Users } from 'lucide-react';
import { getGetDebtQueryKey, useCreateDebt, useCreateDebtOperation, useGetDebt, useListCounterpartyBalances, useListDebts } from '@workspace/api-client-react';
import type { CounterpartyBalance, Debt, DebtOperationInputKind } from '@workspace/api-client-react';
import {
  AccountSelect, BranchSelect, Chips, CounterpartyField, DataState, Drawer, FormError, InfoGrid, KpiStrip, Modal, PageHeading,
  Panel, SearchBox, StatusBadge, TableWrap, Totals, date, dateTime, localToIso, money, nowLocal, num, round2, toMoney, today,
  useRefreshAll, type Filters,
} from '@/components/kit';
import { debtOperationLabels, debtOriginLabels, debtStateLabels } from '@/lib/labels';

type Kind = 'payable' | 'receivable';
type Status = 'open' | 'overdue' | 'closed' | 'all';

function Progress({ debt }: { debt: Debt }) {
  const initial = num(debt.initialAmount);
  const settled = num(debt.paidAmount) + num(debt.returnedAmount);
  const pct = initial > 0 ? Math.min(100, Math.round(settled / initial * 100)) : 0;
  return <div className={`progress ${debt.state}`} title={`${pct}% yopilgan`}><i style={{ width: `${pct}%` }} /><span>{pct}%</span></div>;
}

function DebtState({ debt }: { debt: Debt }) {
  const s = debtStateLabels[debt.state];
  return <StatusBadge tone={s.tone}>{s.label}{debt.state === 'overdue' && debt.overdueDays ? ` · ${debt.overdueDays} kun` : ''}</StatusBadge>;
}

export function DebtsPage({ filters }: { filters: Filters }) {
  const [kind, setKind] = useState<Kind>('payable');
  const [view, setView] = useState<'documents' | 'counterparties'>('documents');
  const [status, setStatus] = useState<Status>('open');
  const [search, setSearch] = useState('');
  const [counterparty, setCounterparty] = useState<{ id: number | null; name: string } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const branchId = filters.branchId ? Number(filters.branchId) : undefined;

  const debtsQ = useListDebts({ branchId, kind, status, search: (counterparty && !counterparty.id ? counterparty.name : search) || undefined, counterpartyId: counterparty?.id ?? undefined });
  const balancesQ = useListCounterpartyBalances({ branchId });
  const balances = balancesQ.data || [];
  const debts = debtsQ.data || [];

  const totals = useMemo(() => {
    const of = (k: Kind) => balances.filter(b => b.kind === k);
    const sum = (rows: CounterpartyBalance[], pick: (b: CounterpartyBalance) => string) => round2(rows.reduce((s, b) => s + num(pick(b)), 0));
    return {
      payable: sum(of('payable'), b => b.balance), payableOverdue: sum(of('payable'), b => b.overdueAmount), payableCount: of('payable').filter(b => num(b.balance) > 0).length,
      receivable: sum(of('receivable'), b => b.balance), receivableOverdue: sum(of('receivable'), b => b.overdueAmount), receivableCount: of('receivable').filter(b => num(b.balance) > 0).length,
      paid: sum(of(kind), b => b.paidAmount), returned: sum(of(kind), b => b.returnedAmount),
    };
  }, [balances, kind]);

  const term = search.trim().toLowerCase();
  const cpRows = balances.filter(b => b.kind === kind && (status === 'all' || (status === 'closed' ? num(b.balance) === 0 : status === 'overdue' ? num(b.overdueAmount) > 0 : num(b.balance) > 0)) && (!term || b.counterparty.toLowerCase().includes(term)));
  const listTotal = round2(debts.reduce((s, d) => s + num(d.balance), 0));

  return <>
    <PageHeading eyebrow="QARZLAR · ДОЛГИ" title="Qarzlar" subtitle="Kimga qarzmiz va kim bizdan qarzdor: paydo boʻlish sanasi, toʻlovlar, qaytarishlar, muddati oʻtganlar va toʻliq tarix" actions={<button className="button primary" onClick={() => setCreating(true)} data-testid="button-new-debt"><Plus size={16} /> Qarz kiritish</button>} />
    <KpiStrip items={[
      { label: 'Biz qarzdormiz', value: totals.payable, icon: ArrowUpRight, tone: totals.payable ? 'warn' : undefined, hint: `${totals.payableCount} ta yetkazib beruvchi` },
      { label: 'Shundan muddati oʻtgan', value: totals.payableOverdue, icon: AlertCircle, tone: totals.payableOverdue ? 'bad' : undefined },
      { label: 'Bizdan qarzdorlar', value: totals.receivable, icon: ArrowDownLeft, tone: totals.receivable ? 'good' : undefined, hint: `${totals.receivableCount} ta mijoz` },
      { label: 'Shundan muddati oʻtgan', value: totals.receivableOverdue, icon: AlertCircle, tone: totals.receivableOverdue ? 'bad' : undefined },
      { label: 'Sof pozitsiya', value: round2(totals.receivable - totals.payable), icon: HandCoins, tone: totals.receivable - totals.payable < 0 ? 'bad' : 'good', hint: 'Debitor − kreditor' },
      { label: kind === 'payable' ? 'Yetkazib beruvchilarga toʻlangan' : 'Mijozlardan undirilgan', value: totals.paid, icon: Banknote },
      { label: 'Qaytarishlar bilan yopilgan', value: totals.returned, icon: Undo2 },
    ]} />
    <div className="tabs">
      <button className={kind === 'payable' ? 'selected' : ''} onClick={() => { setKind('payable'); setCounterparty(null); }} data-testid="tab-payables"><ArrowUpRight size={15} /> Biz qarzdormiz (kreditorlar)</button>
      <button className={kind === 'receivable' ? 'selected' : ''} onClick={() => { setKind('receivable'); setCounterparty(null); }} data-testid="tab-receivables"><ArrowDownLeft size={15} /> Bizdan qarzdorlar (debitorlar)</button>
    </div>
    <Panel title={view === 'documents' ? (counterparty ? `${counterparty.name} — qarz hujjatlari` : kind === 'payable' ? 'Yetkazib beruvchilarga qarzlar' : 'Mijozlar qarzlari') : kind === 'payable' ? 'Yetkazib beruvchilar kesimida' : 'Mijozlar kesimida'}
      subtitle={view === 'documents' ? `${debts.length} ta hujjat · qoldiq ${money(listTotal)} soʻm` : 'Hamkorni bosib uning hujjatlarini koʻring'}
      action={<div className="toolbar">
        <Chips value={view} onChange={v => { setView(v); setCounterparty(null); }} options={[{ id: 'documents', label: 'Hujjatlar' }, { id: 'counterparties', label: 'Hamkorlar' }]} />
        <Chips value={status} onChange={setStatus} options={[{ id: 'open', label: 'Ochiq' }, { id: 'overdue', label: 'Muddati oʻtgan' }, { id: 'closed', label: 'Yopilgan' }, { id: 'all', label: 'Barchasi' }]} />
        <SearchBox value={search} onChange={v => { setSearch(v); setCounterparty(null); }} placeholder="Hamkor yoki hujjat" />
      </div>}>
      {counterparty && <div className="filter-pill">Hamkor: <b>{counterparty.name}</b><button className="link-button" onClick={() => setCounterparty(null)}>Filtrni olib tashlash</button></div>}
      {view === 'documents' ? <>
        <DataState loading={debtsQ.isLoading} error={debtsQ.isError} empty={!debtsQ.isLoading && !debtsQ.isError && !debts.length} retry={() => debtsQ.refetch()} emptyText={status === 'overdue' ? 'Muddati oʻtgan qarz yoʻq.' : 'Bu holatda qarz hujjati yoʻq.'} />
        {!!debts.length && <TableWrap><thead><tr><th>HAMKOR</th><th>HUJJAT / MANBA</th><th>FILIAL</th><th>PAYDO BOʻLGAN</th><th>MUDDAT</th><th className="num">BOSHLANGʻICH</th><th className="num">TOʻLANGAN</th><th className="num">QAYTARILGAN</th><th className="num">QOLDIQ</th><th>YOPILISH</th><th>HOLAT</th></tr></thead>
          <tbody>{debts.map(d => <tr key={d.id} className="clickable" onClick={() => setSelected(d.id)} data-testid={`row-debt-${d.id}`}>
            <td className="cell-strong">{d.counterparty}</td>
            <td>{d.documentNo || '—'}<small>{debtOriginLabels[d.originType] ?? d.originType}</small></td>
            <td>{d.branchName}</td>
            <td>{date(d.issuedDate)}</td>
            <td className={d.state === 'overdue' ? 'negative' : ''}>{date(d.dueDate)}{d.state === 'overdue' && <small>{d.overdueDays} kun oʻtdi</small>}</td>
            <td className="num">{money(d.initialAmount)}</td>
            <td className="num positive">{num(d.paidAmount) ? money(d.paidAmount) : '—'}</td>
            <td className="num">{num(d.returnedAmount) ? money(d.returnedAmount) : '—'}</td>
            <td className="num cell-strong">{money(d.balance)}</td>
            <td><Progress debt={d} /></td>
            <td><DebtState debt={d} /></td>
          </tr>)}</tbody></TableWrap>}
      </> : <>
        <DataState loading={balancesQ.isLoading} error={balancesQ.isError} empty={!balancesQ.isLoading && !balancesQ.isError && !cpRows.length} retry={() => balancesQ.refetch()} />
        {!!cpRows.length && <TableWrap><thead><tr><th>HAMKOR</th><th className="num">HUJJATLAR</th><th>ILK QARZ</th><th>ENG YAQIN MUDDAT</th><th className="num">JAMI QARZ</th><th className="num">TOʻLANGAN</th><th className="num">QAYTARILGAN</th><th className="num">QOLDIQ</th><th className="num">MUDDATI OʻTGAN</th></tr></thead>
          <tbody>{cpRows.map(b => <tr key={`${b.counterpartyId}-${b.counterparty}`} className="clickable" onClick={() => { setCounterparty({ id: b.counterpartyId, name: b.counterparty }); setView('documents'); setStatus('all'); }}>
            <td className="cell-strong"><Users size={13} /> {b.counterparty}</td>
            <td className="num">{b.debts}</td>
            <td>{date(b.firstIssuedDate)}</td>
            <td>{date(b.nearestDueDate)}</td>
            <td className="num">{money(b.initialAmount)}</td>
            <td className="num positive">{money(b.paidAmount)}</td>
            <td className="num">{num(b.returnedAmount) ? money(b.returnedAmount) : '—'}</td>
            <td className="num cell-strong">{money(b.balance)}</td>
            <td className={`num ${num(b.overdueAmount) ? 'negative cell-strong' : ''}`}>{num(b.overdueAmount) ? money(b.overdueAmount) : '—'}</td>
          </tr>)}</tbody></TableWrap>}
      </>}
    </Panel>
    {selected != null && <DebtDrawer id={selected} onClose={() => setSelected(null)} />}
    {creating && <NewDebtModal kind={kind} defaultBranch={filters.branchId} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); setSelected(id); }} />}
  </>;
}

function DebtDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const params = { debtId: id };
  const q = useGetDebt(params, { query: { queryKey: getGetDebtQueryKey(params) } });
  const [op, setOp] = useState<DebtOperationInputKind | null>(null);
  const d = q.data?.debt;
  const open = !!d && num(d.balance) > 0 && d.state !== 'cancelled';
  return <Drawer eyebrow={d?.kind === 'receivable' ? 'DEBITORLIK QARZI' : 'KREDITORLIK QARZI'} title={d ? d.counterparty : 'Qarz'} subtitle={d && <><DebtState debt={d} /> <span>{d.documentNo}</span></>} onClose={onClose}
    actions={open && <>
      <button className="button primary" onClick={() => setOp('payment')} data-testid="button-debt-payment"><Banknote size={15} /> {d!.kind === 'payable' ? 'Toʻlov qilish' : 'Toʻlov qabul qilish'}</button>
      <button className="button secondary" onClick={() => setOp('return')} data-testid="button-debt-return"><Undo2 size={15} /> Qaytarish bilan yopish</button>
      <button className="button ghost" onClick={() => setOp('writeoff')} data-testid="button-debt-writeoff"><FileX2 size={15} /> Hisobdan chiqarish</button>
    </>}>
    <DataState loading={q.isLoading} error={q.isError} empty={false} retry={() => q.refetch()} />
    {d && q.data && <>
      <InfoGrid items={[
        { label: d.kind === 'payable' ? 'Kreditor (kimga qarzmiz)' : 'Debitor (kim qarzdor)', value: d.counterparty },
        { label: 'Hujjat', value: d.documentNo || '—' },
        { label: 'Qarz manbai', value: debtOriginLabels[d.originType] ?? d.originType },
        { label: 'Filial', value: d.branchName },
        { label: 'Paydo boʻlgan sana', value: date(d.issuedDate) },
        { label: 'Toʻlov muddati', value: <span className={d.state === 'overdue' ? 'negative' : ''}>{date(d.dueDate)}{d.state === 'overdue' ? ` (${d.overdueDays} kun oʻtdi)` : ''}</span> },
        ...(d.note ? [{ label: 'Izoh', value: d.note }] : []),
      ]} />
      <div className="detail-columns">
        <div>
          <h3 className="subhead">Operatsiyalar tarixi</h3>
          <TableWrap><thead><tr><th>SANA</th><th>OPERATSIYA</th><th>HISOB / IZOH</th><th className="num">SUMMA</th><th className="num">QOLDIQ</th></tr></thead>
            <tbody>{q.data.operations.map(o => <tr key={`${o.kind}-${o.id}`}>
              <td>{dateTime(o.date)}<small>{o.createdBy || ''}</small></td>
              <td><StatusBadge tone={o.kind === 'initial' ? 'info' : o.kind === 'payment' ? 'good' : o.kind === 'return' ? 'warn' : 'neutral'}>{debtOperationLabels[o.kind]}</StatusBadge></td>
              <td>{o.accountName || '—'}{o.note && <small>{o.note}</small>}</td>
              <td className={`num cell-strong ${o.kind === 'initial' ? '' : 'positive'}`}>{o.kind === 'initial' ? '+' : '−'}{money(o.amount)}</td>
              <td className="num">{money(o.balanceAfter)}</td>
            </tr>)}</tbody></TableWrap>
        </div>
        <Totals rows={[
          { label: 'Boshlangʻich qarz', value: d.initialAmount },
          { label: 'Toʻlangan', value: d.paidAmount, tone: 'good' },
          { label: 'Qaytarish / hisobdan chiqarish', value: d.returnedAmount },
          { label: 'Qolgan qarz', value: d.balance, strong: true, tone: num(d.balance) ? 'bad' : 'good' },
        ]} />
      </div>
    </>}
    {op && d && <DebtOperationModal debtId={d.id} kind={op} balance={d.balance} title={`${d.counterparty} · ${d.documentNo}`} debtKind={d.kind} branchId={String(d.branchId)} onClose={() => setOp(null)} />}
  </Drawer>;
}

export function DebtOperationModal({ debtId, kind: initialKind, balance, title, debtKind, branchId, onClose }: { debtId: number; kind: DebtOperationInputKind; balance: string; title: string; debtKind: Kind; branchId: string; onClose: () => void }) {
  const refresh = useRefreshAll();
  const create = useCreateDebtOperation();
  const [kind, setKind] = useState<DebtOperationInputKind>(initialKind);
  const [amount, setAmount] = useState(balance);
  const [accountId, setAccountId] = useState('');
  const [when, setWhen] = useState(nowLocal());
  const [note, setNote] = useState('');
  const left = round2(num(balance) - num(amount));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ data: { debtId, kind, amount: toMoney(num(amount)), date: localToIso(when), accountId: kind === 'payment' ? Number(accountId) : null, note } }, { onSuccess: () => { refresh(); onClose(); } });
  };
  const hints: Record<DebtOperationInputKind, string> = {
    payment: debtKind === 'payable' ? 'Pul tanlangan kassa yoki bank hisobidan chiqadi.' : 'Pul tanlangan kassa yoki bank hisobiga kiradi.',
    return: 'Tovar qaytarilishi hisobiga qarz kamayadi; pul harakati boʻlmaydi.',
    writeoff: 'Undirib boʻlmaydigan yoki kechilgan qarz; pul harakati boʻlmaydi.',
  };
  return <Modal eyebrow="QARZ OPERATSIYASI" title={title} onClose={onClose} busy={create.isPending}>
    <form className="form-stack" onSubmit={submit}>
      <Chips value={kind} onChange={setKind} options={[{ id: 'payment', label: debtKind === 'payable' ? 'Toʻlov' : 'Undirish' }, { id: 'return', label: 'Qaytarish' }, { id: 'writeoff', label: 'Hisobdan chiqarish' }]} />
      <div className="notice info">{hints[kind]}</div>
      <div className="form-grid">
        <label>Summa (soʻm)<div className="input-with-action"><input type="number" required min="0.01" max={num(balance)} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /><button type="button" className="button ghost small" onClick={() => setAmount(balance)}>Toʻliq</button></div></label>
        <label>Sana va vaqt<input type="datetime-local" required value={when} onChange={e => setWhen(e.target.value)} /></label>
        {kind === 'payment' && <AccountSelect value={accountId} onChange={setAccountId} branchId={branchId} required label={debtKind === 'payable' ? 'Qaysi hisobdan toʻlanadi' : 'Qaysi hisobga tushadi'} />}
        <label className={kind === 'payment' ? '' : 'span-2'}>Izoh <span className="optional">ixtiyoriy</span><input value={note} onChange={e => setNote(e.target.value)} /></label>
      </div>
      <Totals rows={[
        { label: 'Hozirgi qoldiq', value: balance },
        { label: debtOperationLabels[kind], value: num(amount) },
        { label: 'Operatsiyadan keyin', value: Math.max(0, left), strong: true, tone: left <= 0 ? 'good' : 'bad' },
      ]} />
      <FormError error={left < 0 ? 'Summa qarz qoldigʻidan oshib ketdi.' : create.error} />
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Yopish</button><button className="button primary" disabled={create.isPending || left < 0 || num(amount) <= 0} data-testid="button-confirm-debt-op">{create.isPending ? 'Saqlanmoqda…' : 'Saqlash'}</button></div>
    </form>
  </Modal>;
}

function NewDebtModal({ kind: initialKind, defaultBranch, onClose, onCreated }: { kind: Kind; defaultBranch: string; onClose: () => void; onCreated: (id: number) => void }) {
  const refresh = useRefreshAll();
  const create = useCreateDebt();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [cp, setCp] = useState({ name: '', id: null as number | null });
  const [form, setForm] = useState({ branchId: defaultBranch, documentNo: '', issuedDate: today, dueDate: '', amount: '', originType: 'manual' as 'manual' | 'opening', note: '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ data: { kind, counterpartyId: cp.id, counterparty: cp.name.trim(), branchId: Number(form.branchId), documentNo: form.documentNo, issuedDate: form.issuedDate, dueDate: form.dueDate || form.issuedDate, amount: toMoney(num(form.amount)), originType: form.originType, note: form.note } }, { onSuccess: res => { refresh(); onCreated(res.id); } });
  };
  return <Modal eyebrow="QARZ KIRITISH" title="Yangi qarz yozuvi" onClose={onClose} busy={create.isPending} size="lg">
    <form className="form-stack" onSubmit={submit}>
      <Chips value={kind} onChange={v => { setKind(v); setCp({ name: '', id: null }); }} options={[{ id: 'payable', label: 'Biz qarzdormiz (yetkazib beruvchiga)' }, { id: 'receivable', label: 'Bizdan qarzdor (mijoz)' }]} />
      <div className="form-grid">
        <CounterpartyField kind={kind === 'payable' ? 'supplier' : 'customer'} label={kind === 'payable' ? 'Yetkazib beruvchi' : 'Mijoz'} value={cp.name} onChange={(name, id) => setCp({ name, id })} />
        <BranchSelect value={form.branchId} onChange={v => set({ branchId: v })} />
        <label>Qarz turi<select value={form.originType} onChange={e => set({ originType: e.target.value as 'manual' | 'opening' })}><option value="manual">Qoʻlda kiritilgan qarz</option><option value="opening">Boshlangʻich qoldiq (dastur oldidan)</option></select></label>
        <label>Hujjat raqami <span className="optional">ixtiyoriy</span><input value={form.documentNo} onChange={e => set({ documentNo: e.target.value })} placeholder="Avtomatik: QRZ-000123" /></label>
        <label>Paydo boʻlgan sana<input type="date" required value={form.issuedDate} onChange={e => set({ issuedDate: e.target.value })} /></label>
        <label>Toʻlov muddati<input type="date" min={form.issuedDate} value={form.dueDate} onChange={e => set({ dueDate: e.target.value })} /><span className="field-hint"><CalendarClock size={12} /> Boʻsh qolsa — paydo boʻlgan kun</span></label>
        <label>Summa (soʻm)<input type="number" required min="0.01" step="0.01" value={form.amount} onChange={e => set({ amount: e.target.value })} /></label>
        <label>Izoh <span className="optional">ixtiyoriy</span><input value={form.note} onChange={e => set({ note: e.target.value })} /></label>
      </div>
      <div className="notice info">Kirim (nakladnoy) va nasiya savdo qarzlari avtomatik yaratiladi — bu yerda faqat boshqa qarzlar yoki dastur oldidan qolgan qoldiqlar kiritiladi.</div>
      <FormError error={create.error} />
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Bekor qilish</button><button className="button primary" disabled={create.isPending} data-testid="button-save-debt">{create.isPending ? 'Saqlanmoqda…' : 'Qarzni saqlash'}</button></div>
    </form>
  </Modal>;
}
