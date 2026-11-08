import { useMemo, useState } from 'react';
import {
  ArrowRight, Download, PackageSearch, TrendingDown, TrendingUp,
} from 'lucide-react';
import { Link } from 'wouter';
import { useGetWarehouseInsights, useListBranches, useListInventory } from '@workspace/api-client-react';
import type { InventoryItem } from '@workspace/api-client-react';
import {
  Chips, DataState, Drawer, InfoGrid, PageHeading, Panel, SearchBox, StatusBadge, TableWrap,
  date, money, num, qty, round2, stockStatus, type Filters,
} from '@/components/kit';
import { ProductCard } from '@/pages/stock';
import { exportWarehouseExcel, retailValueOf } from '@/pages/warehouse-export';
import { ExpiryCell, QtyCell, expiryDaysOf, slowStatusLabel } from '@/pages/warehouse-shared';

const TEASER_LIMIT = 5;
const PREVIEW_LIMIT = 5;

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

function sumView(rows: InventoryItem[]) {
  const costTotal = round2(rows.reduce((s, i) => s + num(i.value), 0));
  const retailTotal = round2(rows.reduce((s, i) => s + retailValueOf(i), 0));
  return {
    count: rows.length,
    costTotal,
    retailTotal,
    markup: round2(retailTotal - costTotal),
  };
}

