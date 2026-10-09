import { useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, Building, ClipboardList, Landmark, Plus, Receipt, UserRound, Vault, Wallet,
} from 'lucide-react';
import {
  useCreateCashAccount, useCreateMoneyOperation, useCreateMoneyTransfer, useGetCashRegister, useListCashAccounts, useListDebts,
  useListExpenses, useListMoneyTransactions,
} from '@workspace/api-client-react';
import type { CashRegisterRow, MoneyOperationType, MoneyTransaction } from '@workspace/api-client-react';
import {
  AccountSelect, BranchSelect, Chips, CounterpartyField, DataState, FormError, KpiStrip, Modal, PageHeading, Panel, SearchBox,
  TableWrap, Totals, date, dateTime, filterParams, localToIso, money, nowLocal, num, round2, sourceText, toMoney,
  useRefreshAll, type Filters,
} from '@/components/kit';
import { expenseCategories, moneyTypeLabels } from '@/lib/labels';
import { moneyTypeMenu } from '@/lib/menu-options';
import { SelectMenu, type MenuOption } from '@/components/select-menu';

type Tab = 'register' | 'operations' | 'expenses' | 'owners';
type Direction = 'all' | 'in' | 'out';

const incomeTypes: MoneyOperationType[] = ['cash_in', 'bank_receipt', 'customer_payment', 'owner_in'];
const outgoTypes: MoneyOperationType[] = ['expense', 'supplier_payment', 'cash_out', 'owner_out'];

