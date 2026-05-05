// Greedy scheduler — turns each project's Next Steps into calendar events
// laid out across the user's available work blocks, without overlap.
//
// Rules (matches docs/status-md-schema.md):
//   - One task slot per day per project (avoid context-switching cost).
//   - Tasks ordered globally by priority (P1 > P2 > P3), then by project.
//   - Working window: 15:00–20:00 weekdays. Saturdays are overflow (10:00–14:00).
//     Sundays are skipped.
//   - Only tasks from projects whose `status` is "active" get scheduled.
//   - Done tasks (checkbox checked) are skipped.

import type { NextStep, Priority } from "./status-parser.js";

export interface SchedulableProject {
  id: string;
  name: string;
  color: string;
  status: string;
  nextSteps: NextStep[];
}

export interface ScheduledEvent {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  start: string;       // ISO datetime
  end: string;         // ISO datetime
  priority: Priority;
  color: string;
  notes?: string;
}

const PRIORITY_RANK: Record<Priority, number> = { P1: 0, P2: 1, P3: 2 };

interface Slot { date: Date; startHour: number; endHour: number }

function dayOfWeek(d: Date): number { return d.getDay(); }

function makeSlot(d: Date, startHour: number, endHour: number): Slot {
  const slot = new Date(d);
  slot.setHours(0, 0, 0, 0);
  return { date: slot, startHour, endHour };
}

function nextWorkingSlot(after: Date): Slot {
  const d = new Date(after);
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 14; i++) {
    const dow = dayOfWeek(d);
    if (dow >= 1 && dow <= 5) return makeSlot(d, 15, 20);  // weekday 15-20
    if (dow === 6) return makeSlot(d, 10, 14);             // Saturday 10-14
    d.setDate(d.getDate() + 1); // skip Sunday
  }
  return makeSlot(after, 15, 20); // fallback
}

function advanceDay(d: Date): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  return next;
}

function isoFromDateAndHours(d: Date, hours: number): string {
  const dt = new Date(d);
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);
  dt.setHours(wholeHours, minutes, 0, 0);
  return dt.toISOString();
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface QueuedTask {
  task: NextStep;
  project: SchedulableProject;
}

export function scheduleProjects(projects: SchedulableProject[], from: Date = new Date()): ScheduledEvent[] {
  const queue: QueuedTask[] = [];
  for (const p of projects) {
    if (p.status !== "active") continue;
    for (const t of p.nextSteps) {
      if (t.done) continue;
      queue.push({ task: t, project: p });
    }
  }

  // Global priority sort, stable within same priority by project name + task index.
  queue.sort((a, b) => {
    const r = PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority];
    if (r !== 0) return r;
    return a.project.name.localeCompare(b.project.name);
  });

  // Track per-day state:
  //   - which projects already have a task on this day (one-per-day-per-project rule)
  //   - the next free hour for the day
  const dayState = new Map<string, { usedProjects: Set<string>; nextFreeHour: number; endHour: number }>();
  function ensureDay(slot: Slot) {
    const k = dateKey(slot.date);
    let s = dayState.get(k);
    if (!s) {
      s = { usedProjects: new Set(), nextFreeHour: slot.startHour, endHour: slot.endHour };
      dayState.set(k, s);
    }
    return s;
  }

  const events: ScheduledEvent[] = [];
  let cursor = nextWorkingSlot(from);
  let overflowGuard = 0;

  for (const q of queue) {
    let placed = false;
    let tryDate = cursor.date;
    while (!placed && overflowGuard++ < 365) {
      const slot = nextWorkingSlot(tryDate);
      const ds = ensureDay(slot);

      const fits = (ds.endHour - ds.nextFreeHour) >= Math.min(q.task.effortHours, 1); // need at least 1h
      const projectAlreadyOnDay = ds.usedProjects.has(q.project.id);

      if (fits && !projectAlreadyOnDay) {
        const startHour = ds.nextFreeHour;
        const endHour = Math.min(ds.endHour, startHour + q.task.effortHours);
        events.push({
          id: `sch-${q.project.id}-${q.task.id}`,
          projectId: q.project.id,
          projectName: q.project.name,
          title: q.task.title,
          start: isoFromDateAndHours(slot.date, startHour),
          end: isoFromDateAndHours(slot.date, endHour),
          priority: q.task.priority,
          color: q.project.color,
        });
        ds.nextFreeHour = endHour;
        ds.usedProjects.add(q.project.id);
        placed = true;
      } else {
        tryDate = advanceDay(slot.date);
      }
    }
  }

  return events;
}
