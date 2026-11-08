import { useMemo, useState } from 'react';
import { Boxes, PackageSearch, Warehouse } from 'lucide-react';
import { useGetWarehouseInsights, useListBranches, useListInventory } from '@workspace/api-client-react';
import type { InventoryItem } from '@workspace/api-client-react';
import {
  Chips, DataState, KpiStrip, PageHeading, Panel, SearchBox, StatusBadge, TableWrap,
  date, dateTime, money, num, qty, round2, stockStatus, unitLabel, type Filters,
} from '@/components/kit';
import { ProductCard } from '@/pages/stock';

function expiryBadge(value?: string | null, expiryDays?: number | null) {
  const days = expiryDays ?? (value ? Math.floor((new Date(value + 'T00:00:00').getTime() - Date.now()) / 86400000) : null);
  if (days == null) return null;
  if (days < 0) return <StatusBadge tone="bad">Muddati oʻtgan · {Math.abs(days)} kun oldin</StatusBadge>;
  if (days <= 90) return <StatusBadge tone="warn">{days} kun qoldi</StatusBadge>;
  return null;
}

function daysAgoLabel(days: number | null | undefined) {
  if (days == null) return 'Hech qachon sotilmagan';
  if (days === 0) return 'Bugun';
  if (days === 1) return '1 kun oldin';
  return `${days} kun oldin`;
}

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
        const d = new Date(i.expiryDate + 'T00:00:00').getTime() - now;
        return d >= 0 && d <= 90 * dayMs;
      }).length,
      expired: inventory.filter(i => i.quantity > 0 && i.expiryDate && new Date(i.expiryDate + 'T00:00:00').getTime() < now).length,
    };
  }, [inventory]);

  const rows = inventory.filter(i => {
    if (stockFilter === 'all') return true;
    if (stockFilter === 'in') return i.quantity > 0;
    if (stockFilter === 'zero') return i.quantity <= 0;
    if (!i.expiryDate || i.quantity <= 0) return false;
    const left = new Date(i.expiryDate + 'T00:00:00').getTime() - Date.now();
    if (stockFilter === 'expired') return left < 0;
    return left >= 0 && left <= 90 * dayMs;
  });

  const topSellers = insightsQ.data?.topSellers || [];
  const slowMovers = insightsQ.data?.slowMovers || [];
  const neverSold = slowMovers.filter(r => r.lastSoldAt == null).length;
  const expiredSlow = slowMovers.filter(r => r.expired).length;

  const emptyWarehouses = !branchesQ.isLoading && !warehouses.length;

  return <>
    <PageHeading
      eyebrow="OMBOR · СКЛАД"
      title="Ombor"
      subtitle="Markaziy ombordagi tovarlar, sotuv reytingi va sekin aylanadigan qoldiqlar"
    />
    <KpiStrip items={[
      { label: 'Ombordagi qiymat', value: stats.stockValue, icon: Boxes, hint: `${stats.positions} ta pozitsiya` },
      { label: 'Pozitsiyalar', value: stats.positions, count: true, icon: PackageSearch, hint: 'Qoldiq > 0' },
      { label: 'Muddati yaqin', value: stats.expiring, count: true, icon: Warehouse, tone: stats.expiring ? 'warn' : undefined, hint: '90 kungacha' },
      { label: 'Muddati oʻtgan', value: stats.expired, count: true, icon: PackageSearch, tone: stats.expired ? 'bad' : undefined },
    ]} />

    <div className="dash-grid lower">
      <Panel
        title="Eng koʻp sotiladiganlar"
        subtitle={`Tanlangan davr · ${topSellers.length} ta (toʻliq reyting)`}
      >
        <DataState
          loading={insightsQ.isLoading}
          error={insightsQ.isError}
          empty={!insightsQ.isLoading && !insightsQ.isError && !topSellers.length}
          retry={() => insightsQ.refetch()}
          emptyText="Bu davrda ombor tovarlaridan savdo topilmadi."
        />
        {!!topSellers.length && (
          <TableWrap>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>MAHSULOT</th>
                <th className="num">SOTILDI</th>
                <th className="num">SUMMA</th>
                <th className="num">OMBOR QOLDIQ</th>
                <th>YAROQLILIK</th>
              </tr>
            </thead>
            <tbody>
              {topSellers.map(r => (
                <tr key={r.productId} className="clickable" onClick={() => setProduct(r.productId)} data-testid={`row-top-seller-${r.productId}`}>
                  <td className="num cell-strong">{r.rank}</td>
                  <td><span className="table-main-link">{r.productName}</span></td>
                  <td className="num cell-strong">{qty(r.soldQty)}&nbsp;{unitLabel(r.unit)}</td>
                  <td className="num">{money(r.sales)}</td>
                  <td className="num">{qty(r.stockQty)}&nbsp;{unitLabel(r.unit)}</td>
                  <td>{date(r.expiryDate)} {expiryBadge(r.expiryDate)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel
        title="Kam / sotilmaydiganlar"
        subtitle={`${neverSold} ta umuman sotilmagan · ${expiredSlow} ta muddati oʻtgan`}
      >
        <DataState
          loading={insightsQ.isLoading}
          error={insightsQ.isError}
          empty={!insightsQ.isLoading && !insightsQ.isError && !slowMovers.length}
          retry={() => insightsQ.refetch()}
          emptyText="Omborda qoldiq yoʻq."
        />
        {!!slowMovers.length && (
          <TableWrap>
            <thead>
              <tr>
                <th>MAHSULOT</th>
                <th className="num">QOLDIQ</th>
                <th>OXIRGI SOTUV</th>
                <th className="num">NECHA KUN</th>
                <th className="num">DAVRDAGI SAVDO</th>
                <th>YAROQLILIK</th>
              </tr>
            </thead>
            <tbody>
              {slowMovers.map(r => (
                <tr key={r.productId} className="clickable" onClick={() => setProduct(r.productId)} data-testid={`row-slow-mover-${r.productId}`}>
                  <td>
                    <span className="table-main-link">{r.productName}</span>
                    {r.expired && <small className="negative">Muddati oʻtgan</small>}
                  </td>
                  <td className="num cell-strong">{qty(r.stockQty)}&nbsp;{unitLabel(r.unit)}</td>
                  <td>{r.lastSoldAt ? dateTime(r.lastSoldAt) : <StatusBadge tone="warn">Sotilmagan</StatusBadge>}</td>
                  <td className={`num cell-strong ${r.lastSoldAt == null || (r.daysSinceSale ?? 0) >= 30 ? 'warn-qty' : ''}`}>
                    {daysAgoLabel(r.daysSinceSale)}
                  </td>
                  <td className="num">{qty(r.soldQty)}&nbsp;{unitLabel(r.unit)}</td>
                  <td>{date(r.expiryDate)} {expiryBadge(r.expiryDate, r.expiryDays)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </div>

    <Panel
      title="Ombor tovarlari"
      subtitle={warehouses.length
        ? `${warehouses.length} ta ombor · jami ${inventory.length} ta qator`
        : 'Ombor filiali topilmadi'}
      action={<div className="toolbar">
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
      </div>}
    >
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
            emptyText="Omborda qoldiq topilmadi. Tovar «Kirim» orqali omborga qabul qilinadi."
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
                  const u = unitLabel(x.unit);
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
                      <td>{x.branchName}<small>Ombor</small></td>
                      <td className={`num cell-strong ${x.quantity <= 0 ? 'negative' : x.quantity < 1 ? 'warn-qty' : ''}`}>
                        {qty(x.quantity)}&nbsp;{u}
                        {x.quantity > 0 && x.quantity < 1 && <small>ochilgan quti</small>}
                      </td>
                      <td><StatusBadge tone={st.tone}>{st.label}</StatusBadge></td>
                      <td className="num">{money(x.costPrice)}</td>
                      <td className="num">{money(x.retailPrice)}</td>
                      <td className="num">{money(x.value)}</td>
                      <td>{date(x.expiryDate)} {expiryBadge(x.expiryDate)}</td>
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
