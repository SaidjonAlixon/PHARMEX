import { useMemo, useState } from 'react';
import { ArrowLeft, TrendingDown, TrendingUp } from 'lucide-react';
import { Link } from 'wouter';
import { useGetWarehouseInsights, useListBranches } from '@workspace/api-client-react';
import {
  DataState, PageHeading, Panel, StatusBadge, TableWrap, date, dateTime, money, type Filters,
} from '@/components/kit';
import { ProductCard } from '@/pages/stock';
import { ExpiryCell, QtyCell, daysAgoLabel, slowStatusLabel } from '@/pages/warehouse-shared';

type RankingView = 'top' | 'slow';

export function WarehouseRankingPage({ filters, view }: { filters: Filters; view: RankingView }) {
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
    : warehouses.length === 1 ? String(warehouses[0].id) : '';
  const activeWarehouse = warehouses.find(w => String(w.id) === String(activeWarehouseId));

  const insightsQ = useGetWarehouseInsights({
    branchId: activeWarehouseId ? Number(activeWarehouseId) : undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  });

  const topSellers = insightsQ.data?.topSellers || [];
  const slowMovers = insightsQ.data?.slowMovers || [];
  const neverSold = slowMovers.filter(r => r.lastSoldAt == null).length;
  const expiredSlow = slowMovers.filter(r => r.expired).length;

  const periodLabel = filters.dateFrom && filters.dateTo
    ? `${date(filters.dateFrom)} — ${date(filters.dateTo)}`
    : 'Barcha davr';

  const isTop = view === 'top';

  return <>
    <PageHeading
      eyebrow={isTop ? 'OMBOR · KOʻP SOTILADIGANLAR' : 'OMBOR · KAM / SOTILMAYDIGANLAR'}
      title={isTop ? 'Eng koʻp sotiladiganlar' : 'Kam va sotilmaydiganlar'}
      subtitle={`${activeWarehouse?.name || 'Barcha omborlar'} · davr: ${periodLabel}. Qatorni bosing — qachon va nechta sotilgani ochiladi.`}
      actions={
        <div className="warehouse-rank-actions">
          <Link href="/warehouse" className="button secondary" data-testid="link-back-warehouse">
            <ArrowLeft size={15} /> Omborga qaytish
          </Link>
          {isTop ? (
            <Link href="/warehouse/ranking/slow" className="button secondary" data-testid="link-to-slow-ranking">
              Kam / sotilmaganlar
            </Link>
          ) : (
            <Link href="/warehouse/ranking/top" className="button secondary" data-testid="link-to-top-ranking">
              Koʻp sotilganlar
            </Link>
          )}
        </div>
      }
    />

    {isTop ? (
      <Panel
        className="warehouse-full-panel"
        title="Eng koʻp sotiladiganlar — toʻliq roʻyxat"
        subtitle={`Tanlangan davrdagi barcha reyting · ${topSellers.length} ta mahsulot`}
        action={<span className="warehouse-panel-tag"><TrendingUp size={14} /> Reyting</span>}
      >
        <DataState
          loading={insightsQ.isLoading}
          error={insightsQ.isError}
          empty={!insightsQ.isLoading && !insightsQ.isError && !topSellers.length}
          retry={() => insightsQ.refetch()}
          emptyText="Bu davrda ombor tovarlaridan savdo topilmadi. Yuqoridan boshqa davr tanlang."
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
                  <td><span className="table-main-link">{r.productName}</span><small>Bosing — sotuv tarixi</small></td>
                  <td className="num"><QtyCell quantity={r.soldQty} unit={r.unit} /></td>
                  <td className="num">{money(r.sales)}</td>
                  <td className="num"><QtyCell quantity={r.stockQty} unit={r.unit} /></td>
                  <td><ExpiryCell value={r.expiryDate} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    ) : (
      <Panel
        className="warehouse-full-panel"
        title="Kam va sotilmaydiganlar — toʻliq roʻyxat"
        subtitle={`Oxirgi sotuv · bugundan necha kun · ${neverSold} ta umuman sotilmagan · ${expiredSlow} ta muddati oʻtgan`}
        action={<span className="warehouse-panel-tag warn"><TrendingDown size={14} /> Sekin aylanadi</span>}
      >
        <DataState
          loading={insightsQ.isLoading}
          error={insightsQ.isError}
          empty={!insightsQ.isLoading && !insightsQ.isError && !slowMovers.length}
          retry={() => insightsQ.refetch()}
          emptyText="Omborda koʻrsatiladigan qoldiq yoʻq."
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
                <th>HOLAT</th>
                <th>YAROQLILIK</th>
              </tr>
            </thead>
            <tbody>
              {slowMovers.map(r => (
                <tr key={r.productId} className="clickable" onClick={() => setProduct(r.productId)} data-testid={`row-slow-mover-${r.productId}`}>
                  <td>
                    <span className="table-main-link">{r.productName}</span>
                    <small>Bosing — sotuv tarixi</small>
                  </td>
                  <td className="num"><QtyCell quantity={r.stockQty} unit={r.unit} /></td>
                  <td>{r.lastSoldAt ? <span className="last-sale">{dateTime(r.lastSoldAt)}</span> : <StatusBadge tone="warn">Sotilmagan</StatusBadge>}</td>
                  <td className={`num cell-strong ${r.lastSoldAt == null || (r.daysSinceSale ?? 0) >= 30 ? 'warn-qty' : ''}`}>
                    {daysAgoLabel(r.daysSinceSale)}
                  </td>
                  <td className="num"><QtyCell quantity={r.soldQty} unit={r.unit} /></td>
                  <td><span className={r.expired ? 'negative' : ''}>{slowStatusLabel(r)}</span></td>
                  <td><ExpiryCell value={r.expiryDate} days={r.expiryDays} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
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
