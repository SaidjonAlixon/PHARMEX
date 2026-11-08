import { useMemo, useState, type FormEvent } from 'react';
import {
  Building2, Download, FileBarChart2, FileSpreadsheet, FileText, Layers,
} from 'lucide-react';
import {
  useGetReport, getGetReportQueryKey, useListBranches,
} from '@workspace/api-client-react';
import {
  BranchSelect, DataMode, DataState, PageHeading, Panel, StatusBadge, TableWrap,
  date, money, monthStart, today, type Filters,
} from '@/components/kit';
import { SelectMenu, type MenuOption } from '@/components/select-menu';
import { exportReportExcel, exportReportPdf } from '@/pages/reports-export';

type ReportKind = 'sales' | 'inventory' | 'expenses' | 'debts' | 'profit' | 'cashflow';

const LABELS: Record<ReportKind, string> = {
  sales: 'Savdo hisoboti',
  inventory: 'Tovar qoldiqlari',
  expenses: 'Xarajatlar',
  debts: 'Qarzlar',
  profit: 'Foyda va zarar',
  cashflow: 'Pul oqimi',
};

const HINTS: Record<ReportKind, string> = {
  sales: 'Cheklar, tushum, tannarx va yalpi foyda',
  inventory: 'Filiallar kesimida ombor qoldiqlari',
  expenses: 'Oylik, arenda, kommunal va boshqa rasxodlar',
  debts: 'Debitor / kreditor qoldiqlari',
  profit: 'Sof sotuv − tannarx − xarajatlar = sof foyda',
  cashflow: 'Kassa va bank kirim-chiqimlari',
};

function displayCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') {
    if (value instanceof Date) return date(value.toISOString());
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    const iso = /^\d{4}-\d{2}-\d{2}(T|$)/.test(value);
    if (iso) return date(value);
  }
  return String(value);
}

function periodLabel(from: string, to: string) {
  return `${date(from)} — ${date(to)}`;
}

