import { useMemo, useState } from 'react';
import { Boxes, PackageSearch, Warehouse } from 'lucide-react';
import { useListBranches, useListInventory } from '@workspace/api-client-react';
import type { InventoryItem } from '@workspace/api-client-react';
import {
  Chips, DataState, KpiStrip, PageHeading, Panel, SearchBox, StatusBadge, TableWrap,
  date, money, num, qty, round2, type Filters,
} from '@/components/kit';
import { ProductCard } from '@/pages/stock';

function expiryBadge(value?: string | null) {
  if (!value) return null;
  const days = Math.floor((new Date(value).getTime() - Date.now()) / 86400000);
  if (days < 0) return <StatusBadge tone="bad">Muddati oʻtgan</StatusBadge>;
  if (days <= 90) return <StatusBadge tone="warn">{days} kun qoldi</StatusBadge>;
  return null;
}

export function WarehousePage({ filters }: { filters: Filters }) {
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'zero' | 'expiring'>('in');
  const [warehouseId, setWarehouseId] = useState('');
  const [product, setProduct] = useState<number | null>(null);

  const branchesQ = useListBranches();
  const warehouses = useMemo(
    () => (branchesQ.data || []).filter(b => b.kind === 'warehouse'),
    [branchesQ.data],
  );
  const warehouseIds = useMemo(() => new Set(warehouses.map(w => w.id)), [warehouses]);

  // Global branch filter: if a warehouse is selected there, honour it; pharmacies are ignored here.
  const filterIsWarehouse = filters.branchId && warehouseIds.has(Number(filters.branchId));
  const activeWarehouseId = filterIsWarehouse
    ? filters.branchId
    : warehouseId || (warehouses.length === 1 ? String(warehouses[0].id) : '');

  const invQ = useListInventory({
    branchId: activeWarehouseId ? Number(activeWarehouseId) : undefined,
    search: search || undefined,
  });

  const inventory = useMemo(() => {
    const rows = invQ.data || [];
    if (activeWarehouseId) return rows;
    return rows.filter(r => warehouseIds.has(r.branchId));
  }, [invQ.data, activeWarehouseId, warehouseIds]);

  const stats = useMemo(() => ({
    stockValue: round2(inventory.reduce((s, i) => s + num(i.value), 0)),
    positions: inventory.filter(i => i.quantity > 0).length,
    zero: inventory.filter(i => i.quantity <= 0).length,
    expiring: inventory.filter(i => i.quantity > 0 && i.expiryDate && new Date(i.expiryDate).getTime() - Date.now() <= 90 * 86400000).length,
    qtyTotal: round2(inventory.reduce((s, i) => s + Math.max(0, i.quantity), 0)),
  }), [inventory]);

  const rows = inventory.filter(i =>
    stockFilter === 'all' ? true
      : stockFilter === 'in' ? i.quantity > 0
        : stockFilter === 'zero' ? i.quantity <= 0
          : i.quantity > 0 && !!i.expiryDate && new Date(i.expiryDate).getTime() - Date.now() <= 90 * 86400000,
  );

  const emptyWarehouses = !branchesQ.isLoading && !warehouses.length;

  return <>
    <PageHeading
      eyebrow="OMBOR · СКЛАД"
      title="Ombor"
      subtitle="Markaziy ombordagi barcha tovarlar roʻyxati — qoldiq, tannarx va yaroqlilik"
    />
    <KpiStrip items={[
      { label: 'Ombordagi qiymat', value: stats.stockValue, icon: Boxes, hint: `${stats.positions} ta pozitsiya` },
      { label: 'Pozitsiyalar', value: stats.positions, count: true, icon: PackageSearch, hint: 'Qoldiq > 0' },
      { label: 'Muddati yaqin', value: stats.expiring, count: true, icon: Warehouse, tone: stats.expiring ? 'warn' : undefined, hint: '30–90 kun ichida' },
      { label: 'Tugagan', value: stats.zero, count: true, icon: PackageSearch, tone: stats.zero ? 'bad' : undefined },
    ]} />

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
                  <th className="num">TANNARX</th>
                  <th className="num">SOTUV NARXI</th>
                  <th className="num">QIYMAT</th>
                  <th className="num">USTAMA</th>
                  <th>YAROQLILIK</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x: InventoryItem) => (
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
                    <td className={`num cell-strong ${x.quantity <= 0 ? 'negative' : ''}`}>{qty(x.quantity)}</td>
                    <td className="num">{money(x.costPrice)}</td>
                    <td className="num">{money(x.retailPrice)}</td>
                    <td className="num">{money(x.value)}</td>
                    <td className="num">
                      {x.costPrice && num(x.costPrice) > 0
                        ? `${Math.round((num(x.retailPrice) / num(x.costPrice) - 1) * 1000) / 10}%`
                        : '—'}
                    </td>
                    <td>{date(x.expiryDate)} {expiryBadge(x.expiryDate)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </>
      )}
    </Panel>

    {product != null && <ProductCard id={product} onClose={() => setProduct(null)} />}
  </>;
}
