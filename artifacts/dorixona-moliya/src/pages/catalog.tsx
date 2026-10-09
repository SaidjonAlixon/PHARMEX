import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { Package, Plus, Truck, Users } from 'lucide-react';
import { useCreateCounterparty, useCreateProduct, useListCounterparties, useListProducts } from '@workspace/api-client-react';
import {
  DataState, FormError, KpiStrip, Modal, PageHeading, Panel, SearchBox, StatusBadge, TableWrap, date, money, num, qty, round2,
  sourceText, toMoney, useRefreshAll,
} from '@/components/kit';
import { units } from '@/lib/labels';

type Tab = 'products' | 'supplier' | 'customer';

export function CatalogPage() {
  const [tab, setTab] = useState<Tab>('products');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState<Tab | null>(null);
  const productsQ = useListProducts({ search: search || undefined });
  const suppliersQ = useListCounterparties({ kind: 'supplier', search: search || undefined });
  const customersQ = useListCounterparties({ kind: 'customer', search: search || undefined });
  const products = productsQ.data || [];
  const cpQ = tab === 'supplier' ? suppliersQ : customersQ;
  const cps = cpQ.data || [];
  const payable = round2((suppliersQ.data || []).reduce((s, c) => s + num(c.payable), 0));
  const receivable = round2((customersQ.data || []).reduce((s, c) => s + num(c.receivable), 0));

  return <>
    <PageHeading eyebrow="MAʼLUMOTNOMALAR" title="Mahsulotlar va hamkorlar" subtitle="Mahsulot kodi, oʻlchov birligi, QQS stavkasi; yetkazib beruvchilar va mijozlar roʻyxati"
      actions={<button className="button primary" onClick={() => setCreating(tab)} data-testid="button-catalog-new"><Plus size={16} /> {tab === 'products' ? 'Mahsulot qoʻshish' : tab === 'supplier' ? 'Yetkazib beruvchi qoʻshish' : 'Mijoz qoʻshish'}</button>} />
    <KpiStrip items={[
      { label: 'Mahsulotlar', value: products.length >= 1000 ? '1000+' : products.length, count: true, icon: Package, hint: `${products.filter(p => p.stock > 0).length} tasida qoldiq bor${products.length >= 1000 ? ' (koʻrsatilganlar)' : ''}` },
      { label: 'Yetkazib beruvchilar', value: suppliersQ.data?.length ?? null, count: true, icon: Truck },
      { label: 'Ularga qarzimiz', value: payable, icon: Truck, tone: payable ? 'warn' : undefined },
      { label: 'Mijozlar', value: customersQ.data?.length ?? null, count: true, icon: Users },
      { label: 'Mijozlar qarzi', value: receivable, icon: Users, tone: receivable ? 'good' : undefined },
    ]} />
    <div className="tabs">
      <button className={tab === 'products' ? 'selected' : ''} onClick={() => setTab('products')} data-testid="tab-catalog-products"><Package size={15} /> Mahsulotlar</button>
      <button className={tab === 'supplier' ? 'selected' : ''} onClick={() => setTab('supplier')} data-testid="tab-catalog-suppliers"><Truck size={15} /> Yetkazib beruvchilar</button>
      <button className={tab === 'customer' ? 'selected' : ''} onClick={() => setTab('customer')} data-testid="tab-catalog-customers"><Users size={15} /> Mijozlar</button>
    </div>
    {tab === 'products' ? <Panel title="Mahsulotlar maʼlumotnomasi" subtitle="Nomni bosib filiallar kesimidagi qoldiqni koʻring" action={<SearchBox value={search} onChange={setSearch} placeholder="Nomi, kodi, ishlab chiqaruvchi, IKPU" />}>
      <DataState loading={productsQ.isLoading} error={productsQ.isError} empty={!productsQ.isLoading && !productsQ.isError && !products.length} retry={() => productsQ.refetch()} emptyText="Mahsulot yoʻq. “Mahsulot qoʻshish” orqali kiriting." />
      {products.length >= 1000 && <div className="notice info">Birinchi 1000 ta mahsulot koʻrsatilmoqda. Kerakli tovarni nomi, IKPU, ishlab chiqaruvchi yoki FOM ID boʻyicha qidiring.</div>}
      {!!products.length && <TableWrap><thead><tr><th>MAHSULOT</th><th>KOD</th><th>SHTRIX-KOD</th><th>GURUH</th><th>BIRLIK</th><th className="num">QQS</th><th className="num">TANNARX</th><th className="num">SOTUV NARXI</th><th className="num">QOLDIQ</th><th>YAROQLILIK</th><th>MANBA</th></tr></thead>
        <tbody>{products.map(p => <tr key={p.id}>
          <td><Link href={`/stock/product/${p.id}`} className="table-main-link">{p.name}</Link>{(p.manufacturer || p.ikpu) && <small className="muted-line">{[p.manufacturer, p.ikpu && `IKPU ${p.ikpu}`].filter(Boolean).join(' · ')}</small>}</td>
          <td>{p.code || (p.fomId ? <span className="mono">FOM {p.fomId}</span> : '—')}</td>
          <td>{p.barcode || '—'}</td>
          <td>{p.group || '—'}</td>
          <td>{p.unit}</td>
          <td className="num">{p.vatRate ? `${p.vatRate}%` : 'QQSsiz'}</td>
          <td className="num">{money(p.costPrice)}</td>
          <td className="num cell-strong">{money(p.retailPrice)}</td>
          <td className={`num ${p.stock <= 0 ? 'negative' : ''}`}>{qty(p.stock)}</td>
          <td>{date(p.expiryDate)}</td>
          <td><StatusBadge tone={p.source === 'demo' ? 'warn' : 'neutral'}>{sourceText(p.source)}</StatusBadge></td>
        </tr>)}</tbody></TableWrap>}
    </Panel> : <Panel title={tab === 'supplier' ? 'Yetkazib beruvchilar' : 'Mijozlar'} subtitle={tab === 'supplier' ? 'Kirim hujjatlarida avtomatik qoʻshiladi' : 'Nasiya savdoda avtomatik qoʻshiladi'} action={<SearchBox value={search} onChange={setSearch} placeholder="Nomi, STIR, telefon" />}>
      <DataState loading={cpQ.isLoading} error={cpQ.isError} empty={!cpQ.isLoading && !cpQ.isError && !cps.length} retry={() => cpQ.refetch()} />
      {!!cps.length && <TableWrap><thead><tr><th>NOMI</th><th>STIR</th><th>TELEFON</th><th>IZOH</th><th className="num">{tab === 'supplier' ? 'BIZNING QARZIMIZ' : 'ULARNING QARZI'}</th></tr></thead>
        <tbody>{cps.map(c => <tr key={c.id}>
          <td className="cell-strong">{c.name}</td>
          <td>{c.taxId || '—'}</td>
          <td>{c.phone || '—'}</td>
          <td>{c.note || '—'}</td>
          <td className={`num cell-strong ${num(tab === 'supplier' ? c.payable : c.receivable) ? (tab === 'supplier' ? 'negative' : 'positive') : ''}`}>{money(tab === 'supplier' ? c.payable : c.receivable)}</td>
        </tr>)}</tbody></TableWrap>}
    </Panel>}
    {creating === 'products' && <ProductModal onClose={() => setCreating(null)} />}
    {(creating === 'supplier' || creating === 'customer') && <CounterpartyModal kind={creating} onClose={() => setCreating(null)} />}
  </>;
}

