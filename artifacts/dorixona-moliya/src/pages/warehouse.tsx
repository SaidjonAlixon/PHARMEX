import { useMemo, useState } from 'react';
import {
  ArrowRight, Boxes, PackageSearch, Scale, ShoppingBag, TrendingDown, TrendingUp,
} from 'lucide-react';
import { Link } from 'wouter';
import { useGetWarehouseInsights, useListBranches, useListInventory } from '@workspace/api-client-react';
import type { InventoryItem } from '@workspace/api-client-react';
import {
  Chips, DataState, Drawer, InfoGrid, KpiStrip, PageHeading, Panel, SearchBox, StatusBadge, TableWrap,
  date, money, num, qty, round2, stockStatus, type Filters,
} from '@/components/kit';
import { ProductCard } from '@/pages/stock';
import { ExpiryCell, QtyCell, expiryDaysOf, slowStatusLabel } from '@/pages/warehouse-shared';

const TEASER_LIMIT = 5;

type StockFilter = 'all' | 'in' | 'zero' | 'expiring' | 'expired';

const FILTER_LABEL: Record<StockFilter, string> = {
  all: 'Barcha tovarlar',
  in: 'Qoldiq bor tovarlar',
  zero: 'Tugagan tovarlar',
  expiring: 'Muddati yaqin tovarlar',
  expired: 'Muddati oʻtgan tovarlar',
};

function matchesFilter(i: InventoryItem, stockFilter: StockFilter) {
  if (stockFilter === 'all') return true;
  if (stockFilter === 'in') return i.quantity > 0;
  if (stockFilter === 'zero') return i.quantity <= 0;
  if (!(i.quantity > 0 && i.expiryDate)) return false;
  const d = expiryDaysOf(i.expiryDate);
  if (d == null) return false;
  if (stockFilter === 'expired') return d < 0;
  return d >= 0 && d <= 90;
}

function retailValueOf(i: InventoryItem) {
  return round2(Math.max(0, i.quantity) * num(i.retailPrice));
}

function sumView(rows: InventoryItem[]) {
  return {
    count: rows.length,
    costTotal: round2(rows.reduce((s, i) => s + num(i.value), 0)),
    retailTotal: round2(rows.reduce((s, i) => s + retailValueOf(i), 0)),
    qtyTotal: round2(rows.reduce((s, i) => s + Math.max(0, i.quantity), 0)),
  };
}

