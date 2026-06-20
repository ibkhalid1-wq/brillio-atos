import React, { useEffect, useRef, useState } from "react";
import { generateId } from "@/lib/adamUtils";

const TYPES = ["gate", "steering_review", "delivery_target", "dependency_due", "external_event"];
const PHASES = ["strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize"];
const BLANK = {
  id: "",
  name: "",
  type: "gate",
  plannedDate: "",
  forecastDate: "",
  actualDate: "",
  phaseId: "strategy",
  status: "pending",
  notes: "",
};

interface Milestone {
  id: string;
  name: string;
  type: string;
  plannedDate: string;
  forecastDate: string;
  actualDate: string;
  phaseId: string;
  status: string;
  notes: string;
}

interface Props {
  milestones: Milestone[];
  onSave: (milestone: Milestone) => void;
  onDelete: (id: string) => void;
  onComplete: (id: string, date: string) => void;
  focusMilestoneId?: string | null;
  focusToken?: number;
}

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-blue-100 text-blue-700",
  complete: "bg-green-100 text-green-700",
  slipping: "bg-red-100 text-red-700",
  at_risk: "bg-yellow-100 text-yellow-700",
};

export function MilestoneView({ milestones, onSave, onDelete, onComplete, focusMilestoneId = null, focusToken = 0 }: Props) {
  const [form, setForm] = useState<Milestone>({ ...BLANK, id: generateId() });
  const [open, setOpen] = useState(false);
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [actualDate, setActualDate] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  function submit(event: React.FormEvent) {
    event.preventDefault();
    onSave(form);
    setForm({ ...BLANK, id: generateId() });
    setOpen(false);
  }

  const byPhase = PHASES.reduce<Record<string, Milestone[]>>((acc, phaseId) => {
    acc[phaseId] = milestones.filter((milestone) => milestone.phaseId === phaseId);
    return acc;
  }, {});
  const focusedMilestone = focusMilestoneId ? milestones.find((milestone) => milestone.id === focusMilestoneId) || null : null;

  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!focusMilestoneId) return;
    setHighlightId(focusMilestoneId);
    const frame = window.requestAnimationFrame(() => {
      rowRefs.current[focusMilestoneId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => setHighlightId((current) => (current === focusMilestoneId ? null : current)), 2200);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusMilestoneId, focusToken]);

  return (
    <div className="space-y-6 p-4">
      {focusedMilestone ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-indigo-700 mb-1">Review requested</div>
          <div className="text-xs text-indigo-900 leading-5">
            ADAM brought you to the milestone "{focusedMilestone.name}" so you can review the schedule change or confirm completion.
          </div>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Milestone Tracker</h2>
        <button type="button" onClick={() => setOpen((value) => !value)} className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700">
          + Add Milestone
        </button>
      </div>

      {open ? (
        <form onSubmit={submit} className="grid grid-cols-2 gap-3 rounded border bg-gray-50 p-4 text-sm">
          <h3 className="col-span-2 font-medium">New Milestone</h3>
          <input
            required
            placeholder="Name"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            className="col-span-2 rounded border px-2 py-1"
          />
          <select value={form.type} onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))} className="rounded border px-2 py-1">
            {TYPES.map((type) => <option key={type} value={type}>{type.replace("_", " ")}</option>)}
          </select>
          <select value={form.phaseId} onChange={(event) => setForm((prev) => ({ ...prev, phaseId: event.target.value }))} className="rounded border px-2 py-1">
            {PHASES.map((phaseId) => <option key={phaseId} value={phaseId}>{phaseId}</option>)}
          </select>
          <div>
            <label className="text-xs text-gray-500">Planned Date</label>
            <input
              required
              type="date"
              value={form.plannedDate}
              onChange={(event) => setForm((prev) => ({ ...prev, plannedDate: event.target.value }))}
              className="w-full rounded border px-2 py-1"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Forecast Date (optional)</label>
            <input
              type="date"
              value={form.forecastDate}
              onChange={(event) => setForm((prev) => ({ ...prev, forecastDate: event.target.value }))}
              className="w-full rounded border px-2 py-1"
            />
          </div>
          <textarea
            placeholder="Notes"
            rows={2}
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            className="col-span-2 resize-none rounded border px-2 py-1"
          />
          <div className="col-span-2 flex gap-2">
            <button type="submit" className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700">Save</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded bg-gray-200 px-3 py-1.5 hover:bg-gray-300">Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="space-y-4">
        {PHASES.map((phaseId) => {
          const items = byPhase[phaseId];
          if (!items?.length) return null;
          return (
            <div key={phaseId}>
              <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500 capitalize">{phaseId}</h3>
              <div className="space-y-1">
                {items.sort((left, right) => left.plannedDate.localeCompare(right.plannedDate)).map((milestone) => {
                  const slipDays = milestone.forecastDate && milestone.plannedDate
                    ? Math.round((new Date(milestone.forecastDate).getTime() - new Date(milestone.plannedDate).getTime()) / 86400000)
                    : 0;
                  const isLate = milestone.status !== "complete" && milestone.plannedDate < today;
                  return (
                    <div
                      key={milestone.id}
                      ref={(node) => { rowRefs.current[milestone.id] = node; }}
                      className={`flex items-start justify-between gap-2 rounded border p-2 transition-all ${
                        highlightId === milestone.id ? "ring-2 ring-indigo-400 bg-indigo-50 shadow-sm" : ""
                      }`}
                    >
                      <div className="flex-1 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{milestone.name}</span>
                          <span className={`rounded px-1.5 text-xs ${STATUS_COLOR[isLate ? "slipping" : milestone.status] || "bg-gray-100"}`}>
                            {isLate ? "late" : milestone.status}
                          </span>
                          <span className="text-xs text-gray-400">{milestone.type.replace("_", " ")}</span>
                        </div>
                        <div className="mt-0.5 flex gap-3 text-xs text-gray-500">
                          <span>Planned: {milestone.plannedDate}</span>
                          {milestone.forecastDate ? (
                            <span className={slipDays > 0 ? "text-red-500" : "text-green-600"}>
                              Forecast: {milestone.forecastDate} {slipDays > 0 ? `(+${slipDays}d)` : ""}
                            </span>
                          ) : null}
                          {milestone.actualDate ? <span className="text-green-600">Actual: {milestone.actualDate}</span> : null}
                        </div>
                        {milestone.notes ? <p className="mt-0.5 text-xs text-gray-400">{milestone.notes}</p> : null}
                      </div>
                      <div className="flex shrink-0 gap-1 text-xs">
                        {milestone.status !== "complete" ? (
                          completeId === milestone.id ? (
                            <div className="flex items-center gap-1">
                              <input type="date" value={actualDate} onChange={(event) => setActualDate(event.target.value)} className="rounded border px-1 py-0.5 text-xs" />
                              <button type="button" onClick={() => { onComplete(milestone.id, actualDate); setCompleteId(null); }} className="rounded bg-green-600 px-1.5 py-0.5 text-white">✓</button>
                              <button type="button" onClick={() => setCompleteId(null)} className="rounded bg-gray-200 px-1.5 py-0.5">✗</button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => { setCompleteId(milestone.id); setActualDate(today); }} className="rounded bg-green-50 px-2 py-0.5 text-green-700 hover:bg-green-100">
                              Complete
                            </button>
                          )
                        ) : null}
                        <button type="button" onClick={() => onDelete(milestone.id)} className="rounded bg-red-50 px-2 py-0.5 text-red-600 hover:bg-red-100">Del</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!milestones.length ? <p className="text-sm text-gray-400">No milestones added yet.</p> : null}
      </div>
    </div>
  );
}