export function MoneyPage({ filters }: { filters: Filters }) {
  const [tab, setTab] = useState<Tab>('register');
  const [direction, setDirection] = useState<Direction>('all');
  const [type, setType] = useState('');
  const [accountId, setAccountId] = useState('');
  const [search, setSearch] = useState('');
  const [operation, setOperation] = useState<{ type: MoneyOperationType; accountId?: number } | null>(null);
  const [transfer, setTransfer] = useState<{ kind: 'transfer' | 'encashment'; from?: number } | null>(null);
  const [newAccount, setNewAccount] = useState(false);
  const base = filterParams(filters);
  const registerQ = useGetCashRegister(base);
  const txQ = useListMoneyTransactions({ ...base, accountId: accountId ? Number(accountId) : undefined, type: type || undefined, direction: direction === 'all' ? undefined : direction, search: search || undefined });
  const expensesQ = useListExpenses(base, { query: { enabled: tab === 'expenses', queryKey: ['expenses', base] } });
  const ownersQ = useListMoneyTransactions(base, { query: { enabled: tab === 'owners', queryKey: ['money-owners', base] } });
  const register = registerQ.data || [];
  const txs = txQ.data || [];

  const totals = useMemo(() => {
    const sum = (rows: CashRegisterRow[], pick: (r: CashRegisterRow) => string) => round2(rows.reduce((s, r) => s + num(pick(r)), 0));
    const cash = register.filter(r => r.kind === 'cash');
    const bank = register.filter(r => r.kind === 'bank');
    return {
      opening: sum(register, r => r.openingBalance), inflow: sum(register, r => r.inflow), outflow: sum(register, r => r.outflow),
      closing: sum(register, r => r.closingBalance), cash: sum(cash, r => r.closingBalance), bank: sum(bank, r => r.closingBalance),
      encashment: sum(register, r => r.encashment), cashSales: sum(register, r => r.cashSales), cashCount: cash.length, bankCount: bank.length,
    };
  }, [register]);

  const byType = useMemo(() => {
    const map = new Map<string, { in: number; out: number; count: number }>();
    for (const t of txs) {
      const row = map.get(t.type) ?? { in: 0, out: 0, count: 0 };
      if (t.direction === 'in') row.in += num(t.amount); else if (t.direction === 'out') row.out += num(t.amount);
      row.count += 1;
      map.set(t.type, row);
    }
    return [...map.entries()].sort((a, b) => (b[1].in + b[1].out) - (a[1].in + a[1].out));
  }, [txs]);

  const expenseByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expensesQ.data || []) map.set(e.category, (map.get(e.category) || 0) + num(e.amount));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [expensesQ.data]);
  const expenseTotal = round2(expenseByCategory.reduce((s, [, v]) => s + v, 0));

  const owners = (ownersQ.data || []).filter(t => t.type === 'owner_in' || t.type === 'owner_out');
  const ownerIn = round2(owners.filter(t => t.type === 'owner_in').reduce((s, t) => s + num(t.amount), 0));
  const ownerOut = round2(owners.filter(t => t.type === 'owner_out').reduce((s, t) => s + num(t.amount), 0));

  return <>
    <PageHeading eyebrow="PUL OPERATSIYALARI · ДЕНЕЖНЫЕ ОПЕРАЦИИ" title="Pul operatsiyalari" subtitle="Kassalar va bank hisoblari: boshlangʻich va yakuniy qoldiq, kirim-chiqim, inkassatsiya, toʻlovlar, xarajatlar va egalar mablagʻi"
      actions={<div className="heading-button-group">
        <button className="button primary" onClick={() => setOperation({ type: 'cash_in' })} data-testid="button-money-in"><ArrowDownLeft size={15} /> Kirim</button>
        <button className="button primary danger-soft" onClick={() => setOperation({ type: 'expense' })} data-testid="button-money-out"><ArrowUpRight size={15} /> Chiqim / xarajat</button>
        <button className="button secondary" onClick={() => setTransfer({ kind: 'encashment' })} data-testid="button-encashment"><Vault size={15} /> Inkassatsiya</button>
        <button className="button secondary" onClick={() => setTransfer({ kind: 'transfer' })} data-testid="button-transfer"><ArrowLeftRight size={15} /> Oʻtkazma</button>
        <button className="button ghost" onClick={() => setNewAccount(true)} data-testid="button-new-account"><Plus size={15} /> Hisob ochish</button>
      </div>} />
    <KpiStrip items={[
      { label: 'Davr boshidagi qoldiq', value: totals.opening, icon: Wallet },
      { label: 'Kirim', value: totals.inflow, icon: ArrowDownLeft, tone: 'good' },
      { label: 'Chiqim', value: totals.outflow, icon: ArrowUpRight, tone: totals.outflow ? 'bad' : undefined },
      { label: 'Davr oxiridagi qoldiq', value: totals.closing, icon: Banknote },
      { label: 'Naqd kassalarda', value: totals.cash, icon: Wallet, hint: `${totals.cashCount} ta kassa` },
      { label: 'Bank hisoblarida', value: totals.bank, icon: Landmark, hint: `${totals.bankCount} ta hisob` },
      { label: 'Inkassatsiya qilingan', value: totals.encashment, icon: Vault },
    ]} />
    <div className="tabs">
      <button className={tab === 'register' ? 'selected' : ''} onClick={() => setTab('register')} data-testid="tab-finance-register"><Wallet size={15} /> Kassalar va hisoblar</button>
      <button className={tab === 'operations' ? 'selected' : ''} onClick={() => setTab('operations')} data-testid="tab-finance-operations"><ArrowLeftRight size={15} /> Pul harakati</button>
      <button className={tab === 'expenses' ? 'selected' : ''} onClick={() => setTab('expenses')} data-testid="tab-finance-expenses"><ClipboardList size={15} /> Xarajatlar</button>
      <button className={tab === 'owners' ? 'selected' : ''} onClick={() => setTab('owners')} data-testid="tab-finance-owners"><UserRound size={15} /> Egalar mablagʻi</button>
    </div>

    {tab === 'register' && <Panel title="Kassa hisoboti" subtitle="Har bir kassa va bank hisobi boʻyicha davr boshi, harakat va davr oxiri qoldigʻi">
      <DataState loading={registerQ.isLoading} error={registerQ.isError} empty={!registerQ.isLoading && !registerQ.isError && !register.length} retry={() => registerQ.refetch()} emptyText="Hali kassa yoki bank hisobi yoʻq. “Hisob ochish” tugmasi orqali filial kassasini yarating." />
      {!!register.length && <TableWrap><thead><tr><th>HISOB</th><th>FILIAL</th><th className="num">BOSHLANGʻICH</th><th className="num">KIRIM</th><th className="num">CHIQIM</th><th className="num">YAKUNIY</th><th className="num">SAVDO TUSHUMI</th><th className="num">INKASSATSIYA</th><th className="num">OP.</th><th /></tr></thead>
        <tbody>{register.map(r => <tr key={r.accountId} data-testid={`row-register-${r.accountId}`}>
          <td className="cell-strong"><span className={`account-kind ${r.kind}`}>{r.kind === 'cash' ? <Wallet size={13} /> : <Landmark size={13} />}</span> {r.accountName}<small>{r.kind === 'cash' ? 'Naqd kassa' : 'Bank hisobi'}</small></td>
          <td>{r.branchName}</td>
          <td className="num">{money(r.openingBalance)}</td>
          <td className="num positive">{num(r.inflow) ? `+${money(r.inflow)}` : '—'}</td>
          <td className="num negative">{num(r.outflow) ? `−${money(r.outflow)}` : '—'}</td>
          <td className={`num cell-strong ${num(r.closingBalance) < 0 ? 'negative' : ''}`}>{money(r.closingBalance)}</td>
          <td className="num">{num(r.cashSales) ? money(r.cashSales) : '—'}</td>
          <td className="num">{num(r.encashment) ? money(r.encashment) : '—'}</td>
          <td className="num"><button className="link-button" onClick={() => { setAccountId(String(r.accountId)); setTab('operations'); }}>{r.operations}</button></td>
          <td><div className="row-actions">
            <button className="button ghost small" onClick={() => setOperation({ type: 'cash_in', accountId: r.accountId })} title="Kirim"><ArrowDownLeft size={13} /></button>
            <button className="button ghost small" onClick={() => setOperation({ type: 'expense', accountId: r.accountId })} title="Chiqim"><ArrowUpRight size={13} /></button>
            {r.kind === 'cash' && <button className="button ghost small" onClick={() => setTransfer({ kind: 'encashment', from: r.accountId })} title="Inkassatsiya"><Vault size={13} /></button>}
          </div></td>
        </tr>)}</tbody>
        <tfoot><tr><td colSpan={2}>Jami</td><td className="num">{money(totals.opening)}</td><td className="num positive">+{money(totals.inflow)}</td><td className="num negative">−{money(totals.outflow)}</td><td className="num cell-strong">{money(totals.closing)}</td><td className="num">{money(totals.cashSales)}</td><td className="num">{money(totals.encashment)}</td><td colSpan={2} /></tr></tfoot></TableWrap>}
    </Panel>}

    {tab === 'operations' && <>
      <Panel title="Pul harakati" subtitle="Barcha kassa va bank operatsiyalari; filtrlab koʻring" action={<div className="toolbar">
        <Chips value={direction} onChange={setDirection} options={[{ id: 'all', label: 'Barchasi' }, { id: 'in', label: 'Kirim' }, { id: 'out', label: 'Chiqim' }]} />
        <SelectMenu ariaLabel="Operatsiya turi" value={type} onChange={setType} options={moneyTypeMenu} align="right" />
        <AccountFilter value={accountId} onChange={setAccountId} />
        <SearchBox value={search} onChange={setSearch} placeholder="Hamkor, hujjat, izoh" />
      </div>}>
        {!!byType.length && <div className="type-summary">{byType.map(([t, v]) => <button key={t} className={type === t ? 'selected' : ''} onClick={() => setType(type === t ? '' : t)}><span>{moneyTypeLabels[t] ?? t}</span><b className={v.in >= v.out ? 'positive' : 'negative'}>{v.in ? `+${money(round2(v.in))}` : ''}{v.in && v.out ? ' / ' : ''}{v.out ? `−${money(round2(v.out))}` : ''}</b><small>{v.count} ta</small></button>)}</div>}
        <DataState loading={txQ.isLoading} error={txQ.isError} empty={!txQ.isLoading && !txQ.isError && !txs.length} retry={() => txQ.refetch()} />
        {!!txs.length && <TransactionsTable rows={txs} />}
      </Panel>
    </>}

    {tab === 'expenses' && <div className="split-grid wide-left">
      <Panel title="Xarajatlar" subtitle="Ish haqi, ijara, kommunal va boshqa xarajatlar" action={<button className="button primary small" onClick={() => setOperation({ type: 'expense' })}><Plus size={14} /> Xarajat</button>}>
        <DataState loading={expensesQ.isLoading} error={expensesQ.isError} empty={!expensesQ.isLoading && !expensesQ.isError && !(expensesQ.data || []).length} retry={() => expensesQ.refetch()} />
        {!!expensesQ.data?.length && <TableWrap><thead><tr><th>SANA</th><th>KATEGORIYA</th><th>FILIAL</th><th>IZOH</th><th className="num">SUMMA</th></tr></thead><tbody>{expensesQ.data.map(x => <tr key={x.id}><td>{date(x.date)}<small>{sourceText(x.source)}</small></td><td className="cell-strong">{x.category}</td><td>{x.branchName}</td><td>{x.description || '—'}</td><td className="num negative">{money(x.amount)}</td></tr>)}</tbody></TableWrap>}
      </Panel>
      <Panel title="Turlar boʻyicha" subtitle={`Jami ${money(expenseTotal)} soʻm`}>
        {expenseByCategory.length ? <div className="breakdown-list">{expenseByCategory.map(([c, v]) => <div className="breakdown-row" key={c}><div><span>{c}</span><b>{money(round2(v))} soʻm</b></div><div className="bar-track"><i style={{ width: `${Math.max(3, v / (expenseByCategory[0][1] || 1) * 100)}%` }} /></div></div>)}</div> : <div className="inline-empty">Xarajat yoʻq</div>}
      </Panel>
    </div>}

    {tab === 'owners' && <Panel title="Egalar kiritgan va olgan mablagʻ" subtitle="Taʼsischilar hisobidan kiritilgan kapital va olingan dividend / shaxsiy ehtiyoj" action={<div className="toolbar"><button className="button secondary small" onClick={() => setOperation({ type: 'owner_in' })}><ArrowDownLeft size={13} /> Kiritildi</button><button className="button secondary small" onClick={() => setOperation({ type: 'owner_out' })}><ArrowUpRight size={13} /> Olindi</button></div>}>
      <div className="mini-metrics"><div><span>Kiritilgan</span><b className="positive">{money(ownerIn)} soʻm</b></div><div><span>Olingan</span><b className="negative">{money(ownerOut)} soʻm</b></div><div><span>Sof</span><b>{money(round2(ownerIn - ownerOut))} soʻm</b></div></div>
      <DataState loading={ownersQ.isLoading} error={ownersQ.isError} empty={!ownersQ.isLoading && !ownersQ.isError && !owners.length} retry={() => ownersQ.refetch()} emptyText="Bu davrda egalar mablagʻi harakati yoʻq." />
      {!!owners.length && <TransactionsTable rows={owners} />}
    </Panel>}

    {operation && <MoneyOperationModal initialType={operation.type} initialAccount={operation.accountId} defaultBranch={filters.branchId} onClose={() => setOperation(null)} />}
    {transfer && <TransferModal initialKind={transfer.kind} from={transfer.from} onClose={() => setTransfer(null)} />}
    {newAccount && <CashAccountModal defaultBranch={filters.branchId} onClose={() => setNewAccount(false)} />}
  </>;
}

function AccountFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const accounts = useListCashAccounts().data || [];
  const options: MenuOption[] = [
    { value: '', label: 'Barcha hisoblar', icon: Wallet, color: '#0fb3c7' },
    ...accounts.map(a => ({ value: String(a.id), label: a.name, hint: a.kind === 'cash' ? 'Kassa' : 'Bank hisobi', icon: a.kind === 'cash' ? Banknote : Landmark, color: a.kind === 'cash' ? '#1fb84f' : '#1f5fd0' })),
  ];
  return <SelectMenu ariaLabel="Hisob" value={value} onChange={onChange} options={options} align="right" />;
}

function TransactionsTable({ rows }: { rows: MoneyTransaction[] }) {
  return <TableWrap><thead><tr><th>SANA-VAQT</th><th>OPERATSIYA</th><th>HISOB</th><th>FILIAL</th><th>HAMKOR</th><th>HUJJAT / IZOH</th><th className="num">KIRIM</th><th className="num">CHIQIM</th></tr></thead>
    <tbody>{rows.map(t => <tr key={t.id} data-testid={`row-transaction-${t.id}`}>
      <td>{dateTime(t.date)}<small>{t.createdBy || sourceText(t.source)}</small></td>
      <td><span className={`money-type ${t.direction}`}>{moneyTypeLabels[t.type] ?? t.type}</span>{t.category && <small>{t.category}</small>}</td>
      <td>{t.accountName}<small>{t.accountKind === 'cash' ? 'Kassa' : 'Bank'}</small></td>
      <td>{t.branchName}</td>
      <td>{t.counterpartyName || '—'}</td>
      <td>{t.documentNo || '—'}{t.note && <small>{t.note}</small>}</td>
      <td className="num positive cell-strong">{t.direction === 'in' ? money(t.amount) : ''}</td>
      <td className="num negative cell-strong">{t.direction === 'out' ? money(t.amount) : ''}</td>
    </tr>)}</tbody></TableWrap>;
}

