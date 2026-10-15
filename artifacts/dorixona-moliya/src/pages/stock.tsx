import { useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeftRight, Boxes, ClipboardCheck, FileMinus2, PackageMinus, PackagePlus, Plus, RotateCcw, Trash2, TriangleAlert, Truck, Undo2,
} from 'lucide-react';
import {
  getGetProductQueryKey, getGetPurchaseQueryKey, getGetStockDocumentQueryKey, useCreateStockDocument, useGetProduct, useGetPurchase,
  useGetStockDocument, useListInventory, useListPurchases, useListStockDocuments,
} from '@workspace/api-client-react';
import type { InventoryItem, Purchase, StockDocType, StockDocument } from '@workspace/api-client-react';
import {
  AccountSelect, BranchSelect, Chips, CounterpartyField, DataState, Drawer, FormError, InfoGrid, KpiStrip, Modal, PageHeading,
  Panel, ProductPicker, SearchBox, StatusBadge, TableWrap, Totals, date, dateTime, filterParams, localToIso, money, nowLocal, num,
  qty, round2, toMoney, useRefreshAll, type Filters, type PickedProduct,
} from '@/components/kit';
import { movementLabels, stockDocLabels, writeOffReasons } from '@/lib/labels';
import { useAccess } from '@/lib/access';

type Tab = 'balances' | 'all' | StockDocType;
type NewDoc = 'transfer' | 'write_off' | 'supplier_return' | 'inventory_count';

const docIcons: Record<string, typeof Boxes> = {
  transfer: ArrowLeftRight, write_off: FileMinus2, supplier_return: Truck, customer_return: Undo2, inventory_count: ClipboardCheck,
};

function expiryBadge(value?: string | null) {
  if (!value) return null;
  const days = Math.floor((new Date(value).getTime() - Date.now()) / 86400000);
  if (days < 0) return <StatusBadge tone="bad">Muddati oʻtgan</StatusBadge>;
  if (days <= 90) return <StatusBadge tone="warn">{days} kun qoldi</StatusBadge>;
  return null;
}

function branchLabel(name: string | null | undefined, kind: string | null | undefined) {
  if (!name) return '—';
  return <>{name}<small>{kind === 'warehouse' ? 'Ombor' : 'Dorixona'}</small></>;
}

