import { useState, useMemo, useCallback, useEffect } from 'react';
import { useDashboard } from '../store';
import './CalendarPanel.css';

// ── Types ──

interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO datetime
  end: string;
  allDay: boolean;
  project?: string;
  color: string;
  notes?: string;
  priority?: 'P1' | 'P2' | 'P3';
}

type ViewMode = 'week' | 'month';

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6 AM to 11 PM
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const PROJECT_COLORS: Record<string, string> = {
  'espacio-bosques': '#5fd4d4',
  'lool-ai': '#a77bdb',
  'nutria': '#5fd47a',
  'longevite': '#d4a55f',
  'freelance': '#60a5fa',
  'mercado-bot': '#f4511e',
  'jp-ai': '#f6bf26',
  'janus-ia': '#7986cb',
  default: '#888',
};

// ── Real project events for April–May 2026 ──
// Based on PROJECTS.md next actions and current sprint work

function generateProjectEvents(): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  let id = 0;

  const add = (
    title: string,
    date: string,
    startH: number,
    endH: number,
    project: string,
    allDay = false,
  ) => {
    events.push({
      id: `ev-${id++}`,
      title,
      start: allDay ? date : `${date}T${String(startH).padStart(2, '0')}:00:00`,
      end: allDay ? date : `${date}T${String(endH).padStart(2, '0')}:00:00`,
      allDay,
      project,
      color: PROJECT_COLORS[project] || PROJECT_COLORS.default,
    });
  };

  // ── Week of Apr 13–19 (current week, today is Apr 16) ──
  add('Dashboard asset fix + localStorage guard', '2026-04-13', 15, 18, 'janus-ia');
  add('Memory MCP fix + npm install', '2026-04-14', 15, 17, 'janus-ia');
  add('Vault MCP path fix', '2026-04-14', 17, 18, 'janus-ia');
  add('JP-AI dashboard ship', '2026-04-15', 15, 20, 'jp-ai');
  add('Tools registry health check', '2026-04-15', 20, 21, 'janus-ia');
  add('Calendar panel build', '2026-04-16', 15, 18, 'janus-ia');
  add('Window resize + edge snapping', '2026-04-16', 18, 20, 'janus-ia');
  add('Espacio Bosques demo prep', '2026-04-17', 15, 18, 'espacio-bosques');
  add('Seed 5+ investors for vote threshold', '2026-04-17', 18, 20, 'espacio-bosques');
  add('Lool-AI attribution tracking', '2026-04-18', 15, 18, 'lool-ai');
  add('Weekend: flexible', '2026-04-19', 10, 14, 'freelance');

  // ── Week of Apr 20–26 ──
  add('Espacio Bosques first demo', '2026-04-20', 11, 14, 'espacio-bosques');
  add('Lool-AI embeddable widget', '2026-04-21', 15, 19, 'lool-ai');
  add('Lool-AI widget cont.', '2026-04-22', 15, 18, 'lool-ai');
  add('NutrIA Supabase schema', '2026-04-22', 18, 20, 'nutria');
  add('NutrIA Netlify deploy', '2026-04-23', 15, 17, 'nutria');
  add('NutrIA widget embed on Longevite', '2026-04-23', 17, 19, 'nutria');
  add('Longevite Netlify deploy', '2026-04-24', 15, 16, 'longevite');
  add('Longevite contact form + GA', '2026-04-24', 16, 18, 'longevite');
  add('Mercado Bot Python backend scaffold', '2026-04-25', 15, 19, 'mercado-bot');

  // ── Week of Apr 27 – May 3 ──
  add('JP-AI wire memory MCP', '2026-04-27', 15, 17, 'jp-ai');
  add('JP-AI Supabase ozum_memories table', '2026-04-27', 17, 19, 'jp-ai');
  add('JP-AI CRM Phase 1 — lead intake', '2026-04-28', 15, 20, 'jp-ai');
  add('JP-AI CRM Phase 1 cont.', '2026-04-29', 15, 20, 'jp-ai');
  add('JP-AI AI proposal generator', '2026-04-30', 15, 20, 'jp-ai');
  add('Freelance — first lead push', '2026-05-01', 15, 18, 'freelance');
  add('Mercado Bot Python agents', '2026-05-02', 15, 19, 'mercado-bot');
  add('Portfolio review + backlog check', '2026-05-03', 11, 14, 'janus-ia');

  // ── Week of May 4–10 ──
  add('Lool-AI first store pilot prep', '2026-05-04', 15, 18, 'lool-ai');
  add('Lool-AI store visit Roma/Condesa', '2026-05-05', 10, 14, 'lool-ai');
  add('Espacio Bosques Supabase persistent schema', '2026-05-06', 15, 19, 'espacio-bosques');
  add('JP-AI CRM Phase 2 — vendor DB', '2026-05-07', 15, 20, 'jp-ai');
  add('Mercado Bot SCAN+RESEARCH pipeline', '2026-05-08', 15, 19, 'mercado-bot');
  add('NutrIA Phase 1 internal test', '2026-05-09', 15, 18, 'nutria');

  return events;
}