function StockTable({
  rows,
  onOpen,
  limit,
}: {
  rows: InventoryItem[];
  onOpen: (id: number) => void;
  limit?: number;
}) {
  const list = limit != null ? rows.slice(0, limit) : rows;
  return (
    <TableWrap>
      <thead>
        <tr>
          <th>MAHSULOT</th>
          <th>OMBOR</th>
          <th className="num">QOLDIQ</th>
          <th>HOLAT</th>
          <th className="num">1 DONA TANNARX</th>
          <th className="num">1 DONA SOTUV</th>
          <th className="num">QOLDIQ QIYMATI</th>
          <th className="num">QOʻYILGAN NARX</th>
          <th>YAROQLILIK</th>
        </tr>
      </thead>
      <tbody>
        {list.map((x: InventoryItem) => {
          const st = stockStatus(x.quantity);
          return (
            <tr
              key={`${x.productId}-${x.branchId}`}
              className="clickable"
              onClick={() => onOpen(x.productId)}
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
              <td className="num" title={`Qoldiq qiymati = ${qty(x.quantity)} × ${money(x.costPrice)}`}>{money(x.value)}</td>
              <td className="num" title={`Qoʻyilgan narx = ${qty(x.quantity)} × ${money(x.retailPrice)}`}>{money(retailValueOf(x))}</td>
              <td><ExpiryCell value={x.expiryDate} /></td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
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

  const buckets = useMemo(() => {
    const inStock = inventory.filter(i => matchesFilter(i, 'in'));
    const zero = inventory.filter(i => matchesFilter(i, 'zero'));
    const expiring = inventory.filter(i => matchesFilter(i, 'expiring'));
    const expired = inventory.filter(i => matchesFilter(i, 'expired'));
    const other = inStock.filter(i => !matchesFilter(i, 'expiring') && !matchesFilter(i, 'expired'));
    return {
      all: inventory,
      in: inStock,
      zero,
      expiring,
      expired,
      other,
      sums: {
        all: sumView(inventory),
        in: sumView(inStock),
        zero: sumView(zero),
        expiring: sumView(expiring),
        expired: sumView(expired),
        other: sumView(other),
      },
    };
  }, [inventory]);

  const rows = stockFilter === 'all' ? buckets.all : buckets[stockFilter];
  const view = stockFilter === 'all' ? buckets.sums.all : buckets.sums[stockFilter];
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

  const downloadExcel = (list: InventoryItem[], title: string) => {
    if (!list.length) return;
    exportWarehouseExcel(list, title);
  };

  return <>
    <PageHeading
      eyebrow="OMBOR · СКЛАД"
      title="Ombor"
      subtitle={`${warehouseTitle} · har bir boʻlimning jami summasi kartada. Filtrni tanlang yoki Excel yuklab oling. Davr: ${periodLabel}.`}
      actions={
        <button
          type="button"
          className="button primary"
          onClick={() => downloadExcel(rows, sectionTitle)}
          disabled={!rows.length}
          data-testid="button-warehouse-excel"
        >
          <Download size={15} /> Excel yuklash
        </button>
      }
    />

    <div className="warehouse-cat-grid" data-testid="warehouse-category-cards">
      {([
        { id: 'in' as const, tone: '', title: 'Qoldiq bor', hint: 'Ombordagi faol tovarlar' },
        { id: 'expiring' as const, tone: 'warn', title: 'Muddati yaqin', hint: '90 kungacha tugaydi' },
        { id: 'expired' as const, tone: 'bad', title: 'Muddati oʻtgan', hint: 'Yaroqsiz qoldiq — jami summa' },
        { id: 'all' as const, tone: '', title: 'Barchasi', hint: 'Barcha boʻlimlar birga' },
      ]).map(card => {
        const s = buckets.sums[card.id];
        const active = stockFilter === card.id;
        return (
          <button
            type="button"
            key={card.id}
            className={`warehouse-cat-card ${card.tone} ${active ? 'is-active' : ''}`}
            onClick={() => setStockFilter(card.id)}
            data-testid={`card-warehouse-${card.id}`}
          >
            <div className="warehouse-cat-top">
              <b>{card.title}</b>
              <em>{s.count} ta</em>
            </div>
            <p>{card.hint}</p>
            <div className="warehouse-cat-money">
              <div>
                <span>Tannarx jami</span>
                <strong>{money(s.costTotal)}</strong>
              </div>
              <div>
                <span>Qoʻyilgan narx</span>
                <strong>{money(s.retailTotal)}</strong>
              </div>
            </div>
          </button>
        );
      })}
    </div>

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
      subtitle={`${warehouseTitle} · tanlangan: ${sectionTitle.toLowerCase()}`}
      action={
        <button
          type="button"
          className="button secondary"
          onClick={() => downloadExcel(rows, sectionTitle)}
          disabled={!rows.length}
          data-testid="button-warehouse-excel-panel"
        >
          <Download size={15} /> Excel · {sectionTitle}
        </button>
      }
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
            { id: 'all', label: 'Barchasi', count: buckets.all.length },
            { id: 'in', label: 'Qoldiq bor', count: buckets.in.length },
            { id: 'zero', label: 'Tugagan', count: buckets.zero.length },
            { id: 'expiring', label: 'Muddati yaqin', count: buckets.expiring.length },
            { id: 'expired', label: 'Muddati oʻtgan', count: buckets.expired.length },
          ]}
        />
        <SearchBox value={search} onChange={setSearch} placeholder="Mahsulot, kod, shtrix-kod" />
      </div>

      <div className={`warehouse-active-banner ${stockFilter === 'expired' ? 'bad' : stockFilter === 'expiring' ? 'warn' : ''}`} data-testid="warehouse-active-banner">
        <div className="warehouse-active-main">
          <PackageSearch size={18} />
          <div>
            <b>{sectionTitle}</b>
            <p>
              {view.count} ta mahsulot · tannarx jami <strong>{money(view.costTotal)}</strong>
              {' '}· qoʻyilgan narx <strong>{money(view.retailTotal)}</strong>
            </p>
          </div>
        </div>
        <div className="warehouse-active-actions">
          <button type="button" className="button secondary" onClick={() => setTotalsOpen(true)} data-testid="button-open-view-totals">
            Toʻliq hisob
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => downloadExcel(rows, sectionTitle)}
            disabled={!rows.length}
            data-testid="button-warehouse-excel-banner"
          >
            <Download size={15} /> Excel
          </button>
        </div>
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

          {stockFilter === 'all' && !!rows.length && (
            <div className="warehouse-split-lists">
              <section className="warehouse-split-panel bad">
                <header>
                  <div>
                    <h3>Muddati oʻtgan</h3>
                    <p>{buckets.sums.expired.count} ta · tannarx {money(buckets.sums.expired.costTotal)} · qoʻyilgan {money(buckets.sums.expired.retailTotal)}</p>
                  </div>
                  <div className="warehouse-split-actions">
                    <button type="button" className="button secondary" onClick={() => setStockFilter('expired')}>Toʻliq ochish</button>
                    <button type="button" className="button secondary" disabled={!buckets.expired.length} onClick={() => downloadExcel(buckets.expired, FILTER_LABEL.expired)}>
                      <Download size={14} /> Excel
                    </button>
                  </div>
                </header>
                {buckets.expired.length
                  ? <StockTable rows={buckets.expired} onOpen={setProduct} limit={PREVIEW_LIMIT} />
                  : <div className="inline-empty tight">Muddati oʻtgan tovar yoʻq</div>}
                {buckets.expired.length > PREVIEW_LIMIT && (
                  <button type="button" className="warehouse-split-more" onClick={() => setStockFilter('expired')}>
                    Yana {buckets.expired.length - PREVIEW_LIMIT} ta · toʻliq roʻyxat <ArrowRight size={14} />
                  </button>
                )}
              </section>

              <section className="warehouse-split-panel warn">
                <header>
                  <div>
                    <h3>Muddati yaqin</h3>
                    <p>{buckets.sums.expiring.count} ta · tannarx {money(buckets.sums.expiring.costTotal)} · qoʻyilgan {money(buckets.sums.expiring.retailTotal)}</p>
                  </div>
                  <div className="warehouse-split-actions">
                    <button type="button" className="button secondary" onClick={() => setStockFilter('expiring')}>Toʻliq ochish</button>
                    <button type="button" className="button secondary" disabled={!buckets.expiring.length} onClick={() => downloadExcel(buckets.expiring, FILTER_LABEL.expiring)}>
                      <Download size={14} /> Excel
                    </button>
                  </div>
                </header>
                {buckets.expiring.length
                  ? <StockTable rows={buckets.expiring} onOpen={setProduct} limit={PREVIEW_LIMIT} />
                  : <div className="inline-empty tight">Muddati yaqin tovar yoʻq</div>}
                {buckets.expiring.length > PREVIEW_LIMIT && (
                  <button type="button" className="warehouse-split-more" onClick={() => setStockFilter('expiring')}>
                    Yana {buckets.expiring.length - PREVIEW_LIMIT} ta · toʻliq roʻyxat <ArrowRight size={14} />
                  </button>
                )}
              </section>

              <section className="warehouse-split-panel">
                <header>
                  <div>
                    <h3>Qolganlari (yaroqli qoldiq)</h3>
                    <p>{buckets.sums.other.count} ta · tannarx {money(buckets.sums.other.costTotal)} · qoʻyilgan {money(buckets.sums.other.retailTotal)}</p>
                  </div>
                  <div className="warehouse-split-actions">
                    <button type="button" className="button secondary" onClick={() => setStockFilter('in')}>Qoldiq bor</button>
                    <button type="button" className="button secondary" disabled={!buckets.other.length} onClick={() => downloadExcel(buckets.other, 'Qolganlari (yaroqli)')}>
                      <Download size={14} /> Excel
                    </button>
                  </div>
                </header>
                {buckets.other.length
                  ? <StockTable rows={buckets.other} onOpen={setProduct} limit={PREVIEW_LIMIT} />
                  : <div className="inline-empty tight">Boshqa qoldiq yoʻq</div>}
                {buckets.other.length > PREVIEW_LIMIT && (
                  <button type="button" className="warehouse-split-more" onClick={() => setStockFilter('in')}>
                    Yana {buckets.other.length - PREVIEW_LIMIT} ta · toʻliq roʻyxat <ArrowRight size={14} />
                  </button>
                )}
              </section>
            </div>
          )}

          {stockFilter !== 'all' && !!rows.length && (
            <StockTable rows={rows} onOpen={setProduct} />
          )}
        </>
      )}
    </Panel>

    {totalsOpen && (
      <Drawer
        eyebrow="BOʻLIM HISOBI"
        title={sectionTitle}
        subtitle={<span>{warehouseTitle} · {view.count} ta mahsulot</span>}
        onClose={() => setTotalsOpen(false)}
        actions={
          <button type="button" className="button primary" disabled={!rows.length} onClick={() => downloadExcel(rows, sectionTitle)}>
            <Download size={15} /> Excel yuklash
          </button>
        }
      >
        <InfoGrid items={[
          { label: 'Mahsulotlar soni', value: `${view.count} ta` },
          { label: 'Tannarx jami', value: money(view.costTotal) },
          { label: 'Qoʻyilgan narx jami', value: money(view.retailTotal) },
          { label: 'Farq (qoʻyilgan − tannarx)', value: money(view.markup) },
        ]} />
        <p className="muted-line">
          Bu raqamlar faqat <b>{sectionTitle.toLowerCase()}</b> boʻyicha. Filtrni oʻzgartirsangiz, jami ham oʻzgaradi. Excel shu roʻyxatni yuklab beradi.
        </p>
        {!!rows.length && <StockTable rows={rows} onOpen={(id) => { setTotalsOpen(false); setProduct(id); }} />}
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
