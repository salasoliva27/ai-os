// Talend bridge module — pulls REECE TMC artifacts + schedules from Qlik
// Talend Cloud (us-west region, auth-confirmed earlier).
//
// IMPORTANT: this iteration uses the *artifact* + *schedule* endpoints, not
// `/orchestration/executables` — that path 404s with the user's current PAT
// scopes (Operator + Assets Management + Integration Developer). Once we
// know the correct task endpoint for this tenant we can layer it on top
// without changing the panel shape.
//
// Each "job" surfaced to the dashboard combines:
//   - One artifact (the published code; from /orchestration/artifacts).
//   - Zero or more schedules pointing at it (from /orchestration/schedules).
// The artifact's id ≠ a schedule's executableId (the schedule references the
// runnable wrapper task, not the artifact), so cross-reference is name-based
// when we can't get a direct ID match.

import { readVarFromDotfiles } from "./agent-registry.js";
import type { ServerMessage } from "./types.js";

const POLL_MS = 5 * 60 * 1000; // 5 min
const REGIONS = [
  { id: "us-west", base: "https://api.us-west.cloud.talend.com" },
  { id: "us",      base: "https://api.us.cloud.talend.com" },
  { id: "eu",      base: "https://api.eu.cloud.talend.com" },
  { id: "ap",      base: "https://api.ap.cloud.talend.com" },
];

function envOrDotfile(name: string): string {
  const v = process.env[name];
  if (typeof v === "string" && v.length > 0) return v;
  return readVarFromDotfiles(name) ?? "";
}

interface TalendConfig { token: string; base: string; region: string }

let cachedConfig: TalendConfig | null = null;

async function detectRegion(token: string): Promise<TalendConfig | null> {
  for (const r of REGIONS) {
    try {
      const resp = await fetch(`${r.base}/orchestration/environments`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (resp.ok) return { token, base: r.base, region: r.id };
    } catch { /* try next */ }
  }
  return null;
}

async function loadConfig(): Promise<TalendConfig | null> {
  if (cachedConfig) return cachedConfig;
  const token = envOrDotfile("TALEND_API_KEY");
  if (!token) return null;
  cachedConfig = await detectRegion(token);
  return cachedConfig;
}

function talendHeaders(cfg: TalendConfig): HeadersInit {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/json",
    "User-Agent": "janus-talend-panel",
  };
}

export interface TalendJob {
  id: string;                     // artifact id
  name: string;
  workspace: string;
  workspaceId: string;
  environment: string;
  environmentId: string;
  description: string;
  artifactType: string | null;    // standard / route / plan etc.
  versions: string[];             // newest first
  latestVersion: string | null;
  // Schedule info, if a schedule exists referencing an executable in this
  // env that's plausibly tied to this artifact (name-prefix heuristic).
  scheduleEnabled: boolean;
  scheduleSummary: string | null;
  // No last-execution data until we find the right endpoint:
  lastExecutionId: string | null;
  lastStatus: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  artifactName: string | null;    // duplicate of name; kept for UI compatibility
}

interface RawArtifact {
  id: string;
  name: string;
  type?: string;
  description?: string;
  versions?: string[];
  workspace?: { id: string; name: string; description?: string; environment?: { id: string; name: string } };
}

interface RawSchedule {
  id: string;
  description?: string;
  executableId: string;
  executableType?: string;
  environmentId?: string;
  triggers?: Array<{
    type?: string;            // DAILY / WEEKLY / CRON ...
    interval?: number;
    startDate?: string;
    timeZone?: string;
    atTimes?: { type?: string; times?: string[] };
    expression?: string;
    name?: string;
  }>;
}

