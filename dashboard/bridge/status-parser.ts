// `.janus/status.md` parser.
//
// Schema is defined in docs/status-md-schema.md. This parser is intentionally
// regex-based (no YAML library dependency) because the schema is small, flat,
// and we control both ends. If the file shape ever grows a nested structure,
// reach for a real YAML parser (`yaml` package) instead.

export type Stage = "idea" | "dev" | "uat" | "prod";
export type StatusValue = "active" | "paused" | "done" | "archived";
export type Priority = "P1" | "P2" | "P3";

export interface NextStep {
  id: string;          // stable hash of project + title
  title: string;
  priority: Priority;
  effortHours: number; // decoded from "30m" / "2h" / "1d"
  done: boolean;
}

export interface Milestone {
  date: string;        // ISO YYYY-MM-DD
  description: string;
}

export interface CalendarEntry {
  date: string;        // YYYY-MM-DD
  startTime: string;   // HH:MM
  endTime: string;     // HH:MM
  title: string;
}

export interface ParsedStatus {
  status: StatusValue;
  stage: Stage;
  phase: string;
  phaseProgress: number;    // 0..1
  summary: string;
  owner?: string;
  nextSteps: NextStep[];
  milestones: Milestone[];
  calendar: CalendarEntry[];
}

const DEFAULT_PARSED: ParsedStatus = {
  status: "active",
  stage: "dev",
  phase: "",
  phaseProgress: 0,
  summary: "",
  nextSteps: [],
  milestones: [],
  calendar: [],
};

function parseFrontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

function sectionBody(text: string, heading: string): string {
  const re = new RegExp(`^##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "m");
  const m = text.match(re);
  return m ? m[1] : "";
}

function effortToHours(s: string): number {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(m|min|h|hr|d|day)?$/i);
  if (!m) return 2; // default 2h
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? "h").toLowerCase();
  if (unit.startsWith("m")) return n / 60;
  if (unit.startsWith("d")) return n * 6; // 1d = 6h focused work (matches schema doc)
  return n;
}

function hashId(parts: string[]): string {
  let h = 0;
  for (const p of parts) for (let i = 0; i < p.length; i++) h = (h * 31 + p.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function parseNextSteps(body: string, projectId: string): NextStep[] {
  const out: NextStep[] = [];
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*-\s+\[(\s|x|X)\]\s+(?:\[\s*(P[123])\s*(?:,\s*([^\]]+?))?\s*\]\s+)?(.+?)\s*$/);
    if (!m) continue;
    const done = m[1].toLowerCase() === "x";
    const priority = (m[2] as Priority | undefined) ?? "P2";
    const effortHours = m[3] ? effortToHours(m[3]) : 2;
    const title = m[4].trim();
    if (!title) continue;
    out.push({
      id: hashId([projectId, title]),
      title, priority, effortHours, done,
    });
  }
  return out;
}

function parseMilestones(body: string): Milestone[] {
  const out: Milestone[] = [];
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*-\s+(\d{4}-\d{2}-\d{2})\s+[—–-]\s+(.+?)\s*$/);
    if (!m) continue;
    out.push({ date: m[1], description: m[2].trim() });
  }
  return out;
}

function parseCalendar(body: string): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const line of body.split("\n")) {
    // - 2026-04-29 15:00–17:00 — Wire product catalog
    const m = line.match(/^\s*-\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})\s+[—–-]\s+(.+?)\s*$/);
    if (!m) continue;
    out.push({ date: m[1], startTime: m[2], endTime: m[3], title: m[4].trim() });
  }
  return out;
}

export function parseStatusMd(text: string, projectId: string): ParsedStatus {
  if (!text || text.trim().length === 0) return { ...DEFAULT_PARSED };
  const fm = parseFrontmatter(text);
  const stage = (["idea", "dev", "uat", "prod"].includes(fm.stage) ? fm.stage : "dev") as Stage;
  const status = (["active", "paused", "done", "archived"].includes(fm.status) ? fm.status : "active") as StatusValue;
  const phaseProgress = Math.max(0, Math.min(1, parseFloat(fm.phaseProgress ?? "0") || 0));

  return {
    status,
    stage,
    phase: fm.phase ?? "",
    phaseProgress,
    summary: fm.summary ?? "",
    owner: fm.owner,
    nextSteps: parseNextSteps(sectionBody(text, "Next Steps"), projectId),
    milestones: parseMilestones(sectionBody(text, "Milestones")),
    calendar: parseCalendar(sectionBody(text, "Calendar")),
  };
}