function MoneyOperationModal({ initialType, initialAccount, defaultBranch, onClose }: { initialType: MoneyOperationType; initialAccount?: number; defaultBranch: string; onClose: () => void }) {
  const refresh = useRefreshAll();
  const create = useCreateMoneyOperation();
  const accounts = useListCashAccounts().data || [];
  const [type, setType] = useState<MoneyOperationType>(initialType);
  const [accountId, setAccountId] = useState(initialAccount ? String(initialAccount) : '');
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState(nowLocal());
  const [category, setCategory] = useState(initialType === 'expense' ? expenseCategories[0] : '');
  const [cp, setCp] = useState({ name: '', id: null as number | null });
  const [debtId, setDebtId] = useState('');
  const [branchId, setBranchId] = useState(defaultBranch);
  const [documentNo, setDocumentNo] = useState('');
  const [note, setNote] = useState('');
  const account = accounts.find(a => String(a.id) === accountId);
  const isDebtPayment = type === 'supplier_payment' || type === 'customer_payment';
  const debtKind = type === 'supplier_payment' ? 'payable' : 'receivable';
  const debts = useListDebts({ kind: debtKind, status: 'open', counterpartyId: cp.id ?? undefined }, { query: { enabled: isDebtPayment, queryKey: ['debts-for-payment', debtKind, cp.id] } }).data || [];
  const debt = debts.find(d => String(d.id) === debtId);
  const incoming = incomeTypes.includes(type);
  const after = account ? round2(num(account.balance) + (incoming ? 1 : -1) * num(amount)) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ data: {
      type, accountId: Number(accountId), amount: toMoney(num(amount)), date: localToIso(when), category: category.trim() || undefined,
      counterpartyName: (debt?.counterparty ?? cp.name).trim() || undefined, debtId: isDebtPayment && debtId ? Number(debtId) : null,
      branchId: !account?.branchId && branchId ? Number(branchId) : null, documentNo, note,
    } }, { onSuccess: () => { refresh(); onClose(); } });
  };

  return <Modal eyebrow={incoming ? 'PUL KIRIMI' : 'PUL CHIQIMI'} title={moneyTypeLabels[type]} onClose={onClose} busy={create.isPending} size="lg">
    <form className="form-stack" onSubmit={submit}>
      <div className="type-picker">
        <div><span className="eyebrow">KIRIM</span><Chips value={incoming ? type : ('' as MoneyOperationType)} onChange={v => { setType(v); setDebtId(''); setCategory(''); }} options={incomeTypes.map(t => ({ id: t, label: moneyTypeLabels[t] }))} /></div>
        <div><span className="eyebrow">CHIQIM</span><Chips value={!incoming ? type : ('' as MoneyOperationType)} onChange={v => { setType(v); setDebtId(''); setCategory(v === 'expense' ? expenseCategories[0] : ''); }} options={outgoTypes.map(t => ({ id: t, label: moneyTypeLabels[t] }))} /></div>
      </div>
      <div className="form-grid">
        <AccountSelect value={accountId} onChange={setAccountId} required kind={type === 'bank_receipt' ? 'bank' : undefined} label={incoming ? 'Qaysi hisobga' : 'Qaysi hisobdan'} />
        <label>Summa (soʻm)<input type="number" required min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />{debt && <button type="button" className="link-button" onClick={() => setAmount(debt.balance)}>Qarz qoldigʻi: {money(debt.balance)}</button>}</label>
        <label>Sana va vaqt<input type="datetime-local" required value={when} onChange={e => setWhen(e.target.value)} /></label>
        {type === 'expense' && <label>Xarajat turi<select required value={category} onChange={e => setCategory(e.target.value)}>{expenseCategories.map(c => <option key={c}>{c}</option>)}</select></label>}
        {(type === 'cash_in' || type === 'cash_out' || type === 'bank_receipt') && <label>Turi / maqsad <span className="optional">ixtiyoriy</span><input value={category} onChange={e => setCategory(e.target.value)} placeholder={type === 'bank_receipt' ? 'Terminal tushumi, oʻtkazma…' : 'Masalan: qaytim fondi'} /></label>}
        {isDebtPayment && <CounterpartyField kind={type === 'supplier_payment' ? 'supplier' : 'customer'} label={type === 'supplier_payment' ? 'Yetkazib beruvchi' : 'Mijoz'} value={cp.name} onChange={(name, id) => { setCp({ name, id }); setDebtId(''); }} required={false} />}
        {isDebtPayment && <label>Qarz hujjati<select value={debtId} onChange={e => setDebtId(e.target.value)}><option value="">Qarzga bogʻlanmagan (avans)</option>{debts.map(d => <option key={d.id} value={d.id}>{d.documentNo} · {d.counterparty} · qoldiq {money(d.balance)} · muddat {date(d.dueDate)}</option>)}</select></label>}
        {!isDebtPayment && type !== 'expense' && <label>{type.startsWith('owner') ? 'Ega / taʼsischi' : 'Kimdan / kimga'} <span className="optional">ixtiyoriy</span><input value={cp.name} onChange={e => setCp({ name: e.target.value, id: null })} /></label>}
        {type === 'expense' && <label>Kimga toʻlandi <span className="optional">ixtiyoriy</span><input value={cp.name} onChange={e => setCp({ name: e.target.value, id: null })} placeholder="Xodim, ijara beruvchi…" /></label>}
        {account && !account.branchId && <BranchSelect value={branchId} onChange={setBranchId} label="Filial" required={type === 'expense'} allowEmpty={type !== 'expense'} emptyLabel="Kompaniya darajasida" />}
        <label>Hujjat raqami <span className="optional">ixtiyoriy</span><input value={documentNo} onChange={e => setDocumentNo(e.target.value)} /></label>
        <label className="span-2">Izoh <span className="optional">ixtiyoriy</span><input value={note} onChange={e => setNote(e.target.value)} /></label>
      </div>
      {account && <Totals rows={[
        { label: `${account.name} — hozirgi qoldiq`, value: account.balance },
        { label: incoming ? 'Kirim' : 'Chiqim', value: num(amount), tone: incoming ? 'good' : 'bad' },
        { label: 'Operatsiyadan keyin', value: after, strong: true, tone: after != null && after < 0 ? 'bad' : undefined },
      ]} />}
      {account?.kind === 'cash' && after != null && after < 0 && <div className="notice warn">Kassada yetarli naqd pul yoʻq — operatsiya rad etiladi.</div>}
      <FormError error={create.error} />
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Bekor qilish</button><button className={`button ${incoming ? 'primary' : 'danger'}`} disabled={create.isPending} data-testid="button-save-money-op">{create.isPending ? 'Saqlanmoqda…' : 'Saqlash'}</button></div>
    </form>
  </Modal>;
}