export function StockPage({ filters, productId }: { filters: Filters; productId?: number }) {
  const { canEdit } = useAccess();
  const [tab, setTab] = useState<Tab>(productId ? 'balances' : 'all');
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'zero' | 'expiring'>('all');
  const [product, setProduct] = useState<number | null>(productId ?? null);
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState<NewDoc | null>(null);
  const base = filterParams(filters);
  const docsQ = useListStockDocuments({ dateFrom: base.dateFrom, dateTo: base.dateTo, branchId: base.branchId });
  const invQ = useListInventory({ branchId: base.branchId, search: search || undefined });
  const docs = docsQ.data || [];
  const inventory = invQ.data || [];

  const stats = useMemo(() => {
    const value = (t: string) => round2(docs.filter(d => d.docType === t).reduce((s, d) => s + num(d.totalCost), 0));
    const count = (t: string) => docs.filter(d => d.docType === t).length;
    const counts = docs.filter(d => d.docType === 'inventory_count');
    return {
      stockValue: round2(inventory.reduce((s, i) => s + num(i.value), 0)),
      positions: inventory.filter(i => i.quantity > 0).length,
      zero: inventory.filter(i => i.quantity <= 0).length,
      expiring: inventory.filter(i => i.quantity > 0 && i.expiryDate && new Date(i.expiryDate).getTime() - Date.now() <= 90 * 86400000).length,
      transfers: count('transfer'), transferValue: value('transfer'),
      writeOff: value('write_off'), writeOffCount: count('write_off'),
      supplierReturn: value('supplier_return'), supplierReturnCount: count('supplier_return'),
      customerReturn: value('customer_return'), customerReturnCount: count('customer_return'),
      surplus: round2(counts.reduce((s, d) => s + num(d.surplusValue), 0)),
      shortage: round2(counts.reduce((s, d) => s + num(d.shortageValue), 0)),
      counts: Object.fromEntries(['transfer', 'write_off', 'supplier_return', 'customer_return', 'inventory_count'].map(t => [t, count(t)])) as Record<string, number>,
    };
  }, [docs, inventory]);

  const term = search.trim().toLowerCase();
  const docRows = docs.filter(d => (tab === 'all' || d.docType === tab) && (!term || `${d.documentNo} ${d.counterpartyName} ${d.reason} ${d.branchName} ${d.toBranchName ?? ''}`.toLowerCase().includes(term)));
  const stockRows = inventory.filter(i => stockFilter === 'all' ? true : stockFilter === 'in' ? i.quantity > 0 : stockFilter === 'zero' ? i.quantity <= 0 : i.quantity > 0 && !!i.expiryDate && new Date(i.expiryDate).getTime() - Date.now() <= 90 * 86400000);

  const tabs: { id: Tab; label: string; icon: typeof Boxes; count?: number }[] = [
    { id: 'all', label: 'Barcha hujjatlar', icon: FileMinus2, count: docs.length },
    { id: 'transfer', label: 'Oʻtkazmalar', icon: ArrowLeftRight, count: stats.counts.transfer },
    { id: 'write_off', label: 'Hisobdan chiqarish', icon: PackageMinus, count: stats.counts.write_off },
    { id: 'supplier_return', label: 'Yetkazib beruvchiga qaytarish', icon: Truck, count: stats.counts.supplier_return },
    { id: 'customer_return', label: 'Mijozdan qaytgan', icon: Undo2, count: stats.counts.customer_return },
    { id: 'inventory_count', label: 'Inventarizatsiya', icon: ClipboardCheck, count: stats.counts.inventory_count },
    { id: 'balances', label: 'Qoldiqlar', icon: Boxes, count: stats.positions },
  ];

  return <>
    <PageHeading eyebrow="TOVAR HARAKATI · ТОВАРООБОРОТ" title="Tovar harakati" subtitle="Filiallararo va ombor oʻtkazmalari, hisobdan chiqarish, qaytarishlar, inventarizatsiya va qoldiqlar"
      actions={canEdit && <div className="heading-button-group">
        <button className="button primary" onClick={() => setCreating('transfer')} data-testid="button-new-transfer"><ArrowLeftRight size={15} /> Oʻtkazma</button>
        <button className="button secondary" onClick={() => setCreating('write_off')} data-testid="button-new-writeoff"><PackageMinus size={15} /> Hisobdan chiqarish</button>
        <button className="button secondary" onClick={() => setCreating('supplier_return')} data-testid="button-new-supplier-return"><Truck size={15} /> Qaytarish</button>
        <button className="button secondary" onClick={() => setCreating('inventory_count')} data-testid="button-new-inventory"><ClipboardCheck size={15} /> Inventarizatsiya</button>
      </div>} />
    <KpiStrip items={[
      { label: 'Zaxira qiymati (tannarx)', value: stats.stockValue, icon: Boxes, hint: `${stats.positions} ta pozitsiya` },
      { label: 'Oʻtkazmalar', value: stats.transferValue, icon: ArrowLeftRight, hint: `${stats.transfers} ta hujjat` },
      { label: 'Hisobdan chiqarildi', value: stats.writeOff, icon: PackageMinus, tone: stats.writeOff ? 'bad' : undefined, hint: `${stats.writeOffCount} ta hujjat` },
      { label: 'Yetkazib beruvchiga qaytdi', value: stats.supplierReturn, icon: Truck, hint: `${stats.supplierReturnCount} ta hujjat` },
      { label: 'Mijozdan qaytdi', value: stats.customerReturn, icon: Undo2, hint: `${stats.customerReturnCount} ta hujjat` },
      { label: 'Inventarizatsiya kamomadi', value: stats.shortage, icon: TriangleAlert, tone: stats.shortage ? 'bad' : undefined },
      { label: 'Inventarizatsiya ortiqchasi', value: stats.surplus, icon: PackagePlus, tone: stats.surplus ? 'good' : undefined },
    ]} />
    <div className="tabs scrollable">{tabs.map(t => <button key={t.id} className={tab === t.id ? 'selected' : ''} onClick={() => setTab(t.id)} data-testid={`tab-stock-${t.id}`}><t.icon size={15} /> {t.label}{t.count != null && <span className="tab-count">{t.count}</span>}</button>)}</div>
    {tab === 'balances' ? <Panel title="Tovar qoldiqlari" subtitle="Filial va omborlar kesimida; mahsulotni bosib kartani oching" action={<div className="toolbar"><Chips value={stockFilter} onChange={setStockFilter} options={[{ id: 'all', label: 'Barchasi', count: inventory.length }, { id: 'in', label: 'Qoldiq bor', count: stats.positions }, { id: 'zero', label: 'Tugagan', count: stats.zero }, { id: 'expiring', label: 'Muddati yaqin', count: stats.expiring }]} /><SearchBox value={search} onChange={setSearch} placeholder="Mahsulot, kod, shtrix-kod" /></div>}>
      <DataState loading={invQ.isLoading} error={invQ.isError} empty={!invQ.isLoading && !invQ.isError && !stockRows.length} retry={() => invQ.refetch()} emptyText="Qoldiq yoʻq. Tovar “Kirim” boʻlimi orqali qabul qilinadi." />
      {!!stockRows.length && <TableWrap><thead><tr><th>MAHSULOT</th><th>FILIAL / OMBOR</th><th className="num">QOLDIQ</th><th className="num">TANNARX</th><th className="num">SOTUV NARXI</th><th className="num">QIYMAT</th><th className="num">USTAMA</th><th>YAROQLILIK</th></tr></thead>
        <tbody>{stockRows.map((x: InventoryItem) => <tr key={`${x.productId}-${x.branchId}`} className="clickable" onClick={() => setProduct(x.productId)} data-testid={`row-inventory-${x.productId}-${x.branchId}`}>
          <td><span className="table-main-link">{x.productName}</span><small>{[x.manufacturer, x.barcode].filter(Boolean).join(' · ') || x.group || '—'}</small></td>
          <td>{x.branchName}</td>
          <td className={`num cell-strong ${x.quantity <= 0 ? 'negative' : ''}`}>{qty(x.quantity)}</td>
          <td className="num">{money(x.costPrice)}</td>
          <td className="num">{money(x.retailPrice)}</td>
          <td className="num">{money(x.value)}</td>
          <td className="num">{x.costPrice && num(x.costPrice) > 0 ? `${Math.round((num(x.retailPrice) / num(x.costPrice) - 1) * 1000) / 10}%` : '—'}</td>
          <td>{date(x.expiryDate)} {expiryBadge(x.expiryDate)}</td>
        </tr>)}</tbody></TableWrap>}
    </Panel> : <Panel title={tab === 'all' ? 'Tovar harakati hujjatlari' : stockDocLabels[tab]} subtitle="Qatorni bosib hujjat tarkibini koʻring" action={<SearchBox value={search} onChange={setSearch} placeholder="Hujjat, filial, sabab, hamkor" />}>
      <DataState loading={docsQ.isLoading} error={docsQ.isError} empty={!docsQ.isLoading && !docsQ.isError && !docRows.length} retry={() => docsQ.refetch()} emptyText={tab === 'customer_return' ? 'Mijozdan qaytarishlar “Savdolar” boʻlimidagi chek orqali rasmiylashtiriladi.' : 'Bu davrda hujjat yoʻq. Yuqoridagi tugmalar orqali yangi hujjat yarating.'} />
      {!!docRows.length && <DocumentTable rows={docRows} onOpen={setSelected} />}
    </Panel>}
    {product != null && <ProductCard id={product} onClose={() => setProduct(null)} />}
    {selected != null && <StockDocumentDrawer id={selected} onClose={() => setSelected(null)} />}
    {creating && <StockDocumentModal docType={creating} defaultBranch={filters.branchId} onClose={() => setCreating(null)} onCreated={id => { setCreating(null); setSelected(id); }} />}
  </>;
}

