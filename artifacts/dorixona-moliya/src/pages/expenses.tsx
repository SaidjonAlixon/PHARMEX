import { useMemo, useState, type FormEvent } from 'react';
import {
  Activity, Building2, ClipboardList, Plus, TrendingDown, Wallet,
} from 'lucide-react';
import {
  useCreateExpense, useGetDashboard, useListCashAccounts, useListExpenses,
} from '@workspace/api-client-react';
import {
  AccountSelect, BranchSelect, DataState, FormError, KpiStrip, Modal, PageHeading, Panel, SearchBox,
  TableWrap, Totals, date, filterParams, money, nowLocal, num, round2, sourceText, toMoney,
  useRefreshAll, type Filters,
} from '@/components/kit';
import { expenseCategories } from '@/lib/labels';
import { SelectMenu, type MenuOption } from '@/components/select-menu';
import { useAccess } from '@/lib/access';

export function ExpensesPage({ filters }: { filters: Filters }) {
  const { canEdit } = useAccess();
  const refresh = useRefreshAll();
  const base = filterParams(filters);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const expensesQ = useListExpenses({
    ...base,
    category: category || undefined,
  });
  const dashQ = useGetDashboard(base);

  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    const list = expensesQ.data || [];
    if (!q) return list;
    return list.filter(e =>
      `${e.category} ${e.description} ${e.branchName}`.toLocaleLowerCase().includes(q),
    );
  }, [expensesQ.data, search]);

  const expenseTotal = round2(rows.reduce((s, e) => s + num(e.amount), 0));
  const grossProfit = dashQ.data?.totals.grossProfit;
  const dashExpenses = dashQ.data?.totals.expenses;
  const netProfit = dashQ.data?.totals.netProfit
    ?? (grossProfit != null ? round2(num(grossProfit) - num(dashExpenses ?? expenseTotal)) : null);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of rows) map.set(e.category, (map.get(e.category) || 0) + num(e.amount));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const byBranch = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of rows) map.set(e.branchName || '—', (map.get(e.branchName || '—') || 0) + num(e.amount));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const categoryOptions: MenuOption[] = useMemo(() => [
    { value: '', label: 'Barcha turlar', hint: `${(expensesQ.data || []).length} ta`, icon: ClipboardList, color: '#0fb3c7' },
    ...expenseCategories.map(c => ({
      value: c,
      label: c,
      hint: `${(expensesQ.data || []).filter(e => e.category === c).length} ta`,
      icon: ClipboardList,
      color: '#e48a0c',
    })),
  ], [expensesQ.data]);

  return (
    <div className="page-expenses">
      <PageHeading
        eyebrow="XARAJATLAR · РАСХОДЫ"
        title="Xarajatlar"
        subtitle="Apteka xarajatlari: oylik, arenda, kommunal va boshqa rasxodlar · filiallar kesimida · sof foyda = yalpi foyda − xarajatlar"
        actions={canEdit && (
          <button type="button" className="button primary" onClick={() => setOpen(true)} data-testid="button-new-expense">
            <Plus size={16} /> Xarajat kiritish
          </button>
        )}
      />

      <KpiStrip items={[
        { label: 'Yalpi foyda', value: grossProfit, icon: Activity, tone: 'good', hint: 'Savdo − tannarx' },
        { label: 'Xarajatlar jami', value: expenseTotal, icon: TrendingDown, tone: expenseTotal ? 'bad' : undefined, hint: `${rows.length} ta yozuv` },
        { label: 'Sof foyda', value: netProfit, icon: Wallet, tone: netProfit != null && num(netProfit) < 0 ? 'bad' : 'good', hint: 'Yalpi foyda − xarajatlar' },
        { label: 'Filiallar', value: byBranch.length, count: true, icon: Building2, hint: 'Xarajat boʻlgan' },
      ]} />

      <div className="split-grid wide-left">
        <Panel
          title="Xarajatlar roʻyxati"
          subtitle={filters.branchId ? 'Tanlangan filial boʻyicha' : 'Barcha filiallar'}
          action={(
            <div className="toolbar">
              <SelectMenu
                ariaLabel="Xarajat turi"
                value={category}
                onChange={setCategory}
                options={categoryOptions}
                align="right"
                testId="select-expense-category"
              />
              <SearchBox value={search} onChange={setSearch} placeholder="Kategoriya, izoh, filial" />
            </div>
          )}
        >
          <DataState
            loading={expensesQ.isLoading}
            error={expensesQ.isError}
            empty={!expensesQ.isLoading && !expensesQ.isError && !rows.length}
            retry={() => expensesQ.refetch()}
            emptyText="Bu davrda xarajat yoʻq. “Xarajat kiritish” orqali oylik, arenda, kommunal va boshqa rasxodlarni qoʻshing."
          />
          {!!rows.length && (
            <TableWrap>
              <thead>
                <tr>
                  <th>SANA</th>
                  <th>KATEGORIYA</th>
                  <th>FILIAL</th>
                  <th>IZOH</th>
                  <th className="num">SUMMA</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(e => (
                  <tr key={e.id} data-testid={`row-expense-${e.id}`}>
                    <td>{date(e.date)}<small>{sourceText(e.source)}</small></td>
                    <td className="cell-strong">{e.category}</td>
                    <td>{e.branchName}</td>
                    <td>{e.description || '—'}</td>
                    <td className="num negative cell-strong">{money(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Jami</td>
                  <td className="num negative cell-strong">{money(expenseTotal)}</td>
                </tr>
              </tfoot>
            </TableWrap>
          )}
        </Panel>

        <div className="stack-panels">
          <Panel title="Sof foyda hisobi" subtitle="Davr filtriga mos">
            <Totals rows={[
              { label: 'Yalpi foyda', value: grossProfit, tone: 'good' },
              { label: 'Xarajatlar (−)', value: dashExpenses ?? expenseTotal, tone: 'bad' },
              { label: 'Sof foyda', value: netProfit, strong: true, tone: netProfit != null && num(netProfit) < 0 ? 'bad' : 'good' },
            ]} />
            <p className="muted-line" style={{ marginTop: 12 }}>
              Sof foyda = yalpi foyda − barcha apteka xarajatlari (oylik, arenda, kommunal va boshqalar).
            </p>
          </Panel>

          <Panel title="Turlar boʻyicha" subtitle={`Jami ${money(expenseTotal)}`}>
            {byCategory.length ? (
              <div className="breakdown-list">
                {byCategory.map(([c, v]) => (
                  <div className="breakdown-row" key={c}>
                    <div><span>{c}</span><b>{money(round2(v))}</b></div>
                    <div className="bar-track">
                      <i style={{ width: `${Math.max(3, v / (byCategory[0][1] || 1) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="inline-empty">Xarajat yoʻq</div>}
          </Panel>

          <Panel title="Filiallar boʻyicha" subtitle="Xarajatlar taqsimoti">
            {byBranch.length ? (
              <div className="breakdown-list">
                {byBranch.map(([b, v]) => (
                  <div className="breakdown-row" key={b}>
                    <div><span>{b}</span><b>{money(round2(v))}</b></div>
                    <div className="bar-track">
                      <i style={{ width: `${Math.max(3, v / (byBranch[0][1] || 1) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="inline-empty">Filial kesimi yoʻq</div>}
          </Panel>
        </div>
      </div>

      {open && (
        <ExpenseCreateModal
          defaultBranch={filters.branchId}
          onClose={() => setOpen(false)}
          onSaved={() => { refresh(); setOpen(false); }}
        />
      )}
    </div>
  );
}

function ExpenseCreateModal({
  defaultBranch, onClose, onSaved,
}: {
  defaultBranch: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const create = useCreateExpense();
  const accounts = useListCashAccounts({
    branchId: defaultBranch ? Number(defaultBranch) : undefined,
  }).data || [];
  const [branchId, setBranchId] = useState(defaultBranch);
  const [category, setCategory] = useState(expenseCategories[0]);
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState(nowLocal());
  const [description, setDescription] = useState('');
  const [payee, setPayee] = useState('');
  const [accountId, setAccountId] = useState('');
  const [customCategory, setCustomCategory] = useState(false);

  const branchAccounts = useMemo(
    () => accounts.filter(a => !branchId || a.branchId == null || String(a.branchId) === branchId),
    [accounts, branchId],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!branchId) return;
    const note = [payee.trim() && `Kimga: ${payee.trim()}`, description.trim()].filter(Boolean).join(' · ');
    create.mutate({
      data: {
        date: when.slice(0, 10),
        branchId: Number(branchId),
        category: category.trim() || 'Boshqa xarajat',
        description: note || category,
        amount: toMoney(num(amount)),
        accountId: accountId ? Number(accountId) : undefined,
      },
    }, { onSuccess: () => onSaved() });
  };

  return (
    <Modal eyebrow="XARAJAT KIRITISH" title="Yangi xarajat" onClose={onClose} busy={create.isPending} size="lg">
      <form className="form-stack" onSubmit={submit}>
        <div className="form-grid">
          <BranchSelect value={branchId} onChange={setBranchId} label="Filial" required allowEmpty={!defaultBranch} emptyLabel="Filialni tanlang" />
          <label>
            Xarajat turi
            {!customCategory ? (
              <select required value={category} onChange={e => {
                if (e.target.value === '__custom__') { setCustomCategory(true); setCategory(''); return; }
                setCategory(e.target.value);
              }}>
                {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__custom__">Boshqa (qoʻlda yozish)…</option>
              </select>
            ) : (
              <input required value={category} onChange={e => setCategory(e.target.value)} placeholder="Xarajat nomi" autoFocus />
            )}
          </label>
          <label>Summa (soʻm)<input type="number" required min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <label>Sana<input type="datetime-local" required value={when} onChange={e => setWhen(e.target.value)} /></label>
          <AccountSelect
            value={accountId}
            onChange={setAccountId}
            label="Qaysi hisobdan (ixtiyoriy)"
            branchId={branchId || undefined}
            emptyLabel={branchAccounts.length ? 'Filial kassasi (avto)' : 'Avtomatik'}
          />
          <label>Kimga toʻlandi <span className="optional">ixtiyoriy</span><input value={payee} onChange={e => setPayee(e.target.value)} placeholder="Xodim, ijara beruvchi, kommunal…" /></label>
          <label className="span-2">Izoh / asos <span className="optional">ixtiyoriy</span><input value={description} onChange={e => setDescription(e.target.value)} placeholder="Masalan: noyabr oyligi, elektr, arenda…" /></label>
        </div>
        <Totals rows={[
          { label: 'Xarajat summasi', value: num(amount) || null, tone: 'bad', strong: true },
        ]} />
        <FormError error={create.error} />
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>Bekor qilish</button>
          <button type="submit" className="button danger" disabled={create.isPending || !branchId} data-testid="button-save-expense">
            {create.isPending ? 'Saqlanmoqda…' : 'Xarajatni saqlash'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