function TransferModal({ initialKind, from, onClose }: { initialKind: 'transfer' | 'encashment'; from?: number; onClose: () => void }) {
  const refresh = useRefreshAll();
  const create = useCreateMoneyTransfer();
  const accounts = useListCashAccounts().data || [];
  const [kind, setKind] = useState(initialKind);
  const [fromId, setFromId] = useState(from ? String(from) : '');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState(nowLocal());
  const [note, setNote] = useState('');
  const source = accounts.find(a => String(a.id) === fromId);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ data: { kind, fromAccountId: Number(fromId), toAccountId: Number(toId), amount: toMoney(num(amount)), date: localToIso(when), note } }, { onSuccess: () => { refresh(); onClose(); } });
  };
  return <Modal eyebrow={kind === 'encashment' ? 'INKASSATSIYA · ИНКАССАЦИЯ' : 'HISOBLARARO OʻTKAZMA'} title={kind === 'encashment' ? 'Kassadan bankka topshirish' : 'Hisoblar oʻrtasida oʻtkazma'} onClose={onClose} busy={create.isPending}>
    <form className="form-stack" onSubmit={submit}>
      <Chips value={kind} onChange={v => { setKind(v); setToId(''); }} options={[{ id: 'encashment', label: 'Inkassatsiya (kassa → bank)' }, { id: 'transfer', label: 'Oʻtkazma (istalgan hisob)' }]} />
      <div className="form-grid">
        <AccountSelect value={fromId} onChange={setFromId} required kind={kind === 'encashment' ? 'cash' : undefined} label="Qaysi hisobdan" />
        <AccountSelect value={toId} onChange={setToId} required kind={kind === 'encashment' ? 'bank' : undefined} label="Qaysi hisobga" />
        <label>Summa (soʻm)<input type="number" required min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />{source && <button type="button" className="link-button" onClick={() => setAmount(source.balance)}>Butun qoldiq: {money(source.balance)}</button>}</label>
        <label>Sana va vaqt<input type="datetime-local" required value={when} onChange={e => setWhen(e.target.value)} /></label>
        <label className="span-2">Izoh<input value={note} onChange={e => setNote(e.target.value)} placeholder={kind === 'encashment' ? 'Inkassator, sumka raqami…' : ''} /></label>
      </div>
      {fromId && fromId === toId && <div className="form-error">Bir hisobdan oʻziga oʻtkazib boʻlmaydi.</div>}
      <FormError error={create.error} />
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Bekor qilish</button><button className="button primary" disabled={create.isPending || (!!fromId && fromId === toId)} data-testid="button-save-transfer">{create.isPending ? 'Saqlanmoqda…' : 'Oʻtkazish'}</button></div>
    </form>
  </Modal>;
}