function DocumentTable({ rows, onOpen }: { rows: StockDocument[]; onOpen: (id: number) => void }) {
  return <TableWrap><thead><tr><th>HUJJAT / SANA</th><th>TURI</th><th>QAYERDAN</th><th>QAYERGA / HAMKOR</th><th>SABAB / IZOH</th><th className="num">POZ.</th><th className="num">QIYMAT</th><th>NATIJA</th></tr></thead>
    <tbody>{rows.map(d => {
      const Icon = docIcons[d.docType] ?? Boxes;
      return <tr key={d.id} className="clickable" onClick={() => onOpen(d.id)} data-testid={`row-stockdoc-${d.id}`}>
        <td><span className="table-main-link">{d.documentNo}</span><small>{dateTime(d.occurredAt)}</small></td>
        <td><span className={`doc-type ${d.docType}`}><Icon size={13} /> {stockDocLabels[d.docType]}</span></td>
        <td>{branchLabel(d.branchName, d.branchKind)}</td>
        <td>{d.docType === 'transfer' ? branchLabel(d.toBranchName, d.toBranchKind) : d.counterpartyName || '—'}</td>
        <td>{d.reason || '—'}{d.note && <small>{d.note}</small>}</td>
        <td className="num">{d.itemsCount}</td>
        <td className="num cell-strong">{d.docType === 'inventory_count' ? '—' : money(d.totalCost)}</td>
        <td>{d.docType === 'inventory_count'
          ? (num(d.shortageValue) || num(d.surplusValue)
            ? <div className="stacked-badges">{num(d.shortageValue) > 0 && <StatusBadge tone="bad">Kamomad {money(d.shortageValue)}</StatusBadge>}{num(d.surplusValue) > 0 && <StatusBadge tone="good">Ortiqcha {money(d.surplusValue)}</StatusBadge>}</div>
            : <StatusBadge tone="good">Mos keldi</StatusBadge>)
          : d.docType === 'write_off' ? <StatusBadge tone="bad">Zarar</StatusBadge> : <StatusBadge tone="neutral">Oʻtkazildi</StatusBadge>}</td>
      </tr>;
    })}</tbody></TableWrap>;
}

