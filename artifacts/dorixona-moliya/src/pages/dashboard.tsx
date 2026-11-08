import { useMemo, useState } from 'react';
import {
  Activity, AlertCircle, ArrowDownLeft, ArrowRight, ArrowUpRight, Boxes, CalendarClock,
  Check, ClipboardList, Clock3, Download, PackageSearch, ShieldCheck, Wallet,
} from 'lucide-react';
import {
  useGetDashboard, useListBranches, useListInventory,
} from '@workspace/api-client-react';
import type { Dashboard } from '@workspace/api-client-react';
import { Link } from 'wouter';
import {
  DataMode, DataState, Drawer, Metric, PageHeading, Panel, TableWrap,
  date, dateTime, money, type Filters,
} from '@/components/kit';
import { ExpiryCell, QtyCell, expiryDay } from '@/pages/warehouse-shared';
import {
  buildExpiryLists, exportDashboardExcel, type ExpiryDashItem,
} from '@/pages/dashboard-export';
import { ProductCard } from '@/pages/stock';

const TEASER = 5;

function ChartLine({ data, valueKey, secondaryKey }: { data: Dashboard['salesTrend']; valueKey: 'sales'; secondaryKey?: 'cost' }) {
  if (!data?.length) return <div className="chart-empty"><PackageSearch size={21} /> Davr boʻyicha trend yoʻq</div>;
  const nums = data.map(d => Number(d[valueKey]) || 0).concat(secondaryKey ? data.map(d => Number(d[secondaryKey]) || 0) : []);
  const max = Math.max(...nums, 1);
  const points = data.map((d, i) => `${data.length === 1 ? 50 : i / (data.length - 1) * 100},${100 - Number(d[valueKey]) / max * 84}`).join(' ');
  const points2 = secondaryKey ? data.map((d, i) => `${data.length === 1 ? 50 : i / (data.length - 1) * 100},${100 - Number(d[secondaryKey!]) / max * 84}`).join(' ') : '';
  return (
    <div className="chart-area">
      <div className="chart-labels"><span>{money(max)}</span><span>{money(max * .5)}</span><span>0</span></div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Savdo dinamikasi">
        <defs>
          <linearGradient id="px-line" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#0fb3c7" /><stop offset="1" stopColor="#2fcf5a" /></linearGradient>
          <linearGradient id="px-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#0fb3c7" stopOpacity=".22" /><stop offset="1" stopColor="#2fcf5a" stopOpacity="0" /></linearGradient>
        </defs>
        {data.length > 1 && <polygon points={`0,100 ${points} 100,100`} fill="url(#px-area)" />}
        <polyline points={points} fill="none" stroke="url(#px-line)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {secondaryKey && <polyline points={points2} fill="none" stroke="#1f5fd0" strokeWidth="1.8" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="chart-xlabels">{data.map((p, i) => <span key={`${p.label}-${i}`}>{p.label}</span>)}</div>
    </div>
  );
}

function ExpiryTeaserRow({
  item, tone, onOpen,
}: {
  item: ExpiryDashItem;
  tone: 'warn' | 'critical';
  onOpen: () => void;
}) {
  const daysLabel = item.days < 0
    ? `Muddati oʻtgan · ${Math.abs(item.days)} kun`
    : item.days === 0
      ? 'Muddati bugun tugaydi'
      : `Muddati ${item.days} kun qoldi`;
  return (
    <button type="button" className="alert-row dash-expiry-row" onClick={onOpen} data-testid={`dash-expiry-${item.productId}-${item.branchId}`}>
      <span className={`alert-icon ${tone}`}><AlertCircle size={17} /></span>
      <div>
        <b>{item.productName}</b>
        <p>{item.branchName} · qoldiq {item.quantity} · {money(item.value)}</p>
        <small>{daysLabel} · {expiryDay(item.expiryDate) ? date(expiryDay(item.expiryDate)) : '—'}</small>
      </div>
      <ArrowRight size={15} />
    </button>
  );
}

function ExpiryListPanel({
  title, subtitle, items, tone, emptyText, testId, onDetail, onOpenItem,
}: {
  title: string;
  subtitle: string;
  items: ExpiryDashItem[];
  tone: 'warn' | 'critical';
  emptyText: string;
  testId: string;
  onDetail: () => void;
  onOpenItem: (item: ExpiryDashItem) => void;
}) {
  const teaser = items.slice(0, TEASER);
  return (
    <Panel title={title} subtitle={subtitle}>
      {teaser.length ? (
        <div className="alert-list" data-testid={testId}>
          {teaser.map(item => (
            <ExpiryTeaserRow
              key={`${item.productId}-${item.branchId}-${item.expiryDate || ''}`}
              item={item}
              tone={tone}
              onOpen={() => onOpenItem(item)}
            />
          ))}
        </div>
      ) : (
        <div className="inline-empty"><Check size={17} /> {emptyText}</div>
      )}
      {items.length > 0 && (
        <button
          type="button"
          className={`warehouse-split-more ${tone === 'critical' ? 'is-bad' : 'is-warn'}`}
          onClick={onDetail}
          data-testid={`${testId}-more`}
        >
          Batafsil · {items.length} ta
          <ArrowRight size={14} />
        </button>
      )}
    </Panel>
  );
}

