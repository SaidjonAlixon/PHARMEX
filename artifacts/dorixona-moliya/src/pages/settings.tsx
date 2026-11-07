import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  Activity, AlertCircle, Boxes, Building2, Check, FileText, PackageSearch, Receipt, RefreshCw, Truck, Users,
} from 'lucide-react';
import { useGetFomStatus, getGetFomStatusQueryKey, useTestFomConnection, useSyncFom } from '@workspace/api-client-react';
import type { FomReportState } from '@workspace/api-client-react';
import {
  DataState, KpiStrip, PageHeading, Panel, StatusBadge, addDaysTo, apiErrorMessage, clockTime, dateTime, todayDay,
} from '@/components/kit';
import { useAccess } from '@/lib/access';
import { toast } from '@/hooks/use-toast';

const syncStatusText: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  success: { label: 'Muvaffaqiyatli', tone: 'good' },
  error: { label: 'Xatolik', tone: 'bad' },
  running: { label: 'Jarayonda', tone: 'info' },
  waiting: { label: 'Kutilmoqda', tone: 'warn' },
  not_started: { label: 'Boshlanmagan', tone: 'neutral' },
};

function isoDay(offsetDays = 0) {
  return addDaysTo(todayDay(), offsetDays);
}

/**
 * Topbar indicator and refresh button. “Yangilash” pulls new and edited documents from the
 * pharmacy database now (admins / finance) and reloads every page's data; the global filter stays.
 */
export function FomLive() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  const sync = useSyncFom();
  // Time of the click while a refresh is pending; done once a run that ended after it is reported.
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const asked = askedAt != null;
  const q = useGetFomStatus({ query: { queryKey: getGetFomStatusQueryKey(), refetchInterval: query => (asked ? 1_000 : query.state.data?.running ? 3_000 : 15_000) } });
  const seen = useRef<string | undefined>(undefined);
  const lastDone = useRef<string | null>(null);
  const [, setTick] = useState(0);
  const s = q.data;
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!s) return;
    // A finished run (success or error) changes the key; reload every page's data then.
    const key = s.running ? seen.current : `${s.lastSyncAt}|${s.lastSyncStatus}|${s.site.lastAt}`;
    if (seen.current !== undefined && key !== seen.current) void qc.invalidateQueries();
    seen.current = key;
    // The server reports `running` until the run asked for (queued behind an auto run if need be) ends.
    if (askedAt != null && !s.running && s.lastSyncAt && new Date(s.lastSyncAt).getTime() >= askedAt - 1_000) {
      setAskedAt(null);
      void qc.invalidateQueries();
      toast({
        title: s.lastSyncStatus === 'error' ? 'Yangilashda xatolik' : `Yangilandi: ${clockTime(s.lastSyncAt)}`,
        description: s.lastMessage ?? undefined,
        variant: s.lastSyncStatus === 'error' ? 'destructive' : undefined,
      });
    }
  }, [s, qc, askedAt]);
  useEffect(() => {
    if (askedAt == null) return;
    // Never leave the button spinning if the server went away mid-run.
    const timer = setTimeout(() => setAskedAt(null), 3 * 60_000);
    return () => clearTimeout(timer);
  }, [askedAt]);
  // While a run is in progress `lastSyncAt` is its start; keep showing the last finished run.
  if (s && !s.running && s.lastSyncAt) lastDone.current = s.lastSyncAt;
  if (!s || (!s.configured && !s.site.configured)) return null;
  const latest = [lastDone.current, s.site.lastAt].filter(Boolean).sort().pop() ?? null;
  const sitePushing = !!s.site.lastAt && Date.now() - new Date(s.site.lastAt).getTime() < 30 * 60_000;
  const live = s.connected || sitePushing;
  // Auto sync runs every few seconds; only a long (initial / backfill) run shows its percentage.
  const longRun = s.running && (!s.lastSyncAt || Date.now() - new Date(s.lastSyncAt).getTime() > 2 * 60_000);
  const pct = longRun ? /(\d+)%\s*$/.exec(s.lastMessage ?? '')?.[1] : undefined;
  const tone = longRun ? 'running' : live ? 'live' : 'down';
  const busy = asked || sync.isPending || longRun;
  const refresh = () => {
    if (!canEdit) {
      // Viewers cannot start a pull; reload what the server already has.
      void qc.invalidateQueries();
      toast({ title: 'Maʼlumotlar qayta yuklandi', description: latest ? `Apteka bazasidan oxirgi yangilanish: ${dateTime(latest)}` : undefined });
      return;
    }
    setAskedAt(Date.now());
    sync.mutate({ data: {} }, {
      onSuccess: result => {
        if (result.status === 'error') { setAskedAt(null); toast({ title: 'Yangilab boʻlmadi', description: result.message, variant: 'destructive' }); }
        void qc.invalidateQueries({ queryKey: getGetFomStatusQueryKey() });
      },
      onError: error => { setAskedAt(null); toast({ title: 'Yangilab boʻlmadi', description: apiErrorMessage(error), variant: 'destructive' }); },
    });
  };
  return <div className="fom-refresh" data-testid="fom-refresh">
    <Link href="/settings" className={`fom-live ${tone}`} title={s.lastMessage ?? 'FOM integratsiyasi'} data-testid="status-fom-live">
      <span className="dot" /><b>FOM</b><small>{longRun ? (pct ? `yuklanmoqda ${pct}%` : 'yangilanmoqda…') : !live ? 'aloqa yoʻq' : latest ? `Yangilandi ${clockTime(latest)}` : 'yangilanmoqda…'}</small>
    </Link>
    <button type="button" className="fom-refresh-button" onClick={refresh} disabled={busy} title={latest ? `Oxirgi yangilanish: ${dateTime(latest)} (Toshkent vaqti). Bosing — apteka bazasidagi yangi maʼlumotlar hozir tortiladi.` : 'Yangilash'} data-testid="button-refresh-data">
      <RefreshCw size={14} className={busy ? 'spin' : ''} /><span>{busy ? 'Yangilanmoqda' : 'Yangilash'}</span>
    </button>
  </div>;
}