export function WarehousePage({ filters }: { filters: Filters }) {
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('in');
  const [warehouseId, setWarehouseId] = useState('');
  const [product, setProduct] = useState<number | null>(null);
  const [totalsOpen, setTotalsOpen] = useState(false);

  const branchesQ = useListBranches();
  const warehouses = useMemo(
    () => (branchesQ.data || []).filter(b => b.kind === 'warehouse'),
    [branchesQ.data],
  );
  const warehouseIds = useMemo(() => new Set(warehouses.map(w => w.id)), [warehouses]);

  const filterIsWarehouse = filters.branchId && warehouseIds.has(Number(filters.branchId));
  const activeWarehouseId = filterIsWarehouse
    ? filters.branchId
    : warehouseId || (warehouses.length === 1 ? String(warehouses[0].id) : '');

  const activeWarehouse = warehouses.find(w => String(w.id) === String(activeWarehouseId));

  const invQ = useListInventory({
    branchId: activeWarehouseId ? Number(activeWarehouseId) : undefined,
    search: search || undefined,
  });

  const insightsQ = useGetWarehouseInsights({
    branchId: activeWarehouseId ? Number(activeWarehouseId) : undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  });

  const inventory = useMemo(() => {
    const list = invQ.data || [];
    if (activeWarehouseId) return list;
    return list.filter(r => warehouseIds.has(r.branchId));
  }, [invQ.data, activeWarehouseId, warehouseIds]);

  const stats = useMemo(() => ({
    positions: inventory.filter(i => i.quantity > 0).length,
    zero: inventory.filter(i => i.quantity <= 0).length,
    expiring: inventory.filter(i => matchesFilter(i, 'expiring')).length,
    expired: inventory.filter(i => matchesFilter(i, 'expired')).length,
  }), [inventory]);

  const rows = useMemo(
    () => inventory.filter(i => matchesFilter(i, stockFilter)),
    [inventory, stockFilter],
  );

  const view = useMemo(() => {
    const base = sumView(rows);
    return { ...base, markup: round2(base.retailTotal - base.costTotal) };
  }, [rows]);
  const sectionTitle = FILTER_LABEL[stockFilter];

  const topSellers = insightsQ.data?.topSellers || [];
  const slowMovers = insightsQ.data?.slowMovers || [];
  const neverSold = slowMovers.filter(r => r.lastSoldAt == null).length;
  const expiredSlow = slowMovers.filter(r => r.expired).length;
  const emptyWarehouses = !branchesQ.isLoading && !warehouses.length;

  const periodLabel = filters.dateFrom && filters.dateTo
    ? `${date(filters.dateFrom)} — ${date(filters.dateTo)}`
    : 'Barcha davr';

  const warehouseTitle = activeWarehouse?.name || (warehouses.length ? `${warehouses.length} ta ombor` : 'Ombor');

  const openTotals = () => setTotalsOpen(true);

  return <>
    <PageHeading
      eyebrow="OMBOR · СКЛАД"
      title="Ombor"
      subtitle={`${warehouseTitle} · pastki filtrni tanlang — yuqoridagi kartalar shu boʻlimning umumiy hisobini koʻrsatadi. Davr: ${periodLabel}.`}
    />

    <KpiStrip items={[
      {
        label: `${sectionTitle} · soni`,
        value: view.count,
        count: true,
        icon: PackageSearch,
        hint: 'Kartani bosing — toʻliq hisob',
        tone: stockFilter === 'expired' ? 'bad' : stockFilter === 'expiring' ? 'warn' : undefined,
        onClick: openTotals,
        testId: 'kpi-warehouse-count',
      },
      {
        label: 'Tannarx jami',
        value: view.costTotal,
        icon: Boxes,
        hint: 'Qoldiq × 1 dona tannarx',
        onClick: openTotals,
        testId: 'kpi-warehouse-cost',
      },
      {
        label: 'Sotuv narxi jami',
        value: view.retailTotal,
        icon: ShoppingBag,
        hint: 'Qoldiq × 1 dona sotuv narxi',
        onClick: openTotals,
        testId: 'kpi-warehouse-retail',
      },
      {
        label: 'Farq (sotuv − tannarx)',
        value: view.markup,
        icon: Scale,
        hint: 'Potensial ustama · bosing — toʻliq',
        tone: view.markup < 0 ? 'bad' : 'good',
        onClick: openTotals,
        testId: 'kpi-warehouse-markup',
      },
    ]} />

    <div className="warehouse-teaser">
      <div className="warehouse-teaser-card">
        <div className="warehouse-teaser-head">
          <span className="warehouse-teaser-icon"><TrendingUp size={16} /></span>
          <div>
            <b>Eng koʻp sotiladiganlar</b>
            <p>Faqat top {TEASER_LIMIT} · jami {insightsQ.isLoading ? '…' : `${topSellers.length} ta`}</p>
          </div>
        </div>
        <div className="warehouse-teaser-scroll">
          {topSellers.slice(0, TEASER_LIMIT).map(r => (
            <button
              type="button"
              key={r.productId}
              className="warehouse-teaser-row is-clickable"
              onClick={() => setProduct(r.productId)}
              data-testid={`teaser-top-${r.productId}`}
            >
              <em>{r.rank}</em>
              <span>{r.productName}</span>
              <strong>{money(r.sales)}</strong>
            </button>
          ))}
          {!insightsQ.isLoading && !topSellers.length && <div className="inline-empty tight">Savdo yoʻq</div>}
        </div>
        <Link href="/warehouse/ranking/top" className="warehouse-teaser-more" data-testid="link-warehouse-top-full">
          Toʻliq reyting <ArrowRight size={14} />
        </Link>
      </div>

      <div className="warehouse-teaser-card">
        <div className="warehouse-teaser-head">
          <span className="warehouse-teaser-icon warn"><TrendingDown size={16} /></span>
          <div>
            <b>Kam / sotilmaydiganlar</b>
            <p>Faqat {TEASER_LIMIT} ta · {neverSold} sotilmagan · {expiredSlow} muddati oʻtgan</p>
          </div>
        </div>
        <div className="warehouse-teaser-scroll">
          {slowMovers.slice(0, TEASER_LIMIT).map(r => (
            <button
              type="button"
              key={r.productId}
              className="warehouse-teaser-row is-clickable"
              onClick={() => setProduct(r.productId)}
              data-testid={`teaser-slow-${r.productId}`}
            >
              <span>{r.productName}</span>
              <strong className={r.expired ? 'negative' : ''}>{slowStatusLabel(r)}</strong>
            </button>
          ))}
          {!insightsQ.isLoading && !slowMovers.length && <div className="inline-empty tight">Qoldiq yoʻq</div>}
        </div>
        <Link href="/warehouse/ranking/slow" className="warehouse-teaser-more warn" data-testid="link-warehouse-slow-full">
          Toʻliq roʻyxat <ArrowRight size={14} />
        </Link>
      </div>
    </div>

    <Panel
      className="warehouse-stock-panel"
      title="Ombor tovarlari"
      subtitle={`${warehouseTitle} · hozir: ${sectionTitle.toLowerCase()} · ${rows.length} ta qator`}
    >
      <div className="warehouse-toolbar">
        {warehouses.length > 1 && !filterIsWarehouse && (
          <label className="filter-control">
            <span>OMBOR</span>
            <select
              aria-label="Ombor"
              value={activeWarehouseId}
              onChange={e => setWarehouseId(e.target.value)}
              data-testid="select-warehouse"
            >
              <option value="">Barcha omborlar</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        )}
        <Chips
          value={stockFilter}
          onChange={setStockFilter}
          options={[
            { id: 'all', label: 'Barchasi', count: inventory.length },
            { id: 'in', label: 'Qoldiq bor', count: stats.positions },
            { id: 'zero', label: 'Tugagan', count: stats.zero },
            { id: 'expiring', label: 'Muddati yaqin', count: stats.expiring },
            { id: 'expired', label: 'Muddati oʻtgan', count: stats.expired },
          ]}
        />
        <SearchBox value={search} onChange={setSearch} placeholder="Mahsulot, kod, shtrix-kod" />
      </div>

      <div className="warehouse-view-summary" data-testid="warehouse-view-summary">
        <div>
          <span>Tanlangan boʻlim</span>
          <b>{sectionTitle}</b>
        </div>
        <div>
          <span>Mahsulotlar soni</span>
          <b>{view.count} ta</b>
        </div>
        <div>
          <span>Tannarx jami</span>
          <b>{money(view.costTotal)}</b>
        </div>
        <div>
          <span>Sotuv narxi jami</span>
          <b>{money(view.retailTotal)}</b>
        </div>
        <div>
          <span>Qoldiq qiymati (qoʻyilgan)</span>
          <b>{money(view.costTotal)}</b>
        </div>
        <button type="button" className="warehouse-summary-open" onClick={openTotals} data-testid="button-open-view-totals">
          Toʻliq hisob <ArrowRight size={14} />
        </button>
      </div>

      {emptyWarehouses ? (
        <div className="inline-empty" data-testid="empty-warehouse-branches">
          Hali ombor turi bilan filial yoʻq. «Filiallar» boʻlimida ombor (sklad) qoʻshing yoki FOM sinxronini tekshiring.
        </div>
      ) : (
        <>
          <DataState
            loading={invQ.isLoading || branchesQ.isLoading}
            error={invQ.isError || branchesQ.isError}
            empty={!invQ.isLoading && !invQ.isError && !rows.length}
            retry={() => { invQ.refetch(); branchesQ.refetch(); }}
            emptyText="Tanlangan filtr boʻyicha qoldiq topilmadi."
          />
          {!!rows.length && (
            <TableWrap>
              <thead>
                <tr>
                  <th>MAHSULOT</th>
                  <th>OMBOR</th>
                  <th className="num">QOLDIQ</th>
                  <th>HOLAT</th>
                  <th className="num" title="1 dona / 1 quti tannarxi">1 DONA TANNARX</th>
                  <th className="num" title="1 dona / 1 quti sotuv narxi">1 DONA SOTUV</th>
                  <th className="num" title="Qoldiq × tannarx = ombordagi summa">QOLDIQ QIYMATI</th>
                  <th>YAROQLILIK</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x: InventoryItem) => {
                  const st = stockStatus(x.quantity);
                  return (
                    <tr
                      key={`${x.productId}-${x.branchId}`}
                      className="clickable"
                      onClick={() => setProduct(x.productId)}
                      data-testid={`row-warehouse-${x.productId}-${x.branchId}`}
                    >
                      <td>
                        <span className="table-main-link">{x.productName}</span>
                        <small>{[x.manufacturer, x.barcode].filter(Boolean).join(' · ') || x.group || '—'} · bosing — toʻliq</small>
                      </td>
                      <td className="cell-strong">{x.branchName}</td>
                      <td className="num"><QtyCell quantity={x.quantity} unit={x.unit} /></td>
                      <td><StatusBadge tone={st.tone}>{st.label}</StatusBadge></td>
                      <td className="num">{money(x.costPrice)}</td>
                      <td className="num">{money(x.retailPrice)}</td>
                      <td className="num" title={`Qoldiq qiymati = ${qty(x.quantity)} × ${money(x.costPrice)}`}>
                        {money(x.value)}
                      </td>
                      <td><ExpiryCell value={x.expiryDate} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </>
      )}
    </Panel>

    {totalsOpen && (
      <Drawer
        eyebrow="BOʻLIM HISOBI"
        title={sectionTitle}
        subtitle={<span>{warehouseTitle} · {view.count} ta mahsulot · kartani/yozuvni bosing — ochiladi</span>}
        onClose={() => setTotalsOpen(false)}
      >
        <InfoGrid items={[
          { label: 'Mahsulotlar soni', value: `${view.count} ta` },
          { label: 'Tannarx jami', value: money(view.costTotal) },
          { label: 'Sotuv narxi jami', value: money(view.retailTotal) },
          { label: 'Qoldiq qiymati (qoʻyilgan summa)', value: money(view.costTotal) },
          { label: 'Farq (sotuv − tannarx)', value: money(view.markup) },
        ]} />
        <p className="muted-line">
          <b>1 dona tannarx</b> — birlikning olinish narxi.
          {' '}<b>1 dona sotuv</b> — birlikning sotilish narxi.
          {' '}<b>Qoldiq qiymati</b> (= tannarx jami) — qoldiq × tannarx; jadvaldagi «QOLDIQ QIYMATI» ustuni, qoʻyilgan / ombordagi summa.
          {' '}<b>Sotuv narxi jami</b> — qoldiq × sotuv narxi.
        </p>
        <h3 className="subhead">Boʻlimdagi mahsulotlar</h3>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>MAHSULOT</th>
                <th className="num">QOLDIQ</th>
                <th className="num">1 DONA TANNARX</th>
                <th className="num">1 DONA SOTUV</th>
                <th className="num">QOLDIQ QIYMATI</th>
                <th className="num">SOTUVDAGI SUMMA</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(x => (
                <tr
                  key={`tot-${x.productId}-${x.branchId}`}
                  className="clickable"
                  onClick={() => { setTotalsOpen(false); setProduct(x.productId); }}
                >
                  <td>
                    <span className="table-main-link">{x.productName}</span>
                    <small>{x.branchName}</small>
                  </td>
                  <td className="num"><QtyCell quantity={x.quantity} unit={x.unit} /></td>
                  <td className="num">{money(x.costPrice)}</td>
                  <td className="num">{money(x.retailPrice)}</td>
                  <td className="num">{money(x.value)}</td>
                  <td className="num">{money(retailValueOf(x))}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <div className="inline-empty">Bu boʻlimda mahsulot yoʻq.</div>
        )}
      </Drawer>
    )}

    {product != null && (
      <ProductCard
        id={product}
        onClose={() => setProduct(null)}
        dateFrom={filters.dateFrom || undefined}
        dateTo={filters.dateTo || undefined}
      />
    )}
  </>;
}