function ProductModal({ onClose }: { onClose: () => void }) {
  const refresh = useRefreshAll();
  const create = useCreateProduct();
  const [form, setForm] = useState({ name: '', code: '', barcode: '', group: '', unit: units[0], retailPrice: '', vatRate: '12', expiryDate: '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ data: { name: form.name.trim(), code: form.code.trim() || null, barcode: form.barcode.trim() || null, group: form.group.trim(), unit: form.unit, retailPrice: toMoney(num(form.retailPrice)), vatRate: num(form.vatRate), expiryDate: form.expiryDate || null } }, { onSuccess: () => { refresh(); onClose(); } });
  };
  return <Modal eyebrow="MAʼLUMOTNOMA" title="Yangi mahsulot" onClose={onClose} busy={create.isPending} size="lg">
    <form className="form-stack" onSubmit={submit}>
      <div className="form-grid">
        <label className="span-2">Nomi<input required minLength={2} value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Masalan: Paratsetamol 500 mg №10" /></label>
        <label>Ichki kod<input value={form.code} onChange={e => set({ code: e.target.value })} placeholder="P-0001" /></label>
        <label>Shtrix-kod<input value={form.barcode} onChange={e => set({ barcode: e.target.value })} /></label>
        <label>Guruh<input value={form.group} onChange={e => set({ group: e.target.value })} placeholder="Ogʻriq qoldiruvchi" /></label>
        <label>Oʻlchov birligi<select value={form.unit} onChange={e => set({ unit: e.target.value })}>{units.map(u => <option key={u}>{u}</option>)}</select></label>
        <label>Sotuv narxi (soʻm)<input type="number" required min="0" step="0.01" value={form.retailPrice} onChange={e => set({ retailPrice: e.target.value })} /></label>
        <label>QQS stavkasi<select value={form.vatRate} onChange={e => set({ vatRate: e.target.value })}><option value="0">QQSsiz (0%)</option><option value="12">12%</option><option value="15">15%</option></select><span className="field-hint">QQS narx ichida hisoblanadi</span></label>
        <label>Yaroqlilik muddati <span className="optional">ixtiyoriy</span><input type="date" value={form.expiryDate} onChange={e => set({ expiryDate: e.target.value })} /></label>
      </div>
      <div className="notice info">Tannarx va qoldiq “Kirim” hujjati orqali avtomatik shakllanadi.</div>
      <FormError error={create.error} />
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Bekor qilish</button><button className="button primary" disabled={create.isPending} data-testid="button-save-product">{create.isPending ? 'Saqlanmoqda…' : 'Mahsulotni saqlash'}</button></div>
    </form>
  </Modal>;
}

function CounterpartyModal({ kind, onClose }: { kind: 'supplier' | 'customer'; onClose: () => void }) {
  const refresh = useRefreshAll();
  const create = useCreateCounterparty();
  const [form, setForm] = useState({ name: '', taxId: '', phone: '', note: '' });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate({ data: { kind, ...form, name: form.name.trim() } }, { onSuccess: () => { refresh(); onClose(); } }); };
  return <Modal eyebrow="MAʼLUMOTNOMA" title={kind === 'supplier' ? 'Yangi yetkazib beruvchi' : 'Yangi mijoz'} onClose={onClose} busy={create.isPending}>
    <form className="form-stack" onSubmit={submit}>
      <label>Nomi<input required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={kind === 'supplier' ? 'MChJ “…”' : 'F.I.Sh. yoki tashkilot'} /></label>
      <div className="form-grid">
        <label>STIR (INN)<input value={form.taxId} onChange={e => setForm({ ...form, taxId: e.target.value })} inputMode="numeric" /></label>
        <label>Telefon<input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+998 …" /></label>
      </div>
      <label>Izoh <span className="optional">ixtiyoriy</span><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
      <FormError error={create.error} />
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Bekor qilish</button><button className="button primary" disabled={create.isPending} data-testid="button-save-counterparty">{create.isPending ? 'Saqlanmoqda…' : 'Saqlash'}</button></div>
    </form>
  </Modal>;
}
