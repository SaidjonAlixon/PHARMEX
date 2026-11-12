import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { OwnerShell } from './shell';
import { PageHeader, formatDate, ownerApi } from './shared';

type FomSettings = {
  source: string;
  protocol: 'http' | 'https';
  host: string;
  port: number | null;
  reportUrl: string;
  filialIds: string[];
  intervalMinutes: number;
  initialDays: number;
  timeoutSeconds?: number;
  hasApiToken?: boolean;
  updatedAt?: string | null;
};

export function OwnerSettingsPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [protocol, setProtocol] = useState<'http' | 'https'>('http');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [filialIds, setFilialIds] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState('60');
  const [initialDays, setInitialDays] = useState('30');
  const [timeoutSeconds, setTimeoutSeconds] = useState('30');
  const [apiToken, setApiToken] = useState('');

  const q = useQuery({
    queryKey: ['owner-fom-settings'],
    queryFn: () => ownerApi<FomSettings>('/api/fom/settings'),
  });

  useEffect(() => {
    if (!q.data) return;
    setProtocol(q.data.protocol || 'http');
    setHost(q.data.host || '');
    setPort(q.data.port != null ? String(q.data.port) : '');
    setFilialIds((q.data.filialIds || []).join(', '));
    setIntervalMinutes(String(q.data.intervalMinutes || 60));
    setInitialDays(String(q.data.initialDays || 30));
    setTimeoutSeconds(String(q.data.timeoutSeconds || 30));
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      ownerApi('/api/fom/settings', {
        method: 'PUT',
        body: JSON.stringify({
          protocol,
          host: host.trim(),
          port: port.trim() ? Number(port) : null,
          filialIds: filialIds.trim(),
          intervalMinutes: Number(intervalMinutes) || 60,
          initialDays: Number(initialDays) || 30,
          timeoutSeconds: Number(timeoutSeconds) || 30,
          apiToken: apiToken.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      setMsg('FOM sozlamalari saqlandi');
      setApiToken('');
      void qc.invalidateQueries({ queryKey: ['owner-fom-settings'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const test = useMutation({
    mutationFn: () => ownerApi<{ status: string; message: string }>('/api/fom/test', { method: 'POST' }),
    onSuccess: (r) => setMsg(r.message || r.status),
    onError: (e: Error) => setMsg(e.message),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <OwnerShell>
      <PageHeader
        title="Tizim sozlamalari"
        text="FOM F-APTEKA integratsiyasi va platforma xavfsizlik eslatmalari."
      />
      {msg && <div className="notice">{msg}</div>}
      <section className="ocrm-card">
        <div className="ocrm-card-head">
          <h2>FOM REPORT.exe</h2>
          <span className="muted-line">
            Manba: {q.data?.source || '—'}
            {q.data?.updatedAt ? ` · ${formatDate(q.data.updatedAt)}` : ''}
          </span>
        </div>
        <form className="ocrm-plan-form" onSubmit={onSubmit}>
          <div className="ocrm-plan-grid">
            <label>
              Protokol
              <select value={protocol} onChange={(e) => setProtocol(e.target.value as 'http' | 'https')}>
                <option value="http">http</option>
                <option value="https">https</option>
              </select>
            </label>
            <label>
              Host / IP
              <input required value={host} onChange={(e) => setHost(e.target.value)} placeholder="84.54.70.12" />
            </label>
            <label>
              Port
              <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="8080" />
            </label>
            <label>
              Filial ID lari
              <input value={filialIds} onChange={(e) => setFilialIds(e.target.value)} placeholder="1, 2, 3" />
            </label>
            <label>
              Interval (daqiqa)
              <input type="number" min={5} value={intervalMinutes} onChange={(e) => setIntervalMinutes(e.target.value)} />
            </label>
            <label>
              Boshlangʻich kunlar
              <input type="number" min={1} value={initialDays} onChange={(e) => setInitialDays(e.target.value)} />
            </label>
            <label>
              Timeout (soniya)
              <input type="number" min={5} value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(e.target.value)} />
            </label>
            <label>
              API token {q.data?.hasApiToken ? '(saqlangan)' : ''}
              <input value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder="Yangi token (ixtiyoriy)" />
            </label>
          </div>
          <div className="owner-actions-row">
            <button type="submit" className="button primary" disabled={save.isPending}>Saqlash</button>
            <button type="button" className="button ghost" disabled={test.isPending} onClick={() => test.mutate()}>
              Ulanishni tekshirish
            </button>
          </div>
        </form>
      </section>
      <section className="ocrm-card">
        <h2>Xavfsizlik</h2>
        <p className="muted-line" style={{ margin: 0 }}>
          Owner panel faqat maxsus IP/host orqali ochiladi. Kompaniya kabineti domen orqali ishlaydi.
          Multi-tenant filtrlar backendda fail-closed — har bir kompaniya faqat oʻz maʼlumotini koʻradi.
        </p>
      </section>
    </OwnerShell>
  );
}
