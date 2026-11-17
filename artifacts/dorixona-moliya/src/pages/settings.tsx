import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  Activity, AlertCircle, Boxes, Building2, Check, CheckCheck, Copy, Download, Eye, EyeOff, FileText,
  ListOrdered, PackageSearch, Receipt, RefreshCw, Truck, Users,
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

type CompanyFomSettings = {
  source: string;
  protocol: 'http' | 'https';
  host: string;
  port: number | null;
  reportUrl: string | null;
  filialIds: string[];
  intervalMinutes: number;
  initialDays: number;
  timeoutSeconds: number;
  apiTokenSet: boolean;
  apiTokenHint: string | null;
  updatedAt: string | null;
  startDate?: string;
};

type FomAgentConnect = {
  token: string | null;
  platformUrl: string;
  preferredPort: number;
  batUrl: string | null;
  batCmd: string | null;
  psCmd: string | null;
  startDate: string;
  agent: {
    online: boolean;
    machine: string | null;
    reportListening: boolean | null;
    lastSeenAt: string | null;
  };
};

async function companyFomApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText || 'Xatolik');
  return data as T;
}

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

function ReportStatus({ report, running, pct }: { report: FomReportState; running: boolean; pct?: number | null }) {
  if (report.error) return <StatusBadge tone="bad">Xatolik</StatusBadge>;
  if (pct != null && running && pct < 100 && report.imported == null) {
    return <StatusBadge tone="info">{pct}%</StatusBadge>;
  }
  if (report.warning && /toʻlovi qilinmagan|boʻsh/i.test(report.warning)) {
    return <StatusBadge tone="warn">Boʻsh / toʻlov yoʻq</StatusBadge>;
  }
  if (report.warning) return <StatusBadge tone="warn">Qisman</StatusBadge>;
  if (report.imported == null) return running ? <StatusBadge tone="info">Navbatda</StatusBadge> : <StatusBadge>Yuklanmagan</StatusBadge>;
  if (running && pct != null && pct < 100) return <StatusBadge tone="info">{pct}%</StatusBadge>;
  return <StatusBadge tone="good">Yuklandi</StatusBadge>;
}

function reportChunkStats(
  chunks: Array<{ reportKey: string; status: string; rows: number; error?: string | null }> | undefined,
  key: string,
) {
  const list = (chunks ?? []).filter(c => c.reportKey === key);
  if (!list.length) return null;
  const done = list.filter(c => c.status === 'done' || (c.status === 'error' && /HTML\s*200/i.test(c.error || ''))).length;
  const running = list.some(c => c.status === 'running');
  const rows = list.reduce((s, c) => s + (c.rows || 0), 0);
  const pct = Math.min(100, Math.floor((done * 100) / list.length));
  return { total: list.length, done, running, rows, pct };
}