function ReportStatus({ report, running }: { report: FomReportState; running: boolean }) {
  if (report.error) return <StatusBadge tone="bad">Xatolik</StatusBadge>;
  if (report.warning) return <StatusBadge tone="warn">Qisman</StatusBadge>;
  if (report.imported == null) return running ? <StatusBadge tone="info">Navbatda</StatusBadge> : <StatusBadge>Yuklanmagan</StatusBadge>;
  return <StatusBadge tone="good">Yuklandi</StatusBadge>;
}

export function SettingsPage() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  const q = useGetFomStatus({ query: { queryKey: getGetFomStatusQueryKey(), refetchInterval: query => (query.state.data?.running ? 1500 : false) } });
  const test = useTestFomConnection();
  const sync = useSyncFom();
  const [range, setRange] = useState({ from: isoDay(-30), to: isoDay() });
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const wasRunning = useRef(false);
  const status = q.data;
  const pull = status?.reportAvailable !== false;

  useEffect(() => {
    if (!status) return;
    if (wasRunning.current && !status.running) qc.invalidateQueries();
    wasRunning.current = status.running;
  }, [status, qc]);

  const runTest = () => {
    setMessage(null);
    test.mutate(undefined, {
      onSuccess: result => { setMessage({ tone: result.status === 'success' ? 'success' : 'error', text: result.message }); qc.invalidateQueries({ queryKey: getGetFomStatusQueryKey() }); },
      onError: error => setMessage({ tone: 'error', text: apiErrorMessage(error, 'Ulanishni tekshirib boʻlmadi.') }),
    });
  };
  const runSync = (e?: FormEvent, full = false) => {
    e?.preventDefault();
    setMessage(null);
    sync.mutate({ data: full ? {} : { dateFrom: range.from, dateTo: range.to } }, {
      onSuccess: result => { setMessage({ tone: result.status === 'error' ? 'error' : 'success', text: result.message }); qc.invalidateQueries({ queryKey: getGetFomStatusQueryKey() }); },
      onError: error => setMessage({ tone: 'error', text: apiErrorMessage(error, 'Sinxronlash boshlanmadi.') }),
    });
  };
  const syncState = status ? syncStatusText[status.running ? 'running' : status.lastSyncStatus] ?? syncStatusText.not_started : null;

  return <>
    <PageHeading eyebrow="INTEGRATSIYA" title="FOM (F-APTEKA) maʼlumotlari" subtitle="Apteka kompyuteridagi F-APTEKA bazasidan maʼlumot olish va import holati" actions={canEdit && status && pull && <div className="heading-button-group">
      <button className="button secondary" onClick={runTest} disabled={!status.configured || test.isPending} data-testid="button-test-fom"><Activity size={15} />{test.isPending ? 'Tekshirilmoqda…' : 'Ulanishni sinash'}</button>
      <button className="button primary" onClick={() => runSync(undefined, true)} disabled={!status.configured || status.running || sync.isPending} data-testid="button-sync-fom"><RefreshCw size={15} className={status.running ? 'spin' : ''} />{status.running ? 'Sinxronlanmoqda…' : 'Yangilash'}</button>
    </div>} />
    <DataState loading={q.isLoading} error={q.isError} empty={false} retry={() => q.refetch()} />
    {status && <>
      {pull ? <div className={`integration-banner ${status.connected ? 'connected' : 'disconnected'}`} data-testid="status-fom-connection">
        <div className="integration-icon">{status.connected ? <Check size={20} /> : <AlertCircle size={20} />}</div>
        <div><span className="eyebrow">APTEKA BAZASI (F-APTEKA)</span><b>{status.connected ? 'Apteka kompyuteri orqali ulangan' : status.configured ? 'Apteka kompyuteri bilan aloqa yoʻq — kompyuter yoqilgan va internetga ulanganini tekshiring' : 'Ulanish sozlanmagan'}</b>
          <span>Filiallar: {status.filialIds.length ? `jami ${status.filialIds.length} ta` : 'avtomatik aniqlanadi'} · {status.intervalMinutes > 0 ? 'yangi hujjatlar avtomatik qoʻshilib boradi' : 'avto-yangilanish oʻchirilgan'}{status.refsAt ? ` · maʼlumotnomalar: ${dateTime(status.refsAt)}` : ''}</span></div>
        <StatusBadge tone={status.connected ? 'good' : status.configured ? 'bad' : 'warn'}>{status.connected ? 'Ulangan' : status.configured ? 'Javob yoʻq' : 'Sozlanmagan'}</StatusBadge>
      </div> : <div className={`integration-banner ${status.connected ? 'connected' : 'disconnected'}`} data-testid="status-fom-connection">
        <div className="integration-icon">{status.connected ? <Check size={20} /> : <AlertCircle size={20} />}</div>
        <div><span className="eyebrow">APTEKA → PHARMEX</span><b>{status.site.lastAt ? `Oxirgi qabul: ${dateTime(status.site.lastAt)}` : 'Apteka kompyuteridan hali maʼlumot kelmagan'}</b>
          <span>{status.site.configured
            ? (status.site.lastMessage
              ? status.site.lastMessage
              : 'Token sozlangan. SITE.exe apteka kompyuterida ishga tushgach, qoldiqlar shu yerga oʻzi keladi.')
            : 'FOM_SITE_TOKEN sozlanmagan: server .env fayliga qoʻshing va API ni qayta ishga tushiring.'}</span></div>
        <StatusBadge tone={status.connected ? 'good' : status.site.configured ? 'warn' : 'bad'}>{status.connected ? 'Maʼlumot kelyapti' : status.site.configured ? 'Kutilmoqda' : 'Token yoʻq'}</StatusBadge>
      </div>}
      {message && <div className={`notice ${message.tone}`} data-testid="status-fom-message">{message.text}</div>}

      <KpiStrip items={[
        { label: 'Filiallar', value: status.totals.branches, count: true, icon: Building2 },
        { label: 'Tovarlar', value: status.totals.products.toLocaleString('uz-UZ'), count: true, icon: PackageSearch },
        { label: 'Kontragentlar', value: status.totals.counterparties.toLocaleString('uz-UZ'), count: true, icon: Users },
        { label: 'Qoldiq qatorlari', value: status.totals.stockLines.toLocaleString('uz-UZ'), count: true, icon: Boxes },
        { label: 'Kirim hujjatlari', value: status.totals.purchases.toLocaleString('uz-UZ'), count: true, icon: Truck },
        { label: 'Cheklar', value: status.totals.sales.toLocaleString('uz-UZ'), count: true, icon: Receipt },
        { label: 'Tovar hujjatlari', value: status.totals.stockDocuments.toLocaleString('uz-UZ'), count: true, icon: FileText },
      ]} />

      <div className={pull ? 'split-grid' : undefined}>
        {pull && <Panel title="Manbalar (F-APTEKA bazasi)" subtitle={status.lastSyncAt ? `Oxirgi yangilanish: ${dateTime(status.lastSyncAt)} (Toshkent) · raqam — shu yangilanishda qoʻshilgan yozuvlar` : 'Hali sinxronlanmagan'}>
          <div className="source-list">{status.reports.map(report => <div className="source-row" key={report.key} data-testid={`row-fom-report-${report.key}`}>
            <div className="source-name"><b>{report.label}</b><small>{report.target}</small>
              {report.error && <small className="error-line">{report.error}</small>}{report.warning && <small className="error-line warn">{report.warning}</small>}</div>
            <div className="source-count" title="Oxirgi yangilanishda: oʻqilgan qatorlar / bazaga yozilganlar"><b>{report.imported?.toLocaleString('uz-UZ') ?? '—'}</b><small>{report.rows != null && report.rows !== report.imported ? `${report.rows.toLocaleString('uz-UZ')} qatordan` : 'yozuv'}</small></div>
            <ReportStatus report={report} running={status.running} />
          </div>)}</div>
        </Panel>}

        <div className="form-stack">
          {pull && <Panel title="Sinxronlash" subtitle="Maʼlumotnomalar va qoldiqlar har safar toʻliq yangilanadi; hujjatlar tanlangan davr boʻyicha">
            <div className="sync-status"><div className={`sync-orb ${status.running ? 'running' : status.lastSyncStatus}`}><RefreshCw size={19} className={status.running ? 'spin' : ''} /></div>
              <div className="sync-text"><span>Oxirgi sinxronlash</span><b>{status.lastSyncAt ? dateTime(status.lastSyncAt) : 'Hali bajarilmagan'}</b><small>{status.lastMessage ?? '—'}</small></div>
              {syncState && <StatusBadge tone={syncState.tone}>{syncState.label}</StatusBadge>}</div>
            {canEdit && <form className="form-grid" onSubmit={runSync}>
              <label>Boshlanish<input type="date" required value={range.from} max={range.to} onChange={e => setRange({ ...range, from: e.target.value })} data-testid="input-fom-from" /></label>
              <label>Tugash<input type="date" required value={range.to} min={range.from} onChange={e => setRange({ ...range, to: e.target.value })} data-testid="input-fom-to" /></label>
              <button className="button primary span-2" disabled={!status.configured || status.running || sync.isPending} data-testid="button-sync-range"><RefreshCw size={15} />Davr boʻyicha tortish</button>
            </form>}
            <p className="field-hint">Takroriy tortish dublikat yaratmaydi: hujjatlar FOM ID boʻyicha yangilanadi.</p>
          </Panel>}
        </div>
      </div>
    </>}
  </>;
}
