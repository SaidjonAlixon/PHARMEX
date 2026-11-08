import { useMemo, useState } from 'react';
import { ArrowRight, Boxes, PackageSearch, TrendingDown, TrendingUp, Warehouse } from 'lucide-react';
import { Link } from 'wouter';
import { useGetWarehouseInsights, useListBranches, useListInventory } from '@workspace/api-client-react';
import type { InventoryItem } from '@workspace/api-client-react';
import {
  Chips, DataState, KpiStrip, PageHeading, Panel, SearchBox, StatusBadge, TableWrap,
  date, money, num, round2, stockStatus, type Filters,
} from '@/components/kit';
import { ProductCard } from '@/pages/stock';
import { ExpiryCell, QtyCell } from '@/pages/warehouse-shared';

export function WarehousePage({ filters }: { filters: Filters }) {
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'zero' | 'expiring' | 'expired'>('in');
  const [warehouseId, setWarehouseId] = useState('');
  const [product, setProduct] = useState<number | null>(null);

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
    const rows = invQ.data || [];
    if (activeWarehouseId) return rows;
    return rows.filter(r => warehouseIds.has(r.branchId));
  }, [invQ.data, activeWarehouseId, warehouseIds]);

  const dayMs = 86400000;
  const stats = useMemo(() => {
    const now = Date.now();
    return {
      stockValue: round2(inventory.reduce((s, i) => s + num(i.value), 0)),
      positions: inventory.filter(i => i.quantity > 0).length,
      zero: inventory.filter(i => i.quantity <= 0).length,
      expiring: inventory.filter(i => {
        if (!(i.quantity > 0 && i.expiryDate)) return false;
        const d = new Date(`${i.expiryDate}T00:00:00`).getTime() - now;
        return d >= 0 && d <= 90 * dayMs;
      }).length,
      expired: inventory.filter(i => i.quantity > 0 && i.expiryDate && new Date(`${i.expiryDate}T00:00:00`).getTime() < now).length,
    };
  }, [inventory]);

  const rows = inventory.filter(i => {
    if (stockFilter === 'all') return true;
    if (stockFilter === 'in') return i.quantity > 0;
    if (stockFilter === 'zero') return i.quantity <= 0;
    if (!i.expiryDate || i.quantity <= 0) return false;
    const left = new Date(`${i.expiryDate}T00:00:00`).getTime() - Date.now();
    if (stockFilter === 'expired') return left < 0;
    return left >= 0 && left <= 90 * dayMs;
  });

  const topSellers = insightsQ.data?.topSellers || [];
  const slowMovers = insightsQ.data?.slowMovers || [];
  const neverSold = slowMovers.filter(r => r.lastSoldAt == null).length;
  const expiredSlow = slowMovers.filter(r => r.expired).length;
  const emptyWarehouses = !branchesQ.isLoading && !warehouses.length;

  const periodLabel = filters.dateFrom && filters.dateTo
    ? `${date(filters.dateFrom)} — ${date(filters.dateTo)}`
    : 'Barcha davr';

  const warehouseTitle = activeWarehouse?.name || (warehouses.length ? `${warehouses.length} ta ombor` : 'Ombor');

  return <>
    <PageHeading
      eyebrow="OMBOR · СКЛАД"
      title="Ombor"
      subtitle={`${warehouseTitle} · qoldiqlar roʻyxati. Sotuv reytingi alohida sahifada. Davr: ${periodLabel}.`}
      actions={
        <Link href="/warehouse/ranking" className="button primary" data-testid="button-open-warehouse-ranking">
          Sotuv reytingi <ArrowRight size={15} />
        </Link>
      }
    />

    <KpiStrip items={[
      { label: 'Ombordagi qiymat', value: stats.stockValue, icon: Boxes, hint: `${stats.positions} ta pozitsiya` },
      { label: 'Pozitsiyalar', value: stats.positions, count: true, icon: PackageSearch, hint: 'Qoldiq > 0' },
      { label: 'Muddati yaqin', value: stats.expiring, count: true, icon: Warehouse, tone: stats.expiring ? 'warn' : undefined, hint: '90 kungacha' },
      { label: 'Muddati oʻtgan', value: stats.expired, count: true, icon: PackageSearch, tone: stats.expired ? 'bad' : undefined, hint: 'Yaroqsiz qoldiq' },
    ]} />

    <div className="warehouse-teaser">
      <div className="warehouse-teaser-card">
        <div className="warehouse-teaser-head">
          <span className="warehouse-teaser-icon"><TrendingUp size={16} /></span>
          <div>
            <b>Eng koʻp sotiladiganlar</b>
            <p>Davr boʻyicha toʻliq reyting · {insightsQ.isLoading ? '…' : `${topSellers.length} ta`}</p>
          </div>
        </div>
        <div className="warehouse-teaser-scroll">
          {topSellers.slice(0, 5).map(r => (
            <div key={r.productId} className="warehouse-teaser-row">
              <em>{r.rank}</em>
              <span>{r.productName}</span>
              <strong>{money(r.sales)}</strong>
            </div>
          ))}
          {!insightsQ.isLoading && !topSellers.length && <div className="inline-empty tight">Savdo yoʻq</div>}
        </div>
      </div>

      <div className="warehouse-teaser-card">
        <div className="warehouse-teaser-head">
          <span className="warehouse-teaser-icon warn"><TrendingDown size={16} /></span>
          <div>
            <b>Kam / sotilmaydiganlar</b>
            <p>{neverSold} ta sotilmagan · {expiredSlow} ta muddati oʻtgan</p>
          </div>
        </div>
        <div className="warehouse-teaser-scroll">
          {slowMovers.slice(0, 5).map(r => (
            <div key={r.productId} className="warehouse-teaser-row">
              <span>{r.productName}</span>
              <strong className={r.expired ? 'negative' : ''}>{r.expired ? 'Muddati oʻtgan' : r.lastSoldAt ? 'Kam' : 'Sotilmagan'}</strong>
            </div>
          ))}
          {!insightsQ.isLoading && !slowMovers.length && <div className="inline-empty tight">Qoldiq yoʻq</div>}
        </div>
      </div>

      <Link href="/warehouse/ranking" className="warehouse-teaser-cta" data-testid="link-warehouse-ranking-full">
        Toʻliq reytingni ochish
        <ArrowRight size={16} />
      </Link>
    </div>

    <Panel
      className="warehouse-stock-panel"
      title="Ombor tovarlari"
      subtitle={`${warehouseTitle} · jami ${inventory.length} ta qator · koʻrsatilmoqda ${rows.length} ta`}
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
                  <th className="num">TANNARX</th>
                  <th className="num">SOTUV NARXI</th>
                  <th className="num">QIYMAT</th>
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
                        <small>{[x.manufacturer, x.barcode].filter(Boolean).join(' · ') || x.group || '—'}</small>
                      </td>
                      <td className="cell-strong">{x.branchName}</td>
                      <td className="num"><QtyCell quantity={x.quantity} unit={x.unit} /></td>
                      <td><StatusBadge tone={st.tone}>{st.label}</StatusBadge></td>
                      <td className="num">{money(x.costPrice)}</td>
                      <td className="num">{money(x.retailPrice)}</td>
                      <td className="num">{money(x.value)}</td>
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

    {product != null && <ProductCard id={product} onClose={() => setProduct(null)} />}
  </>;
}