export function SettingsPage() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  const q = useGetFomStatus({
    query: {
      queryKey: getGetFomStatusQueryKey(),
      refetchInterval: query => (query.state.data?.running ? 4_000 : false),
      staleTime: 2_000,
    },
  });
  const test = useTestFomConnection();
  const sync = useSyncFom();
  const [range, setRange] = useState({ from: '2026-11-12', to: todayDay() });
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const wasRunning = useRef(false);
  const status = q.data;
  const pull = status?.reportAvailable !== false;

  const [protocol, setProtocol] = useState<'http' | 'https'>('http');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [filialIds, setFilialIds] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState('15');
  const [initialDays, setInitialDays] = useState('365');
  const [timeoutSeconds, setTimeoutSeconds] = useState('120');
  const [startDate, setStartDate] = useState('2025-01-01');
  const [apiToken, setApiToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const settingsQ = useQuery({
    queryKey: ['company-fom-settings'],
    queryFn: () => companyFomApi<CompanyFomSettings>('/api/fom/settings'),
    enabled: canEdit,
  });
  const agentQ = useQuery({
    queryKey: ['company-fom-agent'],
    queryFn: () => companyFomApi<FomAgentConnect>('/api/fom/agent'),
    enabled: canEdit,
    staleTime: 30_000,
  });
  const connect = agentQ.data;

  useEffect(() => {
    const s = settingsQ.data;
    if (!s) return;
    const dayOf = (v: unknown, fallback: string) => {
      const raw = String(v ?? '').trim();
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
      return m?.[1] || fallback;
    };
    const start = dayOf(s.startDate, '2025-01-01');
    setProtocol(s.protocol || 'http');
    setHost(s.host || '127.0.0.1');
    setPort(s.port != null ? String(s.port) : '8084');
    setFilialIds((s.filialIds || []).join(', ') || '1');
    setIntervalMinutes(String(s.intervalMinutes ?? 0));
    setInitialDays(String(s.initialDays || 680));
    setTimeoutSeconds(String(s.timeoutSeconds || 180));
    setStartDate(start);
    setRange({ from: start, to: '2026-11-12' });
  }, [settingsQ.data]);

  const saveSettings = useMutation({
    mutationFn: () =>
      companyFomApi<CompanyFomSettings>('/api/fom/settings', {
        method: 'PUT',
        body: JSON.stringify({
          protocol,
          host: host.trim(),
          port: port.trim() ? Number(port) : null,
          filialIds: filialIds.trim(),
          intervalMinutes: Number(intervalMinutes) || 0,
          initialDays: Number(initialDays) || 365,
          timeoutSeconds: Number(timeoutSeconds) || 120,
          startDate: startDate || '2025-01-01',
          apiToken: apiToken.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      setApiToken('');
      setMessage({ tone: 'success', text: 'FOM ulanish sozlamalari saqlandi. Endi «Ulanishni sinash» ni bosing.' });
      void qc.invalidateQueries({ queryKey: ['company-fom-settings'] });
      void qc.invalidateQueries({ queryKey: getGetFomStatusQueryKey() });
    },
    onError: (error: Error) => setMessage({ tone: 'error', text: error.message }),
  });

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
  const runSync = (e?: FormEvent, mode: 'incremental' | 'full' | 'range' = 'range') => {
    e?.preventDefault();
    setMessage(null);
    const data =
      mode === 'incremental' ? {} :
      mode === 'full' ? { dateFrom: startDate || '2025-01-01', dateTo: isoDay() } :
      { dateFrom: range.from, dateTo: range.to };
    sync.mutate({ data }, {
      onSuccess: result => { setMessage({ tone: result.status === 'error' ? 'error' : 'success', text: result.message }); qc.invalidateQueries({ queryKey: getGetFomStatusQueryKey() }); },
      onError: error => setMessage({ tone: 'error', text: apiErrorMessage(error, 'Sinxronlash boshlanmadi.') }),
    });
  };
  const syncState = status ? syncStatusText[status.running ? 'running' : status.lastSyncStatus] ?? syncStatusText.not_started : null;
  const reportPreview = host.trim()
    ? `${protocol}://${host.trim()}${port.trim() ? `:${port.trim()}` : ''}`
    : '';
  const filialLooksWrong = /[a-zA-Zа-яА-ЯёЁ]/.test(filialIds);
  const startLabel = (startDate || '2025-01-01').split('-').reverse().join('.');

  const copyText = async (key: string, value: string) => {
    if (!value.trim()) {
      toast({ title: 'Nusxa olish uchun qiymat yoʻq', variant: 'destructive' });
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      toast({ title: 'Nusxa olindi' });
      window.setTimeout(() => setCopied(prev => (prev === key ? null : prev)), 1800);
    } catch {
      toast({ title: 'Nusxa olinmadi', variant: 'destructive' });
    }
  };

  return <>
    <PageHeading eyebrow="INTEGRATSIYA" title="FOM (F-APTEKA) maʼlumotlari" subtitle="Kompaniyangiz F-APTEKA serveriga ulaning — maʼlumotlar faqat sizning kabinetingizda saqlanadi" actions={canEdit && status && pull && <div className="heading-button-group">
      <button className="button secondary" onClick={runTest} disabled={!status.configured || test.isPending} data-testid="button-test-fom"><Activity size={15} />{test.isPending ? 'Tekshirilmoqda…' : 'Ulanishni sinash'}</button>
      <button className="button primary" onClick={() => runSync(undefined, 'incremental')} disabled={!status.configured || status.running || sync.isPending} data-testid="button-sync-fom"><RefreshCw size={15} className={status.running ? 'spin' : ''} />{status.running ? 'Sinxronlanmoqda…' : 'Yangilash'}</button>
    </div>} />
    <DataState loading={q.isLoading && !status} error={q.isError && !status} empty={false} retry={() => q.refetch()} />
    {status?.running && (
      <div className="notice info" data-testid="status-fom-running">
        Tortilmoqda: {status.lastMessage || 'FOM bazasi…'} {q.isFetching ? '·' : ''}
      </div>
    )}
    {message && <div className={`notice ${message.tone}`} data-testid="status-fom-message">{message.text}</div>}

    {canEdit && <Panel title="FOM ulanishi (VPN siz)" subtitle="Chiqish HTTPS — Radmin/VPN va kirish porti yoʻq; o‘chib-yonganda Task Scheduler davom ettiradi" className="fom-connect" data-testid="panel-fom-vps">
      <div className="fom-setup-guide">
        <div className="fom-setup-head">
          <ListOrdered size={16} aria-hidden />
          <b>Bir marta sozlash</b>
          <span>VPN kerak emas</span>
        </div>
        <ol>
          <li>FOM PC da <b>REPORT.exe / SERVICEREPORTS</b> ni yoqing (lokal port <code>8084</code>).</li>
          <li>Pastdan <b>.bat yuklab olish</b> → faylni <b>Admin</b> sifatida oching (yoki CMD/PowerShell qatorini nusxa qiling).</li>
          <li>Skript Windows vazifasini qo‘yadi va <b>{startLabel} → 12.11.2026</b> tortishni boshlaydi.</li>
          <li>Keyin kompyuter o‘chib yonsa ham o‘zi ishlaydi — Radmin/VPN o‘rnatilmaydi.</li>
        </ol>
      </div>

      <section className="fom-form-section" data-testid="panel-fom-connect-kit">
        <h3>Ulanish (.bat / PowerShell)</h3>
        <p className="fom-agent-lead">
          Fayl shu sahifadan olinadi — FOM PC ga nusxa qilib Admin oching. Internet chiqishi (HTTPS) yetadi.
          {connect?.agent.online ? ` · Hozir: ${connect.agent.machine || 'ulanggan'}` : ' · Hali ulanmagan'}
        </p>
        <div className="notice warn" data-testid="fom-cheklar-upgrade">
          Hozirgi <b>2537 chek</b> — kunlik yigʻma (hammasi «Boshqa»). Har bir chek + Naqd/HUMO/UzCard uchun .bat ni
          <b> FOM dorixona kompyuterida</b> Admin oching (bir marta). Keyin 2025-yildan boshlab avtomatik tortiladi.
        </div>
        <div className="fom-agent-actions button-row">
          <a
            className={`button primary${!connect?.batUrl ? ' disabled' : ''}`}
            href={connect?.batUrl || undefined}
            download="pharmxs-fom-ulanish.bat"
            data-testid="button-download-fom-bat"
            onClick={e => { if (!connect?.batUrl) e.preventDefault(); }}
          >
            <Download size={15} /> .bat yuklab olish
          </a>
          <button
            type="button"
            className="button secondary"
            disabled={!connect?.batCmd}
            onClick={() => void copyText('batCmd', connect?.batCmd || '')}
            data-testid="button-copy-fom-bat-cmd"
          >
            {copied === 'batCmd' ? <CheckCheck size={15} /> : <Copy size={15} />}
            {copied === 'batCmd' ? 'CMD nusxa olindi' : 'CMD nusxa'}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={!connect?.psCmd}
            onClick={() => void copyText('psCmd', connect?.psCmd || '')}
            data-testid="button-copy-fom-ps-cmd"
          >
            {copied === 'psCmd' ? <CheckCheck size={15} /> : <Copy size={15} />}
            {copied === 'psCmd' ? 'PS nusxa olindi' : 'PowerShell nusxa'}
          </button>
        </div>
        {agentQ.isLoading ? <p className="field-hint">Ulanish buyruqlari yuklanmoqda…</p> : null}
        {agentQ.isError ? <p className="field-hint bad">Ulanish buyruqlari olinmadi — sahifani yangilang.</p> : null}
        {connect?.batCmd ? (
          <div className="fom-script-box" data-testid="fom-bat-cmd-box">
            <div className="fom-script-toolbar">
              <span>CMD — bir qator</span>
              <button type="button" className="button secondary" onClick={() => void copyText('batCmdBox', connect.batCmd || '')}>
                {copied === 'batCmdBox' ? <CheckCheck size={14} /> : <Copy size={14} />}
                Nusxa
              </button>
            </div>
            <textarea className="fom-script-ta" readOnly value={connect.batCmd} rows={3} spellCheck={false} onFocus={e => e.currentTarget.select()} />
          </div>
        ) : null}
        {connect?.psCmd ? (
          <div className="fom-script-box" data-testid="fom-ps-cmd-box">
            <div className="fom-script-toolbar">
              <span>PowerShell — bir qator</span>
              <button type="button" className="button secondary" onClick={() => void copyText('psCmdBox', connect.psCmd || '')}>
                {copied === 'psCmdBox' ? <CheckCheck size={14} /> : <Copy size={14} />}
                Nusxa
              </button>
            </div>
            <textarea className="fom-script-ta" readOnly value={connect.psCmd} rows={4} spellCheck={false} onFocus={e => e.currentTarget.select()} />
          </div>
        ) : null}
      </section>

      <form className="fom-form" onSubmit={e => { e.preventDefault(); if (filialLooksWrong) { setMessage({ tone: 'error', text: 'Filial ID faqat raqam boʻlishi kerak (masalan: 1, 2).' }); return; } saveSettings.mutate(); }} data-testid="form-fom-settings">
        <section className="fom-form-section">
          <h3>Lokal REPORT</h3>
          <div className="form-grid fom-grid-server">
            <label className="f-proto">Protokol
              <select value={protocol} onChange={e => setProtocol(e.target.value as 'http' | 'https')} data-testid="input-fom-protocol">
                <option value="http">http</option>
                <option value="https">https</option>
              </select>
            </label>
            <label className="f-host">Host / IP
              <span className="field-with-actions">
                <input value={host} onChange={e => setHost(e.target.value)} placeholder="127.0.0.1" data-testid="input-fom-host" autoComplete="off" />
                <button type="button" className="icon-button" title="Nusxa olish" aria-label="Hostni nusxa olish" onClick={() => void copyText('host', host)} data-testid="button-copy-fom-host">
                  {copied === 'host' ? <CheckCheck size={15} /> : <Copy size={15} />}
                </button>
              </span>
            </label>
            <label className="f-port">Port
              <input value={port} onChange={e => setPort(e.target.value.replace(/[^\d]/g, ''))} placeholder="8084" inputMode="numeric" data-testid="input-fom-port" />
            </label>
          </div>
          {reportPreview ? (
            <div className="connect-preview" data-testid="fom-url-preview">
              <span>Manzil</span>
              <div className="connect-preview-row">
                <code>{reportPreview}</code>
                <button type="button" className="icon-button" title="Nusxa olish" aria-label="Manzilni nusxa olish" onClick={() => void copyText('url', reportPreview)}>
                  {copied === 'url' ? <CheckCheck size={15} /> : <Copy size={15} />}
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="fom-form-section">
          <h3>Tortish sozlamalari</h3>
          <div className="form-grid fom-grid-pull">
            <label className="f-filials">Filial ID
              <span className="field-with-actions">
                <input value={filialIds} onChange={e => setFilialIds(e.target.value.replace(/[^\d,\s;]/g, ''))} placeholder="1, 2, 3" data-testid="input-fom-filials" autoComplete="off" aria-invalid={filialLooksWrong} />
                <button type="button" className="icon-button" title="Nusxa olish" aria-label="Filial ID larni nusxa olish" onClick={() => void copyText('filials', filialIds)} data-testid="button-copy-fom-filials">
                  {copied === 'filials' ? <CheckCheck size={15} /> : <Copy size={15} />}
                </button>
              </span>
              {filialLooksWrong ? <span className="field-hint bad">Faqat raqam, vergul yoki boʻsh joy</span> : null}
            </label>
            <label className="f-start">Birinchi tortish
              <input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} data-testid="input-fom-start-date" />
            </label>
            <label className="f-interval">Avto-interval <em>(daq.)</em>
              <input type="number" min={0} max={1440} value={intervalMinutes} onChange={e => setIntervalMinutes(e.target.value)} data-testid="input-fom-interval" />
            </label>
            <label className="f-timeout">Timeout <em>(son.)</em>
              <input type="number" min={5} max={600} value={timeoutSeconds} onChange={e => setTimeoutSeconds(e.target.value)} data-testid="input-fom-timeout" />
            </label>
            <label className="f-days">Dastlabki kunlar
              <input type="number" min={1} max={3650} value={initialDays} onChange={e => setInitialDays(e.target.value)} data-testid="input-fom-initial-days" />
            </label>
          </div>
        </section>

        <section className="fom-form-section">
          <h3>API token</h3>
          <label>Token <em>(ixtiyoriy — agar FOM talab qilsa)</em>
            <span className="field-with-actions secret-input">
              <input type={showToken ? 'text' : 'password'} value={apiToken} onChange={e => setApiToken(e.target.value)} placeholder={settingsQ.data?.apiTokenSet ? (settingsQ.data.apiTokenHint ?? 'Saqlangan token bor') : 'Boʻsh qoldirish mumkin'} data-testid="input-fom-token" autoComplete="new-password" />
              <button type="button" className="icon-button" title={showToken ? 'Yashirish' : 'Koʻrsatish'} aria-label={showToken ? 'Tokenni yashirish' : 'Tokenni koʻrsatish'} onClick={() => setShowToken(v => !v)} data-testid="button-toggle-fom-token">
                {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </label>
        </section>

        <div className="connect-actions">
          <button type="button" className="button secondary" onClick={runTest} disabled={test.isPending || !host.trim()} data-testid="button-test-fom-settings">
            <Activity size={15} />{test.isPending ? 'Tekshirilmoqda…' : 'Ulanishni sinash'}
          </button>
          <button type="submit" className="button primary" disabled={saveSettings.isPending} data-testid="button-save-fom-settings">
            {saveSettings.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      </form>
    </Panel>}

    {status && <>
      {pull ? <div className={`integration-banner ${status.connected ? 'connected' : 'disconnected'}`} data-testid="status-fom-connection">
        <div className="integration-icon">{status.connected ? <Check size={20} /> : <AlertCircle size={20} />}</div>
        <div><span className="eyebrow">APTEKA BAZASI (F-APTEKA)</span><b>{status.connected ? 'Apteka kompyuteri orqali ulangan' : status.configured ? 'Apteka kompyuteri bilan aloqa yoʻq — kompyuter yoqilgan va internetga ulanganini tekshiring' : 'Ulanish sozlanmagan'}</b>
          <span>Filiallar: {status.filialIds.length ? `jami ${status.filialIds.length} ta` : 'avtomatik aniqlanadi'} · {status.intervalMinutes > 0 ? 'yangi hujjatlar avtomatik qoʻshilib boradi' : 'avto-yangilanish oʻchirilgan'}{status.refsAt ? ` · maʼlumotnomalar: ${dateTime(status.refsAt)}` : ''}</span></div>
        <StatusBadge tone={status.connected ? 'good' : status.configured ? 'bad' : 'warn'}>{status.connected ? 'Ulangan' : status.configured ? 'Javob yoʻq' : 'Sozlanmagan'}</StatusBadge>
      </div> : <div className={`integration-banner ${status.connected ? 'connected' : 'disconnected'}`} data-testid="status-fom-connection">
        <div className="integration-icon">{status.connected ? <Check size={20} /> : <AlertCircle size={20} />}</div>
        <div><span className="eyebrow">APTEKA → PHARMXS</span><b>{status.site.lastAt ? `Oxirgi qabul: ${dateTime(status.site.lastAt)}` : 'Apteka kompyuteridan hali maʼlumot kelmagan'}</b>
          <span>{status.site.configured
            ? (status.site.lastMessage
              ? status.site.lastMessage
              : 'Token sozlangan. SITE.exe apteka kompyuterida ishga tushgach, qoldiqlar shu yerga oʻzi keladi.')
            : 'FOM_SITE_TOKEN sozlanmagan: server .env fayliga qoʻshing va API ni qayta ishga tushiring.'}</span></div>
        <StatusBadge tone={status.connected ? 'good' : status.site.configured ? 'warn' : 'bad'}>{status.connected ? 'Maʼlumot kelyapti' : status.site.configured ? 'Kutilmoqda' : 'Token yoʻq'}</StatusBadge>
      </div>}

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
        {pull && <Panel
          title="Manbalar (F-APTEKA bazasi)"
          subtitle={
            status.running
              ? `Tortilmoqda · oyna ${status.windowDays ?? 31} kun · ${status.chunkSummary ? `tayyor ${status.chunkSummary.done}/${(status.chunkSummary.done + status.chunkSummary.running + status.chunkSummary.pending + status.chunkSummary.error)}` : ''}`
              : status.lastSyncAt
                ? `Oxirgi yangilanish: ${dateTime(status.lastSyncAt)} (Toshkent)`
                : 'Hali sinxronlanmagan'
          }
          data-testid="panel-fom-sources"
        >
          {status.running && status.progress?.total ? (
            <div className="fom-progress-bar" data-testid="fom-overall-progress">
              <div
                className="fom-progress-fill"
                style={{ width: `${Math.min(99, Math.floor((status.progress.done * 100) / Math.max(1, status.progress.total)))}%` }}
              />
              <span>
                Jami {Math.min(99, Math.floor((status.progress.done * 100) / Math.max(1, status.progress.total)))}%
                · {status.progress.done}/{status.progress.total}
              </span>
            </div>
          ) : null}
          <div className="source-list">{status.reports.map(report => {
            const stats = reportChunkStats(status.chunks, report.key);
            const count = report.imported ?? stats?.rows ?? null;
            const pct = stats?.pct ?? (report.imported != null ? 100 : null);
            return (
              <div className="source-row" key={report.key} data-testid={`row-fom-report-${report.key}`}>
                <div className="source-name">
                  <b>{report.label}</b>
                  <small>
                    {report.target}
                    {stats ? ` · ${stats.done}/${stats.total} oyna` : ''}
                    {pct != null && status.running ? ` · ${pct}%` : ''}
                  </small>
                  {report.error && <small className="error-line">{report.error}</small>}
                  {report.warning && <small className="error-line warn">{report.warning}</small>}
                  {stats && status.running ? (
                    <div className="fom-report-meter" aria-hidden>
                      <i style={{ width: `${pct ?? 0}%` }} />
                    </div>
                  ) : null}
                </div>
                <div className="source-count" title="Shu yangilanishda yozilgan / o‘qilgan">
                  <b>{count != null ? count.toLocaleString('uz-UZ') : '—'}</b>
                  <small>{stats && status.running && report.imported == null ? `o‘qildi ${stats.rows.toLocaleString('uz-UZ')}` : 'yozuv'}</small>
                </div>
                <ReportStatus report={report} running={status.running} pct={pct} />
              </div>
            );
          })}</div>
        </Panel>}

        <div className="form-stack">
          {pull && <Panel title="Sinxronlash" subtitle="Tez tortish: oylik oyna + parallel agent; foiz har manbada yangilanadi">
            <div className="data-range" data-testid="fom-data-range">
              <span className="eyebrow">PHARMXS BAZASIDA</span>
              {status.dataRanges.map(rangeRow => <div className="data-range-row" key={rangeRow.key}>
                <span>{rangeRow.label}</span>
                <b>{rangeRow.from ? `${dateTime(rangeRow.from)} — ${dateTime(rangeRow.to)}` : 'hali yoʻq'}</b>
                <small>{rangeRow.count.toLocaleString('ru-RU').replace(/\u00a0/g, ' ')} ta</small>
              </div>)}
            </div>
            <div className="sync-status"><div className={`sync-orb ${status.running ? 'running' : status.lastSyncStatus}`}><RefreshCw size={19} className={status.running ? 'spin' : ''} /></div>
              <div className="sync-text"><span>Oxirgi sinxronlash</span><b>{status.lastSyncAt ? dateTime(status.lastSyncAt) : 'Hali bajarilmagan'}</b><small>{status.lastMessage ?? '—'}</small></div>
              {syncState && <StatusBadge tone={syncState.tone}>{status.running && status.progress?.total ? `${Math.min(99, Math.floor((status.progress.done * 100) / Math.max(1, status.progress.total)))}%` : syncState.label}</StatusBadge>}</div>
            {canEdit && <form className="form-grid" onSubmit={e => runSync(e, 'range')}>
              <label>Boshlanish<input type="date" required value={range.from} onChange={e => {
                const from = e.target.value;
                setRange(r => ({ from, to: r.to && r.to < from ? from : r.to }));
              }} data-testid="input-fom-from" /></label>
              <label>Tugash<input type="date" required value={range.to} min={range.from || undefined} onChange={e => setRange({ ...range, to: e.target.value })} data-testid="input-fom-to" /></label>
              <button className="button primary span-2" disabled={!status.configured || status.running || sync.isPending} data-testid="button-sync-range"><RefreshCw size={15} />12.11.2026 → bugun qoʻshib tortish</button>
            </form>}
            <p className="field-hint">Har ~15 daqiqada yangi kunlar avtomatik qoʻshiladi (eski yozuvlar oʻchmaydi). Boʻsh filial = FOM toʻlovi yoʻq.</p>
          </Panel>}
        </div>
      </div>
    </>}
  </>;
}
