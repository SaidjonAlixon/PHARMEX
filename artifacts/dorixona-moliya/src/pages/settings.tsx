import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  Activity, AlertCircle, Boxes, Building2, Check, Circle, Copy, Eye, EyeOff, FileText, Loader2, PackageSearch, PlugZap, Receipt, RefreshCw, Save, ShieldCheck, Truck, Users, X,
} from 'lucide-react';
import {
  useGetFomStatus, getGetFomStatusQueryKey, useTestFomConnection, useSyncFom, useGetFomSettings, getGetFomSettingsQueryKey, useSaveFomSettings,
} from '@workspace/api-client-react';
import type { FomReportState } from '@workspace/api-client-react';
import { DataState, InfoGrid, KpiStrip, PageHeading, Panel, StatusBadge, TableWrap, apiErrorMessage, date, dateTime } from '@/components/kit';

const syncStatusText: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  success: { label: 'Muvaffaqiyatli', tone: 'good' },
  error: { label: 'Xatolik', tone: 'bad' },
  running: { label: 'Jarayonda', tone: 'info' },
  waiting: { label: 'Kutilmoqda', tone: 'warn' },
  not_started: { label: 'Boshlanmagan', tone: 'neutral' },
};

function isoDay(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

function ago(value: string | null | undefined) {
  if (!value) return 'hali yoʻq';
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return 'hozirgina';
  if (minutes < 60) return `${minutes} daq oldin`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} soat oldin`;
  return date(value);
}

/** Topbar indicator; refreshes every page's data as soon as a new FOM import lands. */
export function FomLive() {
  const qc = useQueryClient();
  const q = useGetFomStatus({ query: { queryKey: getGetFomStatusQueryKey(), refetchInterval: 15_000 } });
  const seen = useRef<string | undefined>(undefined);
  const [, setTick] = useState(0);
  const s = q.data;
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!s || s.running) return;
    const key = `${s.lastSyncAt}|${s.site.lastAt}`;
    if (seen.current !== undefined && seen.current !== key) qc.invalidateQueries();
    seen.current = key;
  }, [s, qc]);
  if (!s || (!s.configured && !s.site.configured)) return null;
  const latest = [s.lastSyncAt, s.site.lastAt].filter(Boolean).sort().pop() ?? null;
  const sitePushing = !!s.site.lastAt && Date.now() - new Date(s.site.lastAt).getTime() < 30 * 60_000;
  const live = s.connected || sitePushing;
  const tone = s.running ? 'running' : live ? 'live' : 'down';
  return <Link href="/settings" className={`fom-live ${tone}`} title={s.lastMessage ?? 'FOM integratsiyasi'} data-testid="status-fom-live">
    <span className="dot" /><b>FOM</b><small>{s.running ? 'yangilanmoqda…' : live ? ago(latest) : 'aloqa yoʻq'}</small>
  </Link>;
}

function ReportStatus({ report, running }: { report: FomReportState; running: boolean }) {
  if (report.error) return <StatusBadge tone="bad">Xatolik</StatusBadge>;
  if (report.warning) return <StatusBadge tone="warn">Qisman</StatusBadge>;
  if (report.imported == null) return running ? <StatusBadge tone="info">Navbatda</StatusBadge> : <StatusBadge>Yuklanmagan</StatusBadge>;
  return <StatusBadge tone="good">Yuklandi</StatusBadge>;
}

type ConnectForm = { protocol: 'http' | 'https'; host: string; port: string; filialIds: string; intervalMinutes: string; initialDays: string; timeoutSeconds: string; apiToken: string; clearApiToken: boolean };
type StepState = 'idle' | 'busy' | 'ok' | 'fail';
const stepIcon = (s: StepState) => s === 'busy' ? <Loader2 size={14} className="spin" /> : s === 'ok' ? <Check size={14} /> : s === 'fail' ? <X size={14} /> : <Circle size={10} />;

function FomConnectPanel({ onMessage }: { onMessage: (m: { tone: 'success' | 'error'; text: string } | null) => void }) {
  const qc = useQueryClient();
  const settingsQ = useGetFomSettings();
  const save = useSaveFomSettings();
  const test = useTestFomConnection();
  const sync = useSyncFom();
  const [form, setForm] = useState<ConnectForm | null>(null);
  const [steps, setSteps] = useState<{ save: StepState; test: StepState; sync: StepState } | null>(null);
  const [showToken, setShowToken] = useState(false);
  const s = settingsQ.data;

  useEffect(() => {
    if (!s || form) return;
    setForm({
      protocol: s.protocol, host: s.host, port: s.port ? String(s.port) : '', filialIds: s.filialIds.join(', '),
      intervalMinutes: String(s.intervalMinutes), initialDays: String(s.initialDays), timeoutSeconds: String(s.timeoutSeconds), apiToken: '', clearApiToken: false,
    });
  }, [s, form]);

  if (settingsQ.isError) return <Panel title="FOM ulanishi (REPORT.exe)" subtitle="Sozlamalarni faqat administrator koʻra oladi"><div className="notice error">Ulanish sozlamalarini yuklab boʻlmadi.</div></Panel>;
  if (!form || !s) return <Panel title="FOM ulanishi (REPORT.exe)"><DataState loading empty={false} error={false} retry={() => settingsQ.refetch()} /></Panel>;

  const set = (patch: Partial<ConnectForm>) => setForm({ ...form, ...patch });
  const onHost = (raw: string) => {
    const match = /^\s*(https?):\/\/([^/:\s]+)(?::(\d+))?/i.exec(raw);
    if (match) set({ protocol: match[1].toLowerCase() as 'http' | 'https', host: match[2], port: match[3] ?? form.port });
    else set({ host: raw.replace(/\s+/g, '') });
  };
  const busy = save.isPending || test.isPending || sync.isPending;
  const preview = form.host ? `${form.protocol}://${form.host}${form.port ? `:${form.port}` : ''}/P_GetReport_XML` : '—';

  const submit = async (e: FormEvent, connect: boolean) => {
    e.preventDefault();
    onMessage(null);
    setSteps(connect ? { save: 'busy', test: 'idle', sync: 'idle' } : null);
    try {
      const saved = await save.mutateAsync({ data: {
        protocol: form.protocol, host: form.host.trim(), port: form.port ? Number(form.port) : null, filialIds: form.filialIds,
        intervalMinutes: Number(form.intervalMinutes) || 0, initialDays: Number(form.initialDays) || 90, timeoutSeconds: Number(form.timeoutSeconds) || 120,
        ...(form.apiToken.trim() ? { apiToken: form.apiToken.trim() } : {}), ...(form.clearApiToken ? { clearApiToken: true } : {}),
      } });
      qc.setQueryData(getGetFomSettingsQueryKey(), saved);
      setForm({ ...form, apiToken: '', clearApiToken: false });
      void qc.invalidateQueries({ queryKey: getGetFomStatusQueryKey() });
      if (!connect) { onMessage({ tone: 'success', text: 'Sozlamalar saqlandi.' }); return; }
      setSteps({ save: 'ok', test: 'busy', sync: 'idle' });
      const tested = await test.mutateAsync();
      if (tested.status !== 'success') {
        setSteps({ save: 'ok', test: 'fail', sync: 'idle' });
        onMessage({ tone: 'error', text: `Saqlandi, lekin FOM serveriga ulanib boʻlmadi: ${tested.message}` });
        void qc.invalidateQueries({ queryKey: getGetFomStatusQueryKey() });
        return;
      }
      setSteps({ save: 'ok', test: 'ok', sync: 'busy' });
      const started = await sync.mutateAsync({ data: {} });
      setSteps({ save: 'ok', test: 'ok', sync: started.status === 'error' ? 'fail' : 'ok' });
      onMessage({ tone: started.status === 'error' ? 'error' : 'success', text: `${tested.message} ${started.message}` });
      void qc.invalidateQueries({ queryKey: getGetFomStatusQueryKey() });
    } catch (error) {
      setSteps(prev => prev && { save: prev.save === 'busy' ? 'fail' : prev.save, test: prev.test === 'busy' ? 'fail' : prev.test, sync: prev.sync === 'busy' ? 'fail' : prev.sync });
      onMessage({ tone: 'error', text: apiErrorMessage(error, 'Sozlamalarni saqlab boʻlmadi.') });
    }
  };

  const sourceBadge = s.source === 'saved' ? <StatusBadge tone="good">Saqlangan{s.updatedAt ? ` · ${dateTime(s.updatedAt)}` : ''}</StatusBadge> : s.source === 'env' ? <StatusBadge tone="info">Server .env dan</StatusBadge> : <StatusBadge tone="warn">Kiritilmagan</StatusBadge>;
  return <Panel title="FOM ulanishi (REPORT.exe)" subtitle="FOM texnigi bergan server IP manzili, port va filial ID larini kiriting, soʻng «Saqlash va ulash» ni bosing" action={sourceBadge} className="fom-connect">
    <form className="form-stack" onSubmit={e => submit(e, true)}>
      <div className="form-grid four">
        <label className="f-proto">Protokol<select value={form.protocol} onChange={e => set({ protocol: e.target.value as 'http' | 'https' })} data-testid="select-fom-protocol"><option value="http">http://</option><option value="https">https://</option></select></label>
        <label className="span-2">Server IP manzili<input required value={form.host} onChange={e => onHost(e.target.value)} placeholder="masalan 26.66.205.88" autoComplete="off" spellCheck={false} data-testid="input-fom-host" /></label>
        <label className="f-port">Port<input type="number" min={1} max={65535} value={form.port} onChange={e => set({ port: e.target.value })} placeholder="8084" data-testid="input-fom-port" /></label>
        <label className="span-2">Filial ID lari (pFilial_id)<input value={form.filialIds} onChange={e => set({ filialIds: e.target.value })} placeholder="1, 2, 3 — boʻsh qolsa avtomatik aniqlanadi" data-testid="input-fom-filials" /></label>
        <label>Avto-yangilash (daqiqa)<input type="number" min={0} max={1440} required value={form.intervalMinutes} onChange={e => set({ intervalMinutes: e.target.value })} data-testid="input-fom-interval" /></label>
        <label>Birinchi tortish (kun)<input type="number" min={1} max={3650} required value={form.initialDays} onChange={e => set({ initialDays: e.target.value })} data-testid="input-fom-days" /></label>
        <label className="span-2"><span>Kirish tokeni <span className="optional">· ixtiyoriy, faqat FOM talab qilsa</span></span>
          <div className="secret-input"><input type={showToken ? 'text' : 'password'} value={form.apiToken} onChange={e => set({ apiToken: e.target.value, clearApiToken: false })} placeholder={s.apiTokenSet ? `Saqlangan (${s.apiTokenHint}) — oʻzgartirish uchun yangisini kiriting` : 'Token yoʻq'} autoComplete="new-password" data-testid="input-fom-token" />
            <button type="button" className="icon-button" onClick={() => setShowToken(v => !v)} title={showToken ? 'Yashirish' : 'Koʻrsatish'}>{showToken ? <EyeOff size={15} /> : <Eye size={15} />}</button></div>
          {s.apiTokenSet && <span className="check-line"><input type="checkbox" checked={form.clearApiToken} onChange={e => set({ clearApiToken: e.target.checked, apiToken: '' })} /> Saqlangan tokenni oʻchirish</span>}
        </label>
        <label>Kutish vaqti (soniya)<input type="number" min={5} max={600} required value={form.timeoutSeconds} onChange={e => set({ timeoutSeconds: e.target.value })} data-testid="input-fom-timeout" /></label>
        <div className="connect-preview"><span>Soʻrov manzili</span><code>{preview}</code></div>
      </div>
      {steps && <div className="connect-steps" data-testid="status-fom-steps">
        <span className={steps.save}>{stepIcon(steps.save)} Saqlash</span><i />
        <span className={steps.test}>{stepIcon(steps.test)} Serverga ulanish</span><i />
        <span className={steps.sync}>{stepIcon(steps.sync)} Maʼlumot tortish</span>
      </div>}
      <div className="connect-actions">
        <p className="field-hint"><ShieldCheck size={14} /> Maʼlumotlar serverda saqlanadi; token brauzerga qaytarilmaydi. Radmin VPN orqali boʻlsa, apteka kompyuterining 26.x.x.x IP sini kiriting.</p>
        <button type="button" className="button secondary" disabled={busy || !form.host} onClick={e => submit(e, false)} data-testid="button-fom-save"><Save size={15} />Saqlash</button>
        <button className="button primary" disabled={busy || !form.host} data-testid="button-fom-connect"><PlugZap size={15} />{busy ? 'Ulanmoqda…' : 'Saqlash va ulash'}</button>
      </div>
    </form>
  </Panel>;
}