export function ReportsPage({ filters }: { filters: Filters }) {
  const branches = useListBranches().data || [];
  const [kind, setKind] = useState<ReportKind>('sales');
  const [dates, setDates] = useState({
    from: filters.dateFrom || monthStart,
    to: filters.dateTo || today,
  });
  const [branchId, setBranchId] = useState(filters.branchId || '');
  const [hasRun, setHasRun] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);
  const [submitted, setSubmitted] = useState({
    kind: 'sales' as ReportKind,
    from: filters.dateFrom || monthStart,
    to: filters.dateTo || today,
    branchId: filters.branchId || '',
  });

  const params = {
    reportType: submitted.kind,
    dateFrom: submitted.from || undefined,
    dateTo: submitted.to || undefined,
    branchId: submitted.branchId ? Number(submitted.branchId) : undefined,
  };
  const q = useGetReport(params, {
    query: { queryKey: getGetReportQueryKey(params), enabled: hasRun },
  });

  const report = q.data;
  const branchName = useMemo(() => {
    if (!submitted.branchId) return 'Barcha filiallar';
    const b = branches.find(x => String(x.id) === submitted.branchId);
    return b ? `${b.name}${b.kind === 'warehouse' ? ' · Ombor' : ' · Dorixona'}` : `Filial #${submitted.branchId}`;
  }, [branches, submitted.branchId]);

  const typeOptions: MenuOption[] = useMemo(() => ([
    { value: 'sales', label: LABELS.sales, hint: HINTS.sales, icon: FileBarChart2, color: '#0fb3c7' },
    { value: 'profit', label: LABELS.profit, hint: HINTS.profit, icon: Layers, color: '#16a34a' },
    { value: 'expenses', label: LABELS.expenses, hint: HINTS.expenses, icon: FileText, color: '#e48a0c' },
    { value: 'inventory', label: LABELS.inventory, hint: HINTS.inventory, icon: Building2, color: '#2563eb' },
    { value: 'cashflow', label: LABELS.cashflow, hint: HINTS.cashflow, icon: Download, color: '#7c3aed' },
    { value: 'debts', label: LABELS.debts, hint: HINTS.debts, icon: FileSpreadsheet, color: '#dc2626' },
  ]), []);

  const run = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted({ kind, from: dates.from, to: dates.to, branchId });
    setHasRun(true);
  };

  const doExport = async (fmt: 'pdf' | 'xlsx') => {
    if (!report || report.mode === 'empty') return;
    setExporting(fmt);
    try {
      const opts = {
        report,
        title: LABELS[submitted.kind],
        periodLabel: periodLabel(submitted.from, submitted.to),
        branchLabel: branchName,
      };
      if (fmt === 'pdf') await exportReportPdf(opts);
      else await exportReportExcel(opts);
    } finally {
      setExporting(null);
    }
  };

  const canExport = !!report && report.mode !== 'empty' && report.rows.length > 0;

  return (
    <div className="page-reports">
      <PageHeading
        eyebrow="HISOBOTLAR · ОТЧЁТЫ"
        title="Hisobotlar"
        subtitle="Filial (barchasi yoki alohida), davr va turini tanlang · toʻliq jadval · PDF / Excel eksport"
      />

      <Panel
        title="Hisobot sozlamalari"
        subtitle="Tanlangan filial boʻyicha aniq hisob · boʻsh qoldirilsa barcha filiallar"
      >
        <form className="report-form" onSubmit={run}>
          <div className="report-type-field">
            <span>Hisobot turi</span>
            <SelectMenu
              ariaLabel="Hisobot turi"
              value={kind}
              onChange={v => setKind(v as ReportKind)}
              options={typeOptions}
              testId="select-report-type"
            />
          </div>
          <label>
            Boshlanish sanasi
            <input
              type="date"
              value={dates.from}
              onChange={e => setDates({ ...dates, from: e.target.value })}
              data-testid="input-report-from"
            />
          </label>
          <label>
            Tugash sanasi
            <input
              type="date"
              value={dates.to}
              onChange={e => setDates({ ...dates, to: e.target.value })}
              data-testid="input-report-to"
            />
          </label>
          <BranchSelect
            value={branchId}
            onChange={setBranchId}
            label="Filial"
            required={false}
            allowEmpty
            emptyLabel="Barcha filiallar"
          />
          <button className="button primary" type="submit" data-testid="button-run-report">
            <FileBarChart2 size={15} /> Hisobotni koʻrsatish
          </button>
        </form>
      </Panel>

      <DataMode mode={report?.mode} />

      <Panel
        title={LABELS[submitted.kind]}
        subtitle={
          hasRun
            ? `${branchName} · ${periodLabel(submitted.from, submitted.to)}${report ? ` · ${report.rows.length} qator` : ''}`
            : 'Hisobot natijasi'
        }
        action={hasRun && canExport ? (
          <div className="toolbar report-export-actions">
            <button
              type="button"
              className="button secondary small"
              disabled={!!exporting}
              onClick={() => void doExport('pdf')}
              data-testid="button-export-report-pdf"
            >
              <FileText size={14} /> {exporting === 'pdf' ? 'PDF…' : 'PDF yuklab olish'}
            </button>
            <button
              type="button"
              className="button secondary small"
              disabled={!!exporting}
              onClick={() => void doExport('xlsx')}
              data-testid="button-export-report-excel"
            >
              <FileSpreadsheet size={14} /> {exporting === 'xlsx' ? 'Excel…' : 'Excel yuklab olish'}
            </button>
          </div>
        ) : undefined}
      >
        {!hasRun && (
          <div className="report-prompt">
            <FileBarChart2 size={22} />
            <b>Hisobot turini tanlang</b>
            <span>Filialni (yoki «Barcha filiallar»), davrni belgilang va «Hisobotni koʻrsatish» tugmasini bosing.</span>
          </div>
        )}
        {q.isFetching && <DataState loading error={false} empty={false} retry={() => q.refetch()} />}
        {q.isError && <DataState loading={false} error empty={false} retry={() => q.refetch()} />}
        {report?.mode === 'empty' && (
          <DataState loading={false} error={false} empty retry={() => q.refetch()} emptyText="Tanlangan filtrlar boʻyicha maʼlumot topilmadi." />
        )}
        {report && report.mode !== 'empty' && (
          <>
            <div className="report-toolbar">
              <div>
                <b>Jami:</b> {money(report.total)}
                <StatusBadge tone={report.mode === 'demo' ? 'warn' : 'good'}>
                  {report.mode === 'demo' ? 'Sinov rejimi' : 'Jonli maʼlumot'}
                </StatusBadge>
                <span className="report-meta">{branchName}</span>
              </div>
              <span className="updated-stamp">Yangilandi: {date(report.updatedAt)}</span>
            </div>
            {report.rows.length ? (
              <TableWrap>
                <thead>
                  <tr>{report.columns.map(c => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {report.rows.map((row, i) => (
                    <tr key={i} data-testid={`row-report-${i}`}>
                      {report.columns.map(c => <td key={c}>{displayCell(row[c])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : (
              <div className="inline-empty">Natija qatorlari topilmadi. Boʻsh natija nolga teng emas.</div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