export function DashboardPage({ filters }: { filters: Filters }) {
  const params = {
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    branchId: filters.branchId ? Number(filters.branchId) : undefined,
  };
  const q = useGetDashboard(params);
  const invQ = useListInventory({
    branchId: filters.branchId ? Number(filters.branchId) : undefined,
  });
  const branchesQ = useListBranches();
  const d = q.data;

  const expiry = useMemo(() => buildExpiryLists(invQ.data || []), [invQ.data]);
  const [listKind, setListKind] = useState<'expiring' | 'expired' | null>(null);
  const [productId, setProductId] = useState<number | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);

  const periodLabel = filters.dateFrom
    ? `${date(filters.dateFrom)} — ${date(filters.dateTo)}`
    : 'barcha davr';
  const branchLabel = filters.branchId
    ? (branchesQ.data || []).find(b => String(b.id) === filters.branchId)?.name || `Filial #${filters.branchId}`
    : 'Barcha filiallar';

  const detailItems = listKind === 'expiring' ? expiry.expiring : listKind === 'expired' ? expiry.expired : [];
  const detailTitle = listKind === 'expiring'
    ? 'Muddati yaqin tovarlar'
    : listKind === 'expired'
      ? 'Muddat eng koʻp oʻtgan tovarlar'
      : '';

  const downloadExcel = () => {
    if (!d) return;
    setExcelBusy(true);
    void exportDashboardExcel({
      dashboard: d,
      periodLabel,
      branchLabel,
      expiring: expiry.expiring,
      expired: expiry.expired,
    })
      .catch(() => {})
      .finally(() => setExcelBusy(false));
  };

  return (
    <>
      <DataMode mode={d?.mode} />
      <PageHeading
        eyebrow="UMUMIY KOʻRINISH"
        title="Bosh dashboard"
        subtitle={`Moliyaviy holat • ${periodLabel}${filters.branchId ? ` · ${branchLabel}` : ''}`}
        actions={(
          <div className="heading-button-group">
            <button
              type="button"
              className="button secondary"
              disabled={!d || d.mode === 'empty' || excelBusy}
              onClick={downloadExcel}
              data-testid="button-dashboard-excel"
            >
              <Download size={15} /> Excel yuklab olish
            </button>
            <span className="updated-stamp"><Clock3 size={14} /> Yangilandi: {d ? dateTime(d.updatedAt) : '—'}</span>
          </div>
        )}
      />
      <DataState
        loading={q.isLoading}
        error={q.isError}
        empty={!q.isLoading && !q.isError && (!d || d.mode === 'empty')}
        retry={() => q.refetch()}
      />
      {d && d.mode !== 'empty' && (
        <>
          <div className="metric-grid">
            <Metric label="Sotuv hajmi" value={d.totals.sales} trend={d.completeness === 'complete' ? 'Hisobot toʻliq' : undefined} icon={ArrowUpRight} />
            <Metric label="Yalpi foyda" value={d.totals.grossProfit} icon={Activity} />
            <Metric label="Xarajatlar" value={d.totals.expenses} icon={ClipboardList} />
            <Metric label="Pul qoldigʻi" value={d.totals.cashBalance} icon={Wallet} />
            <Metric label="Tovar zaxirasi" value={d.totals.inventoryValue} icon={Boxes} />
            <Metric label="Muddati oʻtgan qarz" value={d.totals.overdueDebt} icon={Clock3} />
          </div>

          <div className="dash-grid">
            <Panel
              title="Savdo va tannarx dinamikasi"
              subtitle="Davr boʻyicha soʻmda"
              action={<span className="chart-legend"><i className="legend-green" /> Savdo <i className="legend-amber" /> Tannarx</span>}
            >
              <ChartLine data={d.salesTrend} valueKey="sales" secondaryKey="cost" />
            </Panel>
            <ExpiryListPanel
              title="Eʼtibor talab qiladi"
              subtitle={`Muddati yaqin · ${expiry.expiring.length} ta${filters.branchId ? ` · ${branchLabel}` : ''}`}
              items={expiry.expiring}
              tone="warn"
              emptyText="Muddati yaqin tovar yoʻq"
              testId="dash-expiring"
              onDetail={() => setListKind('expiring')}
              onOpenItem={item => setProductId(item.productId)}
            />
          </div>

          <div className="dash-grid lower">
            <Panel title="Filiallar taqqoslanishi" subtitle="Savdo, foyda va pul holati">
              <TableWrap>
                <thead>
                  <tr>
                    <th>FILIAL</th><th>SAVDO</th><th>YALPI FOYDA</th><th>SOF FOYDA</th><th>PUL QOLDIGʻI</th>
                  </tr>
                </thead>
                <tbody>
                  {d.branchComparison.map(b => (
                    <tr key={b.id}>
                      <td>
                        <Link href={`/branches/${b.id}`} className="table-main-link" data-testid={`link-branch-${b.id}`}>
                          {b.name}<ArrowRight size={13} />
                        </Link>
                        <small>{date(b.updatedAt)}</small>
                      </td>
                      <td>{money(b.sales)}</td>
                      <td>{money(b.grossProfit)}</td>
                      <td className={b.netProfit == null ? 'missing' : 'positive'}>{money(b.netProfit)}</td>
                      <td>{money(b.cashBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              {!d.branchComparison.length && <div className="inline-empty">Filial taqqoslash maʼlumoti yoʻq</div>}
            </Panel>
            <ExpiryListPanel
              title="Muddat eng koʻp oʻtgan tovarlar"
              subtitle={`${expiry.expired.length} ta · tannarx ${money(expiry.expiredValue)}`}
              items={expiry.expired}
              tone="critical"
              emptyText="Muddati oʻtgan tovar yoʻq"
              testId="dash-expired"
              onDetail={() => setListKind('expired')}
              onOpenItem={item => setProductId(item.productId)}
            />
          </div>

          <div className="dash-grid lower">
            <Panel title="Eng koʻp sotilgan mahsulotlar" subtitle="Davr ichida sotilgan miqdor">
              <TableWrap>
                <thead>
                  <tr><th>MAHSULOT</th><th>MIQDOR</th><th>SAVDO</th><th>YALPI FOYDA</th></tr>
                </thead>
                <tbody>
                  {d.topProducts.map(p => (
                    <tr key={p.productId}>
                      <td>
                        <Link className="table-main-link" href={`/stock/product/${p.productId}`} data-testid={`link-product-${p.productId}`}>
                          {p.name}<ArrowRight size={13} />
                        </Link>
                      </td>
                      <td>{p.quantity}</td>
                      <td>{money(p.sales)}</td>
                      <td className={p.grossProfit == null ? 'missing' : 'positive'}>{money(p.grossProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              {!d.topProducts.length && <div className="inline-empty">Mahsulot maʼlumoti yoʻq</div>}
            </Panel>
            <Panel title="Pul oqimi" subtitle="Tushum va chiqimlar">
              <div className="flow-list">
                {d.moneyFlow.map((p, i) => (
                  <div className="flow-row" key={`${p.label}-${i}`}>
                    <span>{p.label}</span>
                    <span className="positive"><ArrowDownLeft size={14} /> {money(p.inflow)}</span>
                    <span className="negative"><ArrowUpRight size={14} /> {money(p.outflow)}</span>
                  </div>
                ))}
              </div>
              {!d.moneyFlow.length && <div className="inline-empty">Pul oqimi maʼlumoti yoʻq</div>}
            </Panel>
          </div>

          <div className="completeness-note" data-testid="status-completeness">
            <ShieldCheck size={15} />
            <span>
              {d.completeness === 'complete'
                ? 'Hisobot toʻliq'
                : d.completeness === 'preliminary'
                  ? 'Dastlabki natija — ayrim manbalar hali toʻliq emas'
                  : 'Natija chiqarish uchun maʼlumot yetarli emas'}
            </span>
            <span className="source-note">Manba: {d.mode === 'demo' ? 'sinov maʼlumotlari' : 'jonli maʼlumotlar'}</span>
          </div>
        </>
      )}

      {listKind && (
        <Drawer
          eyebrow={branchLabel}
          title={detailTitle}
          subtitle={`${detailItems.length} ta · filtr: ${periodLabel}`}
          onClose={() => setListKind(null)}
          actions={(
            <button type="button" className="button secondary" disabled={!d || excelBusy} onClick={downloadExcel}>
              <Download size={15} /> Excel
            </button>
          )}
        >
          {!detailItems.length ? (
            <div className="inline-empty"><CalendarClock size={18} /> Roʻyxat boʻsh</div>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th>#</th>
                  <th>MAHSULOT</th>
                  <th>OMBOR</th>
                  <th>QOLDIQ</th>
                  <th>TANNARX</th>
                  <th>YAROQLILIK</th>
                </tr>
              </thead>
              <tbody>
                {detailItems.map((item, idx) => (
                  <tr key={`${item.productId}-${item.branchId}-${item.expiryDate || ''}-${idx}`}>
                    <td className="warehouse-row-num">{idx + 1}</td>
                    <td>
                      <button type="button" className="table-main-link plain" onClick={() => setProductId(item.productId)}>
                        {item.productName}<ArrowRight size={13} />
                      </button>
                    </td>
                    <td>{item.branchName}</td>
                    <td><QtyCell quantity={item.quantity} unit={item.unit} /></td>
                    <td>{money(item.value)}</td>
                    <td><ExpiryCell value={item.expiryDate} days={item.days} /></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Drawer>
      )}

      {productId != null && (
        <ProductCard
          id={productId}
          onClose={() => setProductId(null)}
          dateFrom={filters.dateFrom || undefined}
          dateTo={filters.dateTo || undefined}
        />
      )}
    </>
  );
}