function CashAccountModal({ defaultBranch, onClose }: { defaultBranch: string; onClose: () => void }) {
  const refresh = useRefreshAll();
  const create = useCreateCashAccount();
  const [form, setForm] = useState({ name: '', kind: 'cash' as 'cash' | 'bank', branchId: defaultBranch, openingBalance: '' });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ data: { name: form.name.trim(), kind: form.kind, branchId: form.branchId ? Number(form.branchId) : null, openingBalance: toMoney(num(form.openingBalance)) } }, { onSuccess: () => { refresh(); onClose(); } });
  };
  return <Modal eyebrow="KASSA VA BANK" title="Yangi hisob ochish" onClose={onClose} busy={create.isPending}>
    <form className="form-stack" onSubmit={submit}>
      <Chips value={form.kind} onChange={kind => setForm({ ...form, kind })} options={[{ id: 'cash', label: 'Naqd kassa' }, { id: 'bank', label: 'Bank hisobi' }]} />
      <label>Nomi<input required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={form.kind === 'cash' ? 'Asosiy kassa' : 'Hisob raqami / bank nomi'} /></label>
      <BranchSelect value={form.branchId} onChange={branchId => setForm({ ...form, branchId })} required={form.kind === 'cash'} allowEmpty={form.kind === 'bank'} emptyLabel={form.kind === 'bank' ? 'Kompaniya hisobi (filialsiz)' : 'Tanlang'} />
      <label>Boshlangʻich qoldiq (soʻm)<input type="number" min="0" step="0.01" value={form.openingBalance} onChange={e => setForm({ ...form, openingBalance: e.target.value })} placeholder="0" /><span className="field-hint">Dastur ishga tushgan kundagi haqiqiy qoldiq</span></label>
      <div className="notice info"><Building size={14} /> Karta va oʻtkazma tushumlari filialga biriktirilgan bank hisobiga, u boʻlmasa kompaniya bank hisobiga yoziladi.</div>
      <FormError error={create.error} />
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Bekor qilish</button><button className="button primary" disabled={create.isPending} data-testid="button-save-account"><Receipt size={14} /> {create.isPending ? 'Saqlanmoqda…' : 'Hisobni ochish'}</button></div>
    </form>
  </Modal>;
}