function ProductCard({ id, onClose }: { id: number; onClose: () => void }) {
  const params = { productId: id };
  const q = useGetProduct(params, { query: { queryKey: getGetProductQueryKey(params) } });
  const d = q.data;
  const total = d ? round2(d.branchBalances.reduce((s, b) => s + b.quantity, 0)) : 0;
  const value = d ? round2(d.branchBalances.reduce((s, b) => s + num(b.value), 0)) : 0;
  return <Drawer eyebrow="MAHSULOT KARTASI" title={d?.product.productName || 'Mahsulot'} subtitle={d && <span>{d.product.group || 'Guruhsiz'}</span>} onClose={onClose}>
    <DataState loading={q.isLoading} error={q.isError} empty={false} retry={() => q.refetch()} />
    {d && <>
      <InfoGrid items={[
        { label: 'Ishlab chiqaruvchi', value: d.product.manufacturer || '—' },
        { label: 'IKPU (MXIK)', value: d.product.ikpu ? <span className="mono">{d.product.ikpu}</span> : '—' },
        { label: 'Shtrix-kod', value: d.product.barcode || '—' },
        { label: 'Guruh', value: d.product.group || '—' },
        { label: 'Sotuv narxi', value: `${money(d.product.retailPrice)} soʻm` },
        { label: 'Oʻrtacha tannarx', value: d.product.costPrice ? `${money(d.product.costPrice)} soʻm` : '—' },
        { label: 'Jami qoldiq', value: qty(total) },
        { label: 'Zaxira qiymati', value: `${money(value)} soʻm` },
      ]} />
      <h3 className="subhead">Filial va omborlar kesimida</h3>
      <TableWrap><thead><tr><th>FILIAL / OMBOR</th><th className="num">MIQDOR</th><th className="num">TANNARX</th><th className="num">QIYMAT</th><th>YAROQLILIK</th></tr></thead>
        <tbody>{d.branchBalances.map((b, i) => <tr key={`${b.branchId}-${i}`}><td className="cell-strong">{b.branchName}</td><td className={`num ${b.quantity <= 0 ? 'negative' : ''}`}>{qty(b.quantity)}</td><td className="num">{money(b.costPrice)}</td><td className="num">{money(b.value)}</td><td>{date(b.expiryDate)} {expiryBadge(b.expiryDate)}</td></tr>)}</tbody></TableWrap>
    </>}
  </Drawer>;
}

function StockDocumentDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const params = { documentId: id };
  const q = useGetStockDocument(params, { query: { queryKey: getGetStockDocumentQueryKey(params) } });
  const d = q.data?.document;
  const lines = q.data?.lines || [];
  const isCount = d?.docType === 'inventory_count';
  return <Drawer eyebrow={d ? stockDocLabels[d.docType].toUpperCase() : 'HUJJAT'} title={d ? d.documentNo : 'Hujjat'} subtitle={d && <span>{dateTime(d.occurredAt)}</span>} onClose={onClose}>
    <DataState loading={q.isLoading} error={q.isError} empty={false} retry={() => q.refetch()} />
    {d && <>
      <InfoGrid items={[
        { label: 'Hujjat turi', value: stockDocLabels[d.docType] },
        { label: d.docType === 'transfer' ? 'Joʻnatuvchi' : 'Filial / ombor', value: `${d.branchName} (${d.branchKind === 'warehouse' ? 'ombor' : 'dorixona'})` },
        ...(d.docType === 'transfer' ? [{ label: 'Qabul qiluvchi', value: `${d.toBranchName} (${d.toBranchKind === 'warehouse' ? 'ombor' : 'dorixona'})` }] : []),
        ...(d.counterpartyName ? [{ label: d.docType === 'customer_return' ? 'Mijoz' : 'Yetkazib beruvchi', value: d.counterpartyName }] : []),
        { label: 'Sana va vaqt', value: dateTime(d.occurredAt) },
        { label: 'Sabab', value: d.reason || '—' },
        ...(d.note ? [{ label: 'Izoh', value: d.note }] : []),
        { label: 'Kiritgan', value: d.createdBy || '—' },
      ]} />
      <h3 className="subhead">Tarkib</h3>
      <TableWrap><thead><tr><th>MAHSULOT / KOD</th>{isCount ? <><th className="num">HISOBDA</th><th className="num">SANALDI</th><th className="num">FARQ</th></> : <th className="num">MIQDOR</th>}<th className="num">TANNARX</th><th className="num">SUMMA</th><th>NATIJA</th></tr></thead>
        <tbody>{lines.map(l => <tr key={l.id}>
          <td className="cell-strong">{l.productName}<small>{l.productCode || '—'} · {l.unit}</small></td>
          {isCount ? <><td className="num">{qty(l.expectedQuantity)}</td><td className="num">{qty(l.countedQuantity)}</td><td className={`num cell-strong ${l.movementType === 'inventory_shortage' ? 'negative' : l.movementType === 'inventory_surplus' ? 'positive' : ''}`}>{l.movementType === 'inventory_shortage' ? '−' : l.movementType === 'inventory_surplus' ? '+' : ''}{qty(l.quantity)}</td></> : <td className="num">{qty(l.quantity)}</td>}
          <td className="num">{money(l.unitCost)}</td>
          <td className="num">{money(l.total)}</td>
          <td><StatusBadge tone={l.movementType === 'inventory_shortage' || l.movementType === 'write_off' ? 'bad' : l.movementType === 'inventory_surplus' ? 'good' : 'neutral'}>{movementLabels[l.movementType] ?? l.movementType}</StatusBadge></td>
        </tr>)}</tbody></TableWrap>
      <Totals rows={isCount ? [
        { label: 'Kamomad (zarar)', value: d.shortageValue, tone: 'bad' },
        { label: 'Ortiqcha (kirim)', value: d.surplusValue, tone: 'good' },
      ] : [{ label: d.docType === 'write_off' ? 'Zarar (tannarxda)' : 'Hujjat qiymati', value: d.totalCost, strong: true }]} />
    </>}
  </Drawer>;
}

type Line = { productId: number; name: string; code: string; unit: string; available: number | null; branchCost: string | null; quantity: string; unitCost: string };

const docTitles: Record<NewDoc, { eyebrow: string; title: string }> = {
  transfer: { eyebrow: 'OʻTKAZMA · ПЕРЕМЕЩЕНИЕ', title: 'Filiallar / ombor oʻrtasida oʻtkazma' },
  write_off: { eyebrow: 'HISOBDAN CHIQARISH · СПИСАНИЕ', title: 'Tovarni hisobdan chiqarish' },
  supplier_return: { eyebrow: 'QAYTARISH · ВОЗВРАТ ПОСТАВЩИКУ', title: 'Yetkazib beruvchiga qaytarish' },
  inventory_count: { eyebrow: 'INVENTARIZATSIYA · ИНВЕНТАРИЗАЦИЯ', title: 'Inventarizatsiya (sanoq natijasi)' },
};