export function SettingsPage() {
  const qc = useQueryClient();
  const q = useGetFomStatus({ query: { queryKey: getGetFomStatusQueryKey(), refetchInterval: query => (query.state.data?.running ? 1500 : false) } });
  const test = useTestFomConnection();
  const sync = useSyncFom();
  const [range, setRange] = useState({ from: isoDay(-30), to: isoDay() });
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const wasRunning = useRef(false);
  const status = q.data;

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
  const copySetup = (text: string) => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };

  const syncState = status ? syncStatusText[status.running ? 'running' : status.lastSyncStatus] ?? syncStatusText.not_started : null;
  const origin = /^(localhost|127\.|192\.168\.)/.test(window.location.hostname) ? 'https://<domen>' : window.location.origin;
  const setupIni = status?.site.path ? `[CONNECT]\nSERVER=LocalHost\nBASE=NAPTSKLAD\n[SERVER]\nURL=${origin}/api/fom/site/<FOM_SITE_TOKEN>\nTOCING=<FOM_SITE_TOKEN>` : '';

  return <>
    <PageHeading eyebrow="INTEGRATSIYA" title="FOM (F-APTEKA) maʼlumotlari" subtitle="REPORT.exe orqali hisobotlarni tortish, SITE.exe orqali qoldiqlarni qabul qilish va import holati" actions={status && <div className="heading-button-group">
      <button className="button secondary" onClick={runTest} disabled={!status.configured || test.isPending} data-testid="button-test-fom"><Activity size={15} />{test.isPending ? 'Tekshirilmoqda…' : 'Ulanishni sinash'}</button>
      <button className="button primary" onClick={() => runSync(undefined, true)} disabled={!status.configured || status.running || sync.isPending} data-testid="button-sync-fom"><RefreshCw size={15} className={status.running ? 'spin' : ''} />{status.running ? 'Sinxronlanmoqda…' : 'Yangilash'}</button>
    </div>} />
    <DataState loading={q.isLoading} error={q.isError} empty={false} retry={() => q.refetch()} />
    {status && <>
      <div className={`integration-banner ${status.connected ? 'connected' : 'disconnected'}`} data-testid="status-fom-connection">
        <div className="integration-icon">{status.connected ? <Check size={20} /> : <AlertCircle size={20} />}</div>
        <div><span className="eyebrow">REPORT.EXE SERVERI</span><b>{status.baseUrl ?? 'Server manzili kiritilmagan — pastdagi formani toʻldiring'}</b>
          <span>Filiallar (pFilial_id): {status.filialIds.length ? `${status.filialIds.join(', ')} — jami ${status.filialIds.length} ta` : 'avtomatik aniqlanadi'} · Real vaqt: {status.intervalMinutes > 0 ? `har ${status.intervalMinutes} daqiqada hujjatlar va qoldiqlar, har ${status.refsIntervalMinutes} daqiqada maʼlumotnomalar` : 'avto-sinxron oʻchirilgan'}{status.refsAt ? ` · maʼlumotnomalar: ${dateTime(status.refsAt)}` : ''}</span></div>
        <StatusBadge tone={status.connected ? 'good' : status.configured ? 'bad' : 'warn'}>{status.connected ? 'Ulangan' : status.configured ? 'Javob yoʻq' : 'Sozlanmagan'}</StatusBadge>
      </div>
      {message && <div className={`notice ${message.tone}`} data-testid="status-fom-message">{message.text}</div>}

      <FomConnectPanel onMessage={setMessage} />

      <KpiStrip items={[
        { label: 'Filiallar', value: status.totals.branches, count: true, icon: Building2 },
        { label: 'Tovarlar', value: status.totals.products.toLocaleString('uz-UZ'), count: true, icon: PackageSearch },
        { label: 'Kontragentlar', value: status.totals.counterparties.toLocaleString('uz-UZ'), count: true, icon: Users },
        { label: 'Qoldiq qatorlari', value: status.totals.stockLines.toLocaleString('uz-UZ'), count: true, icon: Boxes },
        { label: 'Kirim hujjatlari', value: status.totals.purchases.toLocaleString('uz-UZ'), count: true, icon: Truck },
        { label: 'Cheklar', value: status.totals.sales.toLocaleString('uz-UZ'), count: true, icon: Receipt },
        { label: 'Tovar hujjatlari', value: status.totals.stockDocuments.toLocaleString('uz-UZ'), count: true, icon: FileText },
      ]} />

      <div className="split-grid">
        <Panel title="Hisobotlar (REPORT.exe)" subtitle={status.lastSyncFrom ? `Oxirgi davr: ${date(status.lastSyncFrom)} — ${date(status.lastSyncTo)}` : 'Hali sinxronlanmagan'}>
          <TableWrap><thead><tr><th>ID</th><th>Hisobot</th><th>Platformada</th><th className="num">Qator</th><th className="num">Import</th><th>Holat</th></tr></thead>
            <tbody>{status.reports.map(report => <tr key={report.key} data-testid={`row-fom-report-${report.key}`}>
              <td><code>{report.reportId}</code></td>
              <td><b>{report.label}</b>{report.dated && <small className="muted-line">davr boʻyicha</small>}{report.error && <small className="error-line">{report.error}</small>}{report.warning && <small className="error-line warn">{report.warning}</small>}</td>
              <td className="muted">{report.target}</td>
              <td className="num">{report.rows?.toLocaleString('uz-UZ') ?? '—'}</td>
              <td className="num">{report.imported?.toLocaleString('uz-UZ') ?? '—'}</td>
              <td><ReportStatus report={report} running={status.running} /></td>
            </tr>)}</tbody>
          </TableWrap>
        </Panel>

        <div className="form-stack">
          <Panel title="Sinxronlash" subtitle="Maʼlumotnomalar va qoldiqlar har safar toʻliq yangilanadi; hujjatlar tanlangan davr boʻyicha">
            <div className="sync-status"><div className={`sync-orb ${status.running ? 'running' : status.lastSyncStatus}`}><RefreshCw size={19} className={status.running ? 'spin' : ''} /></div>
              <div className="sync-text"><span>Oxirgi sinxronlash</span><b>{status.lastSyncAt ? dateTime(status.lastSyncAt) : 'Hali bajarilmagan'}</b><small>{status.lastMessage ?? '—'}</small></div>
              {syncState && <StatusBadge tone={syncState.tone}>{syncState.label}</StatusBadge>}</div>
            <form className="form-grid" onSubmit={runSync}>
              <label>Boshlanish<input type="date" required value={range.from} max={range.to} onChange={e => setRange({ ...range, from: e.target.value })} data-testid="input-fom-from" /></label>
              <label>Tugash<input type="date" required value={range.to} min={range.from} onChange={e => setRange({ ...range, to: e.target.value })} data-testid="input-fom-to" /></label>
              <button className="button primary span-2" disabled={!status.configured || status.running || sync.isPending} data-testid="button-sync-range"><RefreshCw size={15} />Davr boʻyicha tortish</button>
            </form>
            <p className="field-hint">Takroriy tortish dublikat yaratmaydi: hujjatlar FOM ID boʻyicha yangilanadi.</p>
          </Panel>

          <Panel title="Qoldiqlarni qabul qilish (SITE.exe)" subtitle="FOM texnigi SETUP.ini ga shu manzil va tokenni yozadi">
            <InfoGrid items={[
              { label: 'Holat', value: status.site.configured ? <StatusBadge tone="good">Token sozlangan</StatusBadge> : <StatusBadge tone="warn">FOM_SITE_TOKEN yoʻq</StatusBadge> },
              { label: 'Qabul manzili', value: <span className="mono">{status.site.path ?? '—'}</span> },
              { label: 'Oxirgi qabul', value: status.site.lastAt ? dateTime(status.site.lastAt) : 'Hali kelmagan' },
              { label: 'Qatorlar', value: status.site.lastRecords.toLocaleString('uz-UZ') },
            ]} />
            {status.site.lastMessage && <div className={`notice ${status.site.lastStatus === 'error' ? 'error' : 'info'}`}>{status.site.lastMessage}</div>}
            {setupIni && <div className="code-block"><pre>{setupIni}</pre><button type="button" className="icon-button" onClick={() => copySetup(setupIni)} title="Nusxalash">{copied ? <Check size={15} /> : <Copy size={15} />}</button></div>}
            <p className="field-hint"><ShieldCheck size={14} /> SITE.exe tokeni faqat server muhitida (env) saqlanadi, brauzerga toʻliq chiqarilmaydi.</p>
          </Panel>
        </div>
      </div>
    </>}
  </>;
}