async function fetchAllPaginated<T>(cfg: TalendConfig, path: string): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  const limit = 100;
  for (let safety = 0; safety < 50; safety++) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${cfg.base}${path}${sep}limit=${limit}&offset=${offset}`;
    const r = await fetch(url, { headers: talendHeaders(cfg), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) break;
    const data = await r.json() as { items?: T[] } | T[];
    const items = Array.isArray(data) ? data : (data.items ?? []);
    out.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }
  return out;
}

function summarizeTriggers(triggers: RawSchedule["triggers"]): string {
  if (!triggers || triggers.length === 0) return "(no trigger)";
  const t = triggers[0];
  if (!t) return "(no trigger)";
  if (t.type === "CRON" && t.expression) return `cron ${t.expression}${t.timeZone ? ` ${t.timeZone}` : ""}`;
  const tz = t.timeZone ? ` ${t.timeZone}` : "";
  const at = t.atTimes?.times?.length ? ` at ${t.atTimes.times.join(", ")}` : "";
  if (t.type === "DAILY") return `daily${at}${tz}`;
  if (t.type === "WEEKLY") return `weekly${at}${tz}`;
  if (t.type === "MONTHLY") return `monthly${at}${tz}`;
  if (t.type === "ONCE") return `once${at}${tz}`;
  return (t.type ?? "scheduled").toLowerCase() + at + tz;
}

let lastJobs: TalendJob[] = [];
let lastError: string | null = null;
let lastFetchedAt: string | null = null;
let lastSchedulesByEnv: Map<string, RawSchedule[]> = new Map();

export async function pollTalendOnce(broadcast: (m: ServerMessage) => void): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg) {
    lastError = "TALEND_API_KEY missing or no Talend region accepted the token";
    return;
  }
  try {
    const [artifacts, schedules] = await Promise.all([
      fetchAllPaginated<RawArtifact>(cfg, "/orchestration/artifacts"),
      fetchAllPaginated<RawSchedule>(cfg, "/orchestration/schedules"),
    ]);

    // Bucket schedules by environment so artifact→schedule cross-reference
    // doesn't need to scan the whole list per artifact. Within an env, match
    // by name-prefix between schedule.description (often the task name) and
    // the artifact name. It's heuristic — the real link only exists if we
    // can hit /executables — but it gets the user something useful today.
    const byEnv = new Map<string, RawSchedule[]>();
    for (const s of schedules) {
      const e = s.environmentId ?? "";
      const arr = byEnv.get(e) ?? [];
      arr.push(s);
      byEnv.set(e, arr);
    }
    lastSchedulesByEnv = byEnv;

    const jobs: TalendJob[] = artifacts.map((a) => {
      const ws = a.workspace;
      const envId = ws?.environment?.id ?? "";
      const candidates = byEnv.get(envId) ?? [];
      const matches = candidates.filter((s) => {
        const desc = (s.description ?? "").toLowerCase();
        return desc && a.name && desc.includes(a.name.toLowerCase());
      });
      const versions = (a.versions ?? []).slice().sort().reverse();
      return {
        id: a.id,
        name: a.name,
        workspace: ws?.name ?? "",
        workspaceId: ws?.id ?? "",
        environment: ws?.environment?.name ?? "",
        environmentId: envId,
        description: a.description ?? "",
        artifactType: a.type ?? null,
        versions,
        latestVersion: versions[0] ?? null,
        scheduleEnabled: matches.length > 0,
        scheduleSummary: matches.length > 0 ? summarizeTriggers(matches[0].triggers) : null,
        lastExecutionId: null,
        lastStatus: null,
        lastStartedAt: null,
        lastFinishedAt: null,
        artifactName: a.name,
      };
    });

    lastJobs = jobs;
    lastError = null;
    lastFetchedAt = new Date().toISOString();
    broadcast({ type: "talend_jobs_set", jobs } as ServerMessage);
    console.log(`[talend] fetched ${jobs.length} artifacts, ${schedules.length} schedules (${cfg.region})`);
  } catch (err) {
    lastError = String(err instanceof Error ? err.message : err);
    console.error("[talend] fetch failed:", lastError);
  }
}

export function startTalendPolling(broadcast: (m: ServerMessage) => void): NodeJS.Timeout {
  pollTalendOnce(broadcast).catch(() => {});
  return setInterval(() => {
    pollTalendOnce(broadcast).catch(() => {});
  }, POLL_MS);
}

export function sendTalendSnapshot(send: (m: ServerMessage) => void): void {
  send({ type: "talend_jobs_set", jobs: lastJobs } as ServerMessage);
}

export function talendSnapshot(): {
  configured: boolean;
  region: string | null;
  jobsCount: number;
  schedulesCount: number;
  lastFetchedAt: string | null;
  lastError: string | null;
  byEnvironment: Record<string, number>;
  byWorkspace: Record<string, number>;
  byType: Record<string, number>;
} {
  const byEnv: Record<string, number> = {};
  const byWs: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let totalSchedules = 0;
  for (const arr of lastSchedulesByEnv.values()) totalSchedules += arr.length;
  for (const j of lastJobs) {
    byEnv[j.environment || "(none)"] = (byEnv[j.environment || "(none)"] ?? 0) + 1;
    byWs[j.workspace || "(none)"] = (byWs[j.workspace || "(none)"] ?? 0) + 1;
    if (j.artifactType) byType[j.artifactType] = (byType[j.artifactType] ?? 0) + 1;
  }
  return {
    configured: !!cachedConfig,
    region: cachedConfig?.region ?? null,
    jobsCount: lastJobs.length,
    schedulesCount: totalSchedules,
    lastFetchedAt,
    lastError,
    byEnvironment: byEnv,
    byWorkspace: byWs,
    byType,
  };
}

export function getCachedJobs(): TalendJob[] {
  return lastJobs;
}

export interface TalendExecutionRecord {
  executionId: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
}

/** No execution endpoint discovered yet for this PAT scope — return empty.
 *  Kept as a stub so the existing panel + endpoint shape don't churn. */
export async function fetchExecutionsFor(_executableId: string, _limit = 20): Promise<TalendExecutionRecord[]> {
  return [];
}

/** Run-now blocked until /executables resolves — return descriptive error. */
export async function triggerJob(_executableId: string): Promise<{ ok: boolean; executionId?: string; error?: string }> {
  return {
    ok: false,
    error: "Run-now disabled: /orchestration/executables endpoint not reachable with current PAT scope. Re-mint the Talend PAT with the 'Execute Tasks and Plans' role to enable this.",
  };
}

// ── Schedule management (works with current PAT) ─────────────────────────

export interface TalendScheduleSummary {
  id: string;
  description: string;
  executableId: string;
  executableType: string;
  environmentId: string;
  trigger: {
    type: string;
    expression?: string;
    timeZone?: string;
    atTimes?: string[];
    interval?: number;
    startDate?: string;
    name?: string;
  } | null;
}

function shapeSchedule(s: RawSchedule): TalendScheduleSummary {
  const t = s.triggers?.[0];
  return {
    id: s.id,
    description: s.description ?? "",
    executableId: s.executableId,
    executableType: s.executableType ?? "",
    environmentId: s.environmentId ?? "",
    trigger: t ? {
      type: t.type ?? "",
      expression: t.expression,
      timeZone: t.timeZone,
      atTimes: t.atTimes?.times,
      interval: t.interval,
      startDate: t.startDate,
      name: t.name,
    } : null,
  };
}

/** All schedules currently cached. Used by the dashboard to power the
 *  schedule mgmt UI inside each artifact drawer. */
export function getCachedSchedules(): TalendScheduleSummary[] {
  const out: TalendScheduleSummary[] = [];
  for (const arr of lastSchedulesByEnv.values()) {
    for (const s of arr) out.push(shapeSchedule(s));
  }
  return out;
}

interface ScheduleTriggerInput {
  type: "DAILY" | "WEEKLY" | "MONTHLY" | "CRON" | "ONCE";
  timeZone?: string;
  atTimes?: string[];      // e.g. ["09:00", "17:00"] for DAILY/WEEKLY
  expression?: string;     // for CRON
  interval?: number;       // every N days/weeks
  startDate?: string;      // ISO yyyy-mm-dd
  name?: string;
}

interface ScheduleInput {
  executableId: string;
  environmentId: string;
  description?: string;
  trigger: ScheduleTriggerInput;
}

function buildScheduleBody(input: ScheduleInput) {
  return {
    executableId: input.executableId,
    environmentId: input.environmentId,
    description: input.description ?? "",
    triggers: [{
      type: input.trigger.type,
      timeZone: input.trigger.timeZone ?? "America/Chicago",
      ...(input.trigger.atTimes?.length ? { atTimes: { type: "AT_SPECIFIC_TIMES", times: input.trigger.atTimes } } : {}),
      ...(input.trigger.expression ? { expression: input.trigger.expression } : {}),
      ...(input.trigger.interval ? { interval: input.trigger.interval } : {}),
      ...(input.trigger.startDate ? { startDate: input.trigger.startDate } : {}),
      ...(input.trigger.name ? { name: input.trigger.name } : { name: `${input.trigger.type.toLowerCase()}-${Date.now()}` }),
    }],
  };
}

export async function createSchedule(input: ScheduleInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const cfg = await loadConfig();
  if (!cfg) return { ok: false, error: "Talend not configured" };
  try {
    const r = await fetch(`${cfg.base}/orchestration/schedules`, {
      method: "POST",
      headers: { ...talendHeaders(cfg), "Content-Type": "application/json" },
      body: JSON.stringify(buildScheduleBody(input)),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok || r.status === 201) {
      const data = await r.json().catch(() => ({})) as { id?: string };
      return { ok: true, id: data.id };
    }
    const txt = await r.text().catch(() => "");
    return { ok: false, error: `${r.status}: ${txt.slice(0, 400)}` };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}

export async function updateSchedule(scheduleId: string, input: ScheduleInput): Promise<{ ok: boolean; error?: string }> {
  const cfg = await loadConfig();
  if (!cfg) return { ok: false, error: "Talend not configured" };
  try {
    const r = await fetch(`${cfg.base}/orchestration/schedules/${encodeURIComponent(scheduleId)}`, {
      method: "PUT",
      headers: { ...talendHeaders(cfg), "Content-Type": "application/json" },
      body: JSON.stringify(buildScheduleBody(input)),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok || r.status === 204) return { ok: true };
    const txt = await r.text().catch(() => "");
    return { ok: false, error: `${r.status}: ${txt.slice(0, 400)}` };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}

export async function deleteSchedule(scheduleId: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = await loadConfig();
  if (!cfg) return { ok: false, error: "Talend not configured" };
  try {
    const r = await fetch(`${cfg.base}/orchestration/schedules/${encodeURIComponent(scheduleId)}`, {
      method: "DELETE",
      headers: talendHeaders(cfg),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok || r.status === 204) return { ok: true };
    const txt = await r.text().catch(() => "");
    return { ok: false, error: `${r.status}: ${txt.slice(0, 400)}` };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}