export function StockDocumentModal({ docType, defaultBranch, purchase, onClose, onCreated }: { docType: NewDoc; defaultBranch: string; purchase?: Purchase; onClose: () => void; onCreated?: (id: number) => void }) {
  const refresh = useRefreshAll();
  const create = useCreateStockDocument();
  const [branchId, setBranchId] = useState(purchase ? String(purchase.branchId) : defaultBranch);
  const [toBranchId, setToBranchId] = useState('');
  const [occurredAt, setOccurredAt] = useState(nowLocal());
  const [documentNo, setDocumentNo] = useState('');
  const [reason, setReason] = useState(docType === 'write_off' ? writeOffReasons[0] : '');
  const [note, setNote] = useState('');
  const [supplier, setSupplier] = useState({ name: purchase?.supplierName ?? '', id: purchase?.counterpartyId ?? null as number | null });
  const [purchaseId, setPurchaseId] = useState(purchase ? String(purchase.id) : '');
  const [settlement, setSettlement] = useState<'debt' | 'money' | 'none'>(purchase?.debtId && num(purchase.balance) > 0 ? 'debt' : 'money');
  const [accountId, setAccountId] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [localError, setLocalError] = useState('');

  const purchasesQ = useListPurchases({ branchId: branchId ? Number(branchId) : undefined }, { query: { enabled: docType === 'supplier_return' && !!branchId, queryKey: ['purchases-for-return', branchId] } });
  const purchaseOptions = purchasesQ.data || [];
  const chosenPurchase = purchase ?? purchaseOptions.find(p => String(p.id) === purchaseId);
  const purchaseParams = { purchaseId: Number(purchaseId) || 0 };
  const purchaseDetail = useGetPurchase(purchaseParams, { query: { enabled: docType === 'supplier_return' && !!purchaseId, queryKey: getGetPurchaseQueryKey(purchaseParams) } }).data;
  const branchStock = useListInventory({ branchId: Number(branchId) || undefined }, { query: { enabled: docType === 'inventory_count' && !!branchId, queryKey: ['inventory-count', branchId] } }).data || [];

  const isCount = docType === 'inventory_count';
  const costOf = (l: Line) => num(l.unitCost || l.branchCost);
  const diffOf = (l: Line) => round2(num(l.quantity) - (l.available ?? 0));
  const shortage = round2(lines.reduce((s, l) => s + (isCount && diffOf(l) < 0 ? -diffOf(l) * costOf(l) : 0), 0));
  const surplus = round2(lines.reduce((s, l) => s + (isCount && diffOf(l) > 0 ? diffOf(l) * costOf(l) : 0), 0));
  const total = round2(lines.reduce((s, l) => s + num(l.quantity) * costOf(l), 0));

  const purchaseCost = (productId: number) => purchaseDetail?.lines.find(l => l.productId === productId)?.landedUnitCost ?? null;
  const addProduct = (p: PickedProduct) => {
    if (lines.some(l => l.productId === p.id)) return;
    const cost = docType === 'supplier_return' ? purchaseCost(p.id) ?? p.branchCost ?? p.costPrice ?? '' : '';
    setLines([...lines, { productId: p.id, name: p.name, code: p.code || p.barcode || '', unit: p.unit, available: p.available, branchCost: p.branchCost ?? p.costPrice, quantity: isCount ? String(p.available ?? 0) : '1', unitCost: cost }]);
  };
  const loadAllStock = () => {
    const existing = new Set(lines.map(l => l.productId));
    setLines([...lines, ...branchStock.filter(i => !existing.has(i.productId) && i.quantity !== 0).map(i => ({ productId: i.productId, name: i.productName, code: i.barcode || '', unit: '', available: i.quantity, branchCost: i.costPrice ?? null, quantity: String(i.quantity), unitCost: '' }))]);
  };
  const loadPurchaseLines = () => {
    if (!purchaseDetail) return;
    const existing = new Set(lines.map(l => l.productId));
    setLines([...lines, ...purchaseDetail.lines.filter(l => !existing.has(l.productId)).map(l => ({ productId: l.productId, name: l.productName, code: l.productCode || '', unit: l.unit, available: null, branchCost: l.landedUnitCost, quantity: String(l.quantity), unitCost: l.landedUnitCost }))]);
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => j === i ? { ...l, ...patch } : l));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError('');
    if (!lines.length) return setLocalError('Kamida bitta mahsulot qoʻshing.');
    if (!isCount) {
      const over = lines.find(l => l.available != null && num(l.quantity) > l.available);
      if (over) return setLocalError(`“${over.name}” qoldigʻi yetarli emas (mavjud ${qty(over.available)}).`);
      if (lines.some(l => num(l.quantity) <= 0)) return setLocalError('Miqdor noldan katta boʻlishi kerak.');
    }
    if (docType === 'transfer' && (!toBranchId || toBranchId === branchId)) return setLocalError('Qabul qiluvchi filial yoki omborni tanlang (joʻnatuvchidan farqli).');
    if (docType === 'supplier_return' && !chosenPurchase && !supplier.name.trim()) return setLocalError('Yetkazib beruvchini kiriting yoki kirim hujjatini tanlang.');
    if (docType === 'supplier_return' && settlement === 'debt' && !chosenPurchase?.debtId) return setLocalError('Qarzdan ayirish uchun kirim hujjatini tanlang.');
    if (docType === 'supplier_return' && settlement === 'money' && !accountId) return setLocalError('Pul qaytariladigan kassa yoki bank hisobini tanlang.');
    create.mutate({ data: {
      docType, branchId: Number(branchId), toBranchId: docType === 'transfer' ? Number(toBranchId) : null, occurredAt: localToIso(occurredAt),
      documentNo: documentNo.trim() || undefined, reason, note,
      counterpartyId: docType === 'supplier_return' ? supplier.id : null, counterpartyName: docType === 'supplier_return' ? supplier.name.trim() : undefined,
      purchaseId: docType === 'supplier_return' && chosenPurchase ? chosenPurchase.id : null,
      settlement: docType === 'supplier_return' ? settlement : undefined, accountId: docType === 'supplier_return' && settlement === 'money' && accountId ? Number(accountId) : null,
      items: lines.map(l => ({ productId: l.productId, quantity: num(l.quantity), unitCost: docType === 'supplier_return' && l.unitCost ? toMoney(num(l.unitCost)) : undefined })),
    } }, { onSuccess: res => { refresh(); if (onCreated) onCreated(res.document.id); else onClose(); } });
  };

  const t = docTitles[docType];
  return <Modal eyebrow={t.eyebrow} title={t.title} onClose={onClose} busy={create.isPending} size="xl">
    <form className="form-stack" onSubmit={submit}>
      <div className="form-grid four">
        <BranchSelect value={branchId} onChange={v => { setBranchId(v); setLines([]); setPurchaseId(''); }} label={docType === 'transfer' ? 'Joʻnatuvchi (filial / ombor)' : 'Filial / ombor'} />
        {docType === 'transfer' && <BranchSelect value={toBranchId} onChange={setToBranchId} label="Qabul qiluvchi" exclude={branchId} />}
        <label>Sana va vaqt<input type="datetime-local" required value={occurredAt} onChange={e => setOccurredAt(e.target.value)} /></label>
        <label>Hujjat raqami <span className="optional">ixtiyoriy</span><input value={documentNo} onChange={e => setDocumentNo(e.target.value)} placeholder="Avtomatik" /></label>
        {docType === 'write_off' && <label>Sabab<select required value={reason} onChange={e => setReason(e.target.value)}>{writeOffReasons.map(r => <option key={r}>{r}</option>)}</select></label>}
        {docType === 'supplier_return' && <>
          {!purchase && <label>Kirim hujjati <span className="optional">ixtiyoriy</span><select value={purchaseId} onChange={e => { setPurchaseId(e.target.value); const p = purchaseOptions.find(x => String(x.id) === e.target.value); if (p) { setSupplier({ name: p.supplierName, id: p.counterpartyId }); setSettlement(p.debtId && num(p.balance) > 0 ? 'debt' : 'money'); } }}><option value="">Tanlanmagan</option>{purchaseOptions.map(p => <option key={p.id} value={p.id}>{p.documentNo} · {p.supplierName} · {date(p.receivedAt)} · qarz {money(p.balance)}</option>)}</select></label>}
          {chosenPurchase ? <label>Yetkazib beruvchi<input value={chosenPurchase.supplierName} disabled /></label> : <CounterpartyField kind="supplier" label="Yetkazib beruvchi" value={supplier.name} onChange={(name, id) => setSupplier({ name, id })} />}
          <label>Qaytarish sababi<input required minLength={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Sifatsiz, muddati yaqin, ortiqcha keldi…" /></label>
        </>}
        {isCount && <label>Sanoq oʻtkazgan<input value={reason} onChange={e => setReason(e.target.value)} placeholder="Komissiya / masʼul shaxs" /></label>}
      </div>
      {docType === 'write_off' && <div className="notice warn">Hisobdan chiqarilgan tovar tannarxi “Tovar hisobdan chiqarish” xarajati sifatida foyda-zararga yoziladi.</div>}
      {isCount && <div className="notice info">Har bir mahsulot uchun haqiqatda sanalgan miqdorni kiriting. Farq avtomatik hisoblanadi: kamomad zarar sifatida xarajatga, ortiqcha qoldiqqa kirim boʻladi.</div>}
      <div className="line-editor">
        <div className="line-editor-head"><b>Tovarlar</b>
          <div className="toolbar">
            {isCount && branchId && <button type="button" className="button secondary small" onClick={loadAllStock}><Boxes size={13} /> Barcha qoldiqni yuklash</button>}
            {docType === 'supplier_return' && purchaseDetail && <button type="button" className="button secondary small" onClick={loadPurchaseLines}><RotateCcw size={13} /> Kirim tovarlarini yuklash</button>}
            {branchId ? <ProductPicker branchId={branchId} onlyInStock={!isCount} onPick={addProduct} /> : <span className="field-hint">Avval filialni tanlang</span>}
          </div>
        </div>
        {lines.length ? <TableWrap><thead><tr><th>MAHSULOT</th><th className="num">{isCount ? 'HISOBDA' : 'QOLDIQ'}</th><th className="num">{isCount ? 'SANALDI' : 'MIQDOR'}</th>{isCount && <th className="num">FARQ</th>}<th className="num">{docType === 'supplier_return' ? 'QAYTARISH NARXI' : 'TANNARX'}</th><th className="num">{isCount ? 'FARQ SUMMASI' : 'SUMMA'}</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => {
            const diff = diffOf(l);
            return <tr key={l.productId}>
              <td className="cell-strong">{l.name}<small>{l.code || '—'}{l.unit ? ` · ${l.unit}` : ''}</small></td>
              <td className={`num ${!isCount && l.available != null && num(l.quantity) > l.available ? 'negative' : ''}`}>{qty(l.available)}</td>
              <td className="num"><input className="cell-input" type="number" min={isCount ? 0 : 0.001} step="0.001" required value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} /></td>
              {isCount && <td className={`num cell-strong ${diff < 0 ? 'negative' : diff > 0 ? 'positive' : ''}`}>{diff > 0 ? '+' : ''}{qty(diff)}</td>}
              <td className="num">{docType === 'supplier_return' ? <input className="cell-input wide" type="number" min="0" step="0.01" value={l.unitCost} onChange={e => setLine(i, { unitCost: e.target.value })} placeholder={l.branchCost ?? ''} /> : money(l.branchCost)}</td>
              <td className="num">{money(round2((isCount ? Math.abs(diff) : num(l.quantity)) * costOf(l)))}</td>
              <td><button type="button" className="icon-button" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Oʻchirish"><Trash2 size={15} /></button></td>
            </tr>;
          })}</tbody></TableWrap> : <div className="inline-empty"><Plus size={15} /> Mahsulot qidirib qoʻshing{isCount ? ' yoki barcha qoldiqni yuklang' : ''}.</div>}
      </div>
      <div className="detail-columns">
        <div className="form-stack">
          {docType === 'supplier_return' && <div className="form-grid">
            <label>Hisob-kitob<select value={settlement} onChange={e => setSettlement(e.target.value as typeof settlement)}>
              <option value="debt" disabled={!chosenPurchase?.debtId}>Yetkazib beruvchiga qarzimizdan ayirish</option>
              <option value="money">Yetkazib beruvchi pulni qaytaradi</option>
              <option value="none">Hisob-kitobsiz (almashtirish)</option>
            </select></label>
            {settlement === 'money' && <AccountSelect value={accountId} onChange={setAccountId} branchId={branchId} label="Pul tushadigan hisob" required />}
          </div>}
          <label>Izoh <span className="optional">ixtiyoriy</span><textarea value={note} onChange={e => setNote(e.target.value)} rows={2} /></label>
        </div>
        <Totals rows={isCount ? [
          { label: 'Kamomad (zarar)', value: shortage, tone: 'bad' },
          { label: 'Ortiqcha', value: surplus, tone: 'good' },
          { label: 'Sof farq', value: round2(surplus - shortage), strong: true, tone: surplus - shortage < 0 ? 'bad' : 'good' },
        ] : [
          { label: docType === 'write_off' ? 'Zarar (tannarxda)' : docType === 'supplier_return' ? 'Qaytarish summasi' : 'Tannarx boʻyicha qiymat', value: total, strong: true, tone: docType === 'write_off' ? 'bad' : undefined },
        ]} />
      </div>
      <FormError error={localError || create.error} />
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Bekor qilish</button><button className="button primary" disabled={create.isPending || !lines.length} data-testid="button-save-stockdoc">{create.isPending ? 'Saqlanmoqda…' : 'Hujjatni saqlash'}</button></div>
    </form>
  </Modal>;
}
