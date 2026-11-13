import { randomBytes } from "node:crypto";
import { fomDate } from "./fomClient";

export type AgentFetchJob = {
  id: string;
  organizationId: number;
  reportId: number;
  filialId: string;
  from: string; // dd.mm.yyyy
  to: string;
  createdAt: number;
};

type Pending = {
  job: AgentFetchJob;
  resolve: (xml: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

const pendingByOrg = new Map<number, Pending[]>();
const pendingById = new Map<string, Pending>();

function orgQueue(organizationId: number): Pending[] {
  let q = pendingByOrg.get(organizationId);
  if (!q) {
    q = [];
    pendingByOrg.set(organizationId, q);
  }
  return q;
}

/** Platform sync waits here; pharmacy agent fulfills via poll/result. */
export function requestAgentFetch(opts: {
  organizationId: number;
  reportId: number;
  filialId: string;
  from: Date;
  to: Date;
  timeoutMs: number;
}): Promise<string> {
  const id = `aj_${randomBytes(12).toString("base64url")}`;
  const job: AgentFetchJob = {
    id,
    organizationId: opts.organizationId,
    reportId: opts.reportId,
    filialId: opts.filialId,
    from: fomDate(opts.from),
    to: fomDate(opts.to),
    createdAt: Date.now(),
  };
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      drop(id);
      reject(new Error("Dorixona kompyuteri FOM soʻroviga javob bermadi (agent offline yoki REPORT sekin)."));
    }, Math.max(15_000, opts.timeoutMs));
    const item: Pending = { job, resolve, reject, timer };
    pendingById.set(id, item);
    orgQueue(opts.organizationId).push(item);
  });
}

function drop(id: string) {
  const item = pendingById.get(id);
  if (!item) return;
  clearTimeout(item.timer);
  pendingById.delete(id);
  const q = pendingByOrg.get(item.job.organizationId);
  if (q) {
    const i = q.findIndex((x) => x.job.id === id);
    if (i >= 0) q.splice(i, 1);
  }
}

export function takeAgentJobs(organizationId: number, limit = 4): AgentFetchJob[] {
  const q = orgQueue(organizationId);
  return q.slice(0, Math.max(1, limit)).map((x) => x.job);
}

export function completeAgentJob(id: string, xml: string): boolean {
  const item = pendingById.get(id);
  if (!item) return false;
  drop(id);
  item.resolve(xml);
  return true;
}

export function failAgentJob(id: string, message: string): boolean {
  const item = pendingById.get(id);
  if (!item) return false;
  drop(id);
  item.reject(new Error(message || "Agent fetch failed"));
  return true;
}

export function pendingAgentJobCount(organizationId: number): number {
  return orgQueue(organizationId).length;
}
