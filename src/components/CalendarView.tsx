import React, { useEffect, useMemo, useRef, useState } from "react";
import { FormattedDocument } from "@/components/FormattedDocument";
import { generateId } from "@/lib/adamUtils";

const EVENT_TYPES = [
  { id: "workshop", label: "Workshop", color: "#6366f1" },
  { id: "steering", label: "Steering", color: "#f59e0b" },
  { id: "gate_review", label: "Gate Review", color: "#ef4444" },
  { id: "retrospective", label: "Retrospective", color: "#10b981" },
  { id: "milestone", label: "Milestone", color: "#8b5cf6" },
  { id: "training", label: "Training", color: "#06b6d4" },
  { id: "go_live", label: "Go Live", color: "#22c55e" },
  { id: "other", label: "Other", color: "#94a3b8" },
];
const PHASES = ["strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BLANK = { title: "", type: "workshop", date: "", phase: "build", duration: 60, attendees: "", notes: "" };

interface CalendarEvent {
  id: string;
  title: string;
  type: string;
  date: string;
  phase: string;
  duration: number;
  attendees: string[];
  agenda: string | null;
  notes: string;
  status: string;
  proposedByAgent?: boolean;
}

interface Props {
  events: CalendarEvent[];
  focusEventIds?: string[];
  focusView?: "month" | "list";
  focusToken?: number;
  onSave: (event: any) => void;
  onDelete: (id: string) => void;
  onAgenda: (id: string) => void;
  onConfirm: (id: string) => void;
}

function getColor(type: string) {
  return EVENT_TYPES.find((entry) => entry.id === type)?.color || "#94a3b8";
}

export function CalendarView({
  events,
  focusEventIds = [],
  focusView,
  focusToken = 0,
  onSave,
  onDelete,
  onAgenda,
  onConfirm,
}: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [form, setForm] = useState<any>({ ...BLANK, date: today.toISOString().slice(0, 10) });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<CalendarEvent | null>(null);
  const [view, setView] = useState<"month" | "list">("month");
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    events.forEach((event) => {
      const key = event.date?.slice(0, 10);
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push(event);
    });
    return map;
  }, [events]);

  const upcoming = [...events]
    .filter((event) => event.date >= today.toISOString().slice(0, 10))
    .sort((left, right) => left.date.localeCompare(right.date));
  const selected = active ? events.find((event) => event.id === active.id) || active : null;
  const focusedEvent = focusEventIds.find(Boolean)
    ? events.find((event) => event.id === focusEventIds.find(Boolean)) || null
    : null;
  const focusMessage = focusedEvent
    ? `ADAM brought you to "${focusedEvent.title}" so you can review the proposed meeting or milestone without searching the calendar.`
    : focusView === "list"
      ? "ADAM brought you to the event list so you can review the upcoming calendar actions in sequence."
      : focusView === "month"
        ? "ADAM brought you to the calendar view so you can review the date context around this scheduled action."
        : null;

  useEffect(() => {
    if (focusView) setView(focusView);
    const targetId = focusEventIds.find(Boolean);
    if (!targetId) return;
    const nextActive = events.find((event) => event.id === targetId);
    if (!nextActive) return;
    setActive(nextActive);
    const frame = window.requestAnimationFrame(() => {
      itemRefs.current[targetId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [events, focusEventIds, focusToken, focusView]);

  function submitForm(event: React.FormEvent) {
    event.preventDefault();
    onSave({
      ...form,
      id: generateId(),
      attendees: String(form.attendees || "").split(",").map((entry: string) => entry.trim()).filter(Boolean),
      status: "confirmed",
    });
    setForm({ ...BLANK, date: today.toISOString().slice(0, 10) });
    setOpen(false);
  }

  return (
    <div className="p-4 space-y-4">
      {focusMessage ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-indigo-700 mb-1">Review requested</div>
          <div className="text-xs text-indigo-900 leading-5">{focusMessage}</div>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Program Calendar</h2>
        <div className="flex gap-2">
          <button onClick={() => setView((current) => current === "month" ? "list" : "month")} className="text-xs px-3 py-1 rounded bg-gray-100 hover:bg-gray-200">
            {view === "month" ? "List View" : "Month View"}
          </button>
          <button onClick={() => setOpen((current) => !current)} className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700">
            + Add Event
          </button>
        </div>
      </div>

      {open ? (
        <form onSubmit={submitForm} className="border rounded p-3 bg-gray-50 grid grid-cols-2 gap-2 text-sm">
          <input required placeholder="Event title" value={form.title} onChange={(event) => setForm((current: any) => ({ ...current, title: event.target.value }))} className="col-span-2 border rounded px-2 py-1" />
          <select value={form.type} onChange={(event) => setForm((current: any) => ({ ...current, type: event.target.value }))} className="border rounded px-2 py-1">
            {EVENT_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
          </select>
          <select value={form.phase} onChange={(event) => setForm((current: any) => ({ ...current, phase: event.target.value }))} className="border rounded px-2 py-1">
            {PHASES.map((phaseId) => <option key={phaseId} value={phaseId}>{phaseId}</option>)}
          </select>
          <input required type="date" value={form.date} onChange={(event) => setForm((current: any) => ({ ...current, date: event.target.value }))} className="border rounded px-2 py-1" />
          <input type="number" placeholder="Duration (min)" value={form.duration} onChange={(event) => setForm((current: any) => ({ ...current, duration: Number(event.target.value) }))} className="border rounded px-2 py-1" />
          <input placeholder="Attendees (comma-separated)" value={form.attendees} onChange={(event) => setForm((current: any) => ({ ...current, attendees: event.target.value }))} className="col-span-2 border rounded px-2 py-1" />
          <textarea placeholder="Notes / purpose" rows={2} value={form.notes} onChange={(event) => setForm((current: any) => ({ ...current, notes: event.target.value }))} className="col-span-2 border rounded px-2 py-1 resize-none" />
          <div className="col-span-2 flex gap-2">
            <button type="submit" className="bg-indigo-600 text-white px-3 py-1.5 rounded">Save</button>
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded bg-gray-200">Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="flex gap-4">
        <div className={selected ? "w-2/3" : "w-full"}>
          {view === "month" ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => { if (month === 0) { setMonth(11); setYear((current) => current - 1); } else setMonth((current) => current - 1); }} className="text-sm px-2 py-1 rounded hover:bg-gray-100">←</button>
                <span className="font-medium text-sm">
                  {new Date(year, month).toLocaleDateString("default", { month: "long", year: "numeric" })}
                </span>
                <button onClick={() => { if (month === 11) { setMonth(0); setYear((current) => current + 1); } else setMonth((current) => current + 1); }} className="text-sm px-2 py-1 rounded hover:bg-gray-100">→</button>
              </div>
              <div className="grid grid-cols-7 text-center text-xs text-gray-400 mb-1">
                {DAYS.map((day) => <div key={day}>{day}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: firstDay }).map((_, index) => <div key={`empty-${index}`} />)}
                {Array.from({ length: daysInMonth }).map((_, index) => {
                  const day = index + 1;
                  const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const dayEvents = eventsByDate[key] || [];
                  const isToday = key === today.toISOString().slice(0, 10);
                  return (
                    <div key={day} className={`min-h-[56px] border rounded p-0.5 text-xs ${isToday ? "border-indigo-400 bg-indigo-50" : "border-gray-100"}`}>
                      <div className={`text-right mb-0.5 ${isToday ? "font-bold text-indigo-600" : ""}`}>{day}</div>
                      {dayEvents.slice(0, 2).map((event) => (
                        <div
                          key={event.id}
                          onClick={() => setActive(event)}
                          className="truncate rounded px-0.5 cursor-pointer text-white text-[10px] mb-0.5"
                          style={{ backgroundColor: getColor(event.type) }}
                        >
                          {event.title}
                        </div>
                      ))}
                      {dayEvents.length > 2 ? <div className="text-gray-400 text-[10px]">+{dayEvents.length - 2}</div> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500 mb-2">Upcoming Events ({upcoming.length})</p>
              {!upcoming.length ? <p className="text-sm text-gray-400">No upcoming events.</p> : null}
              {upcoming.map((event) => (
                <div
                  key={event.id}
                  ref={(node) => { itemRefs.current[event.id] = node; }}
                  onClick={() => setActive(event)}
                  className={`border rounded p-2 cursor-pointer text-xs flex items-start gap-2 ${active?.id === event.id ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-300" : "hover:bg-gray-50"}`}
                >
                  <div className="w-1.5 h-full rounded-full mt-0.5 self-stretch" style={{ backgroundColor: getColor(event.type), minWidth: "6px" }} />
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <span className="font-medium">{event.title}</span>
                      <span className="text-gray-400">{event.date}</span>
                    </div>
                    <div className="text-gray-400">{event.phase} · {event.duration}min · {EVENT_TYPES.find((type) => type.id === event.type)?.label}</div>
                    {event.proposedByAgent ? <span className="text-purple-500">🤖 Agent proposed</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {selected ? (
          <div className="w-1/3 border rounded p-3 text-sm space-y-3 overflow-y-auto max-h-[520px]">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold">{selected.title}</h3>
                <p className="text-xs text-gray-400">{selected.date} · {selected.duration}min · {selected.phase}</p>
                <p className="text-xs" style={{ color: getColor(selected.type) }}>{EVENT_TYPES.find((type) => type.id === selected.type)?.label}</p>
              </div>
              <button onClick={() => setActive(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            {selected.attendees?.length ? (
              <div>
                <p className="text-xs font-medium text-gray-500">Attendees</p>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {selected.attendees.map((attendee, index) => (
                    <span key={index} className="text-xs bg-gray-100 rounded px-1.5 py-0.5">{attendee}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {selected.notes ? <p className="text-xs text-gray-600">{selected.notes}</p> : null}
            {selected.agenda ? (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Agenda</p>
                <div className="bg-gray-50 rounded p-2">
                  <FormattedDocument content={selected.agenda} compact />
                </div>
              </div>
            ) : (
              <button onClick={() => onAgenda(selected.id)} className="text-xs px-3 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 w-full">
                🤖 Generate Agenda
              </button>
            )}
            {selected.status === "proposed" ? (
              <button onClick={() => onConfirm(selected.id)} className="text-xs px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700 w-full">
                ✓ Confirm Event
              </button>
            ) : null}
            <button onClick={() => { onDelete(selected.id); setActive(null); }} className="text-xs px-3 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 w-full">
              Delete Event
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