// ── Helper functions ──

function getWeekDates(date: Date): Date[] {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(d);
    day.setDate(d.getDate() + i);
    return day;
  });
}

function getMonthDates(date: Date): Date[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const start = new Date(firstDay);
  start.setDate(start.getDate() - start.getDay());

  const end = new Date(lastDay);
  end.setDate(end.getDate() + (6 - end.getDay()));

  const dates: Date[] = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m} ${ampm}`;
}

// ── Availability indicator ──

function AvailabilityBar({ date }: { date: Date }) {
  const hour = 15; // 3 PM CDMX - Jano's start time
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const isToday = isSameDay(date, new Date());

  return (
    <div
      className={`cal-avail ${isToday ? 'cal-avail--today' : ''}`}
      title={isWeekend ? 'Weekend - flexible' : `Available from ${hour}:00 CDMX`}
    >
      <div className="cal-avail__bar" style={{
        background: isWeekend
          ? 'linear-gradient(90deg, rgba(95,212,122,0.15), rgba(95,212,122,0.05))'
          : 'linear-gradient(90deg, rgba(95,212,212,0.2), rgba(95,212,212,0.05))',
        width: isWeekend ? '100%' : '56%',
        marginLeft: isWeekend ? '0' : '50%',
      }} />
    </div>
  );
}

// ── Event details / edit modal ──

interface EventEditModalProps {
  event: CalendarEvent;
  onSave: (next: CalendarEvent) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string {
  return new Date(local).toISOString();
}

function durationLabel(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const PRIORITY_TINT: Record<string, string> = {
  P1: 'oklch(0.68 0.22 25)',
  P2: 'oklch(0.78 0.14 95)',
  P3: 'oklch(0.65 0.02 240)',
};

function EventEditModal({ event, onSave, onClose, onDelete }: EventEditModalProps) {
  const [title, setTitle] = useState(event.title);
  const [start, setStart] = useState(toLocalInput(event.start));
  const [end, setEnd] = useState(toLocalInput(event.end));
  const [project, setProject] = useState(event.project ?? '');
  const [priority, setPriority] = useState<'P1' | 'P2' | 'P3'>(event.priority ?? 'P2');
  const [notes, setNotes] = useState(event.notes ?? '');
  // View-first: show the read-only summary; user clicks Edit to expand the form.
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      ...event,
      title: title.trim() || event.title,
      start: fromLocalInput(start),
      end: fromLocalInput(end),
      project: project.trim() || undefined,
      priority,
      notes: notes.trim() || undefined,
    });
  }

  // Notes from the bridge come line-separated with "Project: …", "Task: …",
  // "Priority: …" labels. Split into a paragraph per line for readability.
  const notesLines = (event.notes ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  const priorityColor = PRIORITY_TINT[event.priority ?? 'P2'];

  return (
    <div className="cal-modal__backdrop" onClick={onClose}>
      <form
        className="cal-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSave}
      >
        <div className="cal-modal__header">
          <span className="cal-modal__color-dot" style={{ background: event.color }} />
          {editing ? (
            <input
              className="cal-modal__title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              placeholder="Task title"
            />
          ) : (
            <div className="cal-modal__title-input" style={{ border: 'none', background: 'transparent', padding: '0 4px', cursor: 'default' }}>
              {event.title}
            </div>
          )}
          <button type="button" className="cal-modal__close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {/* View summary — always visible above the (collapsed-by-default) form */}
        <div
          className="cal-modal__view"
          style={{
            padding: '10px 14px',
            borderBottom: editing ? '1px solid var(--border-color)' : 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            fontSize: 12,
            color: 'var(--color-text-secondary)',
          }}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {event.project && (
              <span
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 500, color: 'var(--color-text-primary)' }}
                title={`Project: ${event.project}`}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: event.color }} />
                {event.project}
              </span>
            )}
            {event.priority && (
              <span
                style={{
                  padding: '1px 6px',
                  borderRadius: 3,
                  fontFamily: 'var(--font-family-mono)',
                  fontSize: 10,
                  fontWeight: 600,
                  background: `color-mix(in oklch, ${priorityColor} 22%, transparent)`,
                  color: priorityColor,
                  border: `1px solid color-mix(in oklch, ${priorityColor} 40%, transparent)`,
                }}
              >
                {event.priority}
              </span>
            )}
            <span style={{ fontFamily: 'var(--font-family-mono)', fontSize: 11, color: 'var(--color-text-muted)' }}>
              {dateLabel(event.start)} · {formatTime(event.start)} – {formatTime(event.end)}
              <span style={{ marginLeft: 6, opacity: 0.7 }}>({durationLabel(event.start, event.end)})</span>
            </span>
          </div>
          {notesLines.length > 0 ? (
            <div style={{ lineHeight: 1.5 }}>
              {notesLines.map((line, i) => {
                const labelMatch = line.match(/^([A-Z][a-z]+):\s*(.+)$/);
                if (labelMatch) {
                  return (
                    <div key={i} style={{ display: 'flex', gap: 6 }}>
                      <span style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-family-mono)', fontSize: 10, minWidth: 60 }}>
                        {labelMatch[1].toLowerCase()}
                      </span>
                      <span>{labelMatch[2]}</span>
                    </div>
                  );
                }
                return <div key={i}>{line}</div>;
              })}
            </div>
          ) : (
            <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              No description yet. The active engine can add one by editing this project's <code>.janus/status.md</code> while you discuss planning.
            </div>
          )}
          {!editing && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="button"
                className="cal-modal__btn"
                onClick={() => setEditing(true)}
                style={{ fontSize: 11 }}
              >
                Edit
              </button>
            </div>
          )}
        </div>

        {editing && (
          <>
            <div className="cal-modal__row">
              <label className="cal-modal__label">Project</label>
              <input
                className="cal-modal__input"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="e.g. lool-ai"
              />
            </div>

            <div className="cal-modal__row cal-modal__row--split">
              <div>
                <label className="cal-modal__label">Start</label>
                <input
                  type="datetime-local"
                  className="cal-modal__input"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div>
                <label className="cal-modal__label">End</label>
                <input
                  type="datetime-local"
                  className="cal-modal__input"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
            </div>

            <div className="cal-modal__row">
              <label className="cal-modal__label">Priority</label>
              <div className="cal-modal__priority">
                {(['P1', 'P2', 'P3'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`cal-modal__priority-btn ${priority === p ? 'cal-modal__priority-btn--active' : ''}`}
                    onClick={() => setPriority(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="cal-modal__row">
              <label className="cal-modal__label">Notes</label>
              <textarea
                className="cal-modal__textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Context, links, blockers…"
                rows={3}
              />
            </div>

            <div className="cal-modal__footer">
              <button
                type="button"
                className="cal-modal__btn cal-modal__btn--ghost"
                onClick={() => onDelete(event.id)}
              >
                Delete
              </button>
              <div className="cal-modal__footer-right">
                <button type="button" className="cal-modal__btn" onClick={() => setEditing(false)}>Cancel</button>
                <button type="submit" className="cal-modal__btn cal-modal__btn--primary">Save</button>
              </div>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

// ── Week View ──

function WeekView({ currentDate, events, onSelect }: { currentDate: Date; events: CalendarEvent[]; onSelect: (ev: CalendarEvent) => void }) {
  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate]);
  const today = new Date();

  const getEventsForDay = useCallback((date: Date) => {
    return events.filter(e => {
      const eDate = new Date(e.start);
      return isSameDay(eDate, date);
    });
  }, [events]);

  return (
    <div className="cal-week">
      {/* Day headers */}
      <div className="cal-week__header">
        <div className="cal-week__gutter" />
        {weekDates.map(d => {
          const isToday = isSameDay(d, today);
          return (
            <div key={d.toISOString()} className={`cal-week__day-header ${isToday ? 'cal-week__day-header--today' : ''}`}>
              <span className="cal-week__day-name">{DAYS_SHORT[d.getDay()]}</span>
              <span className={`cal-week__day-num ${isToday ? 'cal-week__day-num--today' : ''}`}>{d.getDate()}</span>
            </div>
          );
        })}
      </div>

      {/* Availability row */}
      <div className="cal-week__avail-row">
        <div className="cal-week__gutter cal-week__gutter--label">avail</div>
        {weekDates.map(d => (
          <div key={`avail-${d.toISOString()}`} className="cal-week__avail-cell">
            <AvailabilityBar date={d} />
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div className="cal-week__body">
        <div className="cal-week__gutter">
          {HOURS.map(h => (
            <div key={h} className="cal-week__time-label">
              {h % 12 || 12}{h >= 12 ? 'p' : 'a'}
            </div>
          ))}
        </div>
        {weekDates.map(d => {
          const dayEvents = getEventsForDay(d);
          const isToday = isSameDay(d, today);
          return (
            <div key={d.toISOString()} className={`cal-week__column ${isToday ? 'cal-week__column--today' : ''}`}>
              {HOURS.map(h => (
                <div key={h} className="cal-week__cell">
                  {h === 15 && <div className="cal-week__available-line" title="3 PM - Available" />}
                </div>
              ))}
              {dayEvents.map(ev => {
                const startH = new Date(ev.start).getHours() + new Date(ev.start).getMinutes() / 60;
                const endH = new Date(ev.end).getHours() + new Date(ev.end).getMinutes() / 60;
                const top = ((startH - 6) / HOURS.length) * 100;
                const height = Math.max(((endH - startH) / HOURS.length) * 100, 3);
                return (
                  <button
                    key={ev.id}
                    type="button"
                    className="cal-week__event"
                    style={{
                      top: `${top}%`,
                      height: `${height}%`,
                      borderLeftColor: ev.color,
                      background: `linear-gradient(90deg, ${ev.color}18, transparent)`,
                    }}
                    title={`${ev.title}\n${formatTime(ev.start)} - ${formatTime(ev.end)} — click to edit`}
                    onClick={() => onSelect(ev)}
                  >
                    <span className="cal-week__event-time">{formatTime(ev.start)}</span>
                    <span className="cal-week__event-title">{ev.title}</span>
                  </button>
                );
              })}
              {/* Current time indicator */}
              {isToday && (() => {
                const now = new Date();
                const currentH = now.getHours() + now.getMinutes() / 60;
                if (currentH < 6 || currentH > 23) return null;
                const top = ((currentH - 6) / HOURS.length) * 100;
                return <div className="cal-week__now-line" style={{ top: `${top}%` }} />;
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Month View ──

function MonthView({ currentDate, events, onSelect }: { currentDate: Date; events: CalendarEvent[]; onSelect: (ev: CalendarEvent) => void }) {
  const monthDates = useMemo(() => getMonthDates(currentDate), [currentDate]);
  const today = new Date();
  const currentMonth = currentDate.getMonth();

  const getEventsForDay = useCallback((date: Date) => {
    return events.filter(e => {
      const eDate = new Date(e.start);
      return isSameDay(eDate, date);
    });
  }, [events]);

  return (
    <div className="cal-month">
      <div className="cal-month__header">
        {DAYS_SHORT.map(d => (
          <div key={d} className="cal-month__day-header">{d}</div>
        ))}
      </div>
      <div className="cal-month__grid">
        {monthDates.map(d => {
          const isToday = isSameDay(d, today);
          const isCurrentMonth = d.getMonth() === currentMonth;
          const dayEvents = getEventsForDay(d);

          return (
            <div
              key={d.toISOString()}
              className={`cal-month__cell ${isToday ? 'cal-month__cell--today' : ''} ${!isCurrentMonth ? 'cal-month__cell--other' : ''}`}
            >
              <span className={`cal-month__date ${isToday ? 'cal-month__date--today' : ''}`}>
                {d.getDate()}
              </span>
              <div className="cal-month__events">
                {dayEvents.slice(0, 3).map(ev => (
                  <button
                    key={ev.id}
                    type="button"
                    className="cal-month__event"
                    style={{ borderLeftColor: ev.color, background: `${ev.color}12` }}
                    title={`${ev.title}\n${formatTime(ev.start)} — click to edit`}
                    onClick={() => onSelect(ev)}
                  >
                    {ev.title}
                  </button>
                ))}
                {dayEvents.length > 3 && (
                  <div className="cal-month__more">+{dayEvents.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Calendar Panel ──

// localStorage key for in-flight edits before STATUS.md persistence is wired.
const CAL_OVERRIDES_KEY = 'janus-cal-overrides-v1';

interface CalOverrides {
  edits: Record<string, Partial<CalendarEvent>>;
  deleted: string[];
}

function loadOverrides(): CalOverrides {
  try {
    const raw = localStorage.getItem(CAL_OVERRIDES_KEY);
    if (!raw) return { edits: {}, deleted: [] };
    const parsed = JSON.parse(raw) as CalOverrides;
    return { edits: parsed.edits ?? {}, deleted: parsed.deleted ?? [] };
  } catch { return { edits: {}, deleted: [] }; }
}

function saveOverrides(o: CalOverrides): void {
  try { localStorage.setItem(CAL_OVERRIDES_KEY, JSON.stringify(o)); } catch { /* quota / private mode */ }
}

export function CalendarPanel() {
  const { scheduledEvents, projects } = useDashboard();
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [overrides, setOverrides] = useState<CalOverrides>(() => loadOverrides());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const events = useMemo(() => {
    // Calendar is sourced exclusively from Janus-scheduled events derived
    // from each project's STATUS.md. The previous hardcoded fallback was
    // misleading (empty descriptions) and is intentionally removed —
    // empty calendar = empty state CTA below.
    const base: CalendarEvent[] = (scheduledEvents ?? []).map(e => {
      const proj = projects.find(p => p.id === e.projectId);
      const taskNote = proj?.nextSteps?.find(t => `sch-${e.projectId}-${t.id}` === e.id);
      const notes = taskNote
        ? `${proj?.summary ? `Project: ${proj.summary}\n\n` : ''}Task: ${taskNote.title}\nPriority: ${taskNote.priority} · ${taskNote.effortHours}h estimated`
        : (proj?.summary || '');
      return {
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        allDay: false,
        project: e.projectName,
        color: e.color,
        notes,
        priority: (e.priority === 'P1' || e.priority === 'P2' || e.priority === 'P3' ? e.priority : 'P2') as 'P1' | 'P2' | 'P3',
      };
    });
    return base
      .filter((e) => !overrides.deleted.includes(e.id))
      .map((e) => {
        const patch = overrides.edits[e.id];
        return patch ? { ...e, ...patch } : e;
      });
  }, [overrides, scheduledEvents, projects]);

  const selectedEvent = useMemo(
    () => (selectedId ? events.find((e) => e.id === selectedId) ?? null : null),
    [selectedId, events],
  );

  const handleSaveEvent = useCallback((next: CalendarEvent) => {
    setOverrides((prev) => {
      const updated = { ...prev, edits: { ...prev.edits, [next.id]: next } };
      saveOverrides(updated);
      return updated;
    });
    setSelectedId(null);
  }, []);

  const handleDeleteEvent = useCallback((id: string) => {
    setOverrides((prev) => {
      const updated = { edits: prev.edits, deleted: [...prev.deleted, id] };
      saveOverrides(updated);
      return updated;
    });
    setSelectedId(null);
  }, []);

  // Wires up the cross-window connection: clicking a "📅" badge on a project's
  // next step in the drill-down dispatches `janus:focus-cal-event` with the
  // event id. The calendar jumps to that event's date and opens its modal.
  useEffect(() => {
    function onFocus(e: Event) {
      const detail = (e as CustomEvent<{ eventId: string }>).detail;
      if (!detail?.eventId) return;
      const ev = events.find((x) => x.id === detail.eventId);
      if (!ev) return;
      const target = new Date(ev.start);
      if (!Number.isNaN(target.getTime())) setCurrentDate(target);
      setSelectedId(ev.id);
    }
    window.addEventListener('janus:focus-cal-event', onFocus);
    return () => window.removeEventListener('janus:focus-cal-event', onFocus);
  }, [events]);

  const navigate = useCallback((dir: -1 | 1) => {
    setCurrentDate(d => {
      const next = new Date(d);
      if (viewMode === 'week') next.setDate(next.getDate() + dir * 7);
      else next.setMonth(next.getMonth() + dir);
      return next;
    });
  }, [viewMode]);

  const goToday = useCallback(() => setCurrentDate(new Date()), []);

  const headerLabel = viewMode === 'week'
    ? (() => {
        const week = getWeekDates(currentDate);
        const first = week[0];
        const last = week[6];
        if (first.getMonth() === last.getMonth()) {
          return `${MONTHS[first.getMonth()]} ${first.getDate()}-${last.getDate()}, ${first.getFullYear()}`;
        }
        return `${MONTHS[first.getMonth()].slice(0, 3)} ${first.getDate()} - ${MONTHS[last.getMonth()].slice(0, 3)} ${last.getDate()}, ${last.getFullYear()}`;
      })()
    : `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`;

  // Count events for current view
  const eventCount = useMemo(() => {
    if (viewMode === 'week') {
      const week = getWeekDates(currentDate);
      return events.filter(e => {
        const d = new Date(e.start);
        return d >= week[0] && d <= week[6];
      }).length;
    }
    return events.length;
  }, [currentDate, events, viewMode]);

  return (
    <div className="cal-container">
      {/* Toolbar */}
      <div className="cal-toolbar">
        <div className="cal-toolbar__left">
          <button className="cal-toolbar__btn" onClick={goToday}>Today</button>
          <button className="cal-toolbar__nav" onClick={() => navigate(-1)}>&lt;</button>
          <button className="cal-toolbar__nav" onClick={() => navigate(1)}>&gt;</button>
          <span className="cal-toolbar__label">{headerLabel}</span>
        </div>
        <div className="cal-toolbar__right">
          <span className="cal-toolbar__status">{eventCount} events</span>
          <div className="cal-toolbar__views">
            <button
              className={`cal-toolbar__view ${viewMode === 'week' ? 'cal-toolbar__view--active' : ''}`}
              onClick={() => setViewMode('week')}
            >
              Week
            </button>
            <button
              className={`cal-toolbar__view ${viewMode === 'month' ? 'cal-toolbar__view--active' : ''}`}
              onClick={() => setViewMode('month')}
            >
              Month
            </button>
          </div>
        </div>
      </div>

      {/* Calendar body */}
      <div className="cal-body">
        {events.length === 0 ? (
          <div className="cal-empty">
            <div className="cal-empty__title">No scheduled events yet</div>
            <div className="cal-empty__body">
              Janus schedules tasks from each project's <code>.janus/status.md</code>.
              Once a repo has that file with at least one open <code>Next Step</code>,
              the task lands here automatically.
            </div>
          </div>
        ) : viewMode === 'week'
          ? <WeekView currentDate={currentDate} events={events} onSelect={(ev) => setSelectedId(ev.id)} />
          : <MonthView currentDate={currentDate} events={events} onSelect={(ev) => setSelectedId(ev.id)} />
        }
      </div>

      {/* Event details / edit modal */}
      {selectedEvent && (
        <EventEditModal
          event={selectedEvent}
          onSave={handleSaveEvent}
          onDelete={handleDeleteEvent}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Legend */}
      <div className="cal-legend">
        {Object.entries(PROJECT_COLORS).filter(([k]) => k !== 'default').map(([name, color]) => (
          <div key={name} className="cal-legend__item">
            <div className="cal-legend__dot" style={{ background: color }} />
            <span className="cal-legend__label">{name}</span>
          </div>
        ))}
        <div className="cal-legend__item">
          <div className="cal-legend__dot cal-legend__dot--avail" />
          <span className="cal-legend__label">available (post 3 PM)</span>
        </div>
      </div>
    </div>
  );
}
