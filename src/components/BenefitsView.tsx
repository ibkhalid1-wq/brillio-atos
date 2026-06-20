import React, { useEffect, useRef, useState } from "react";
import { FormattedDocument } from "@/components/FormattedDocument";

const CATEGORIES = ["cost_reduction", "revenue_growth", "efficiency_gain", "risk_reduction", "compliance", "customer_satisfaction", "employee_experience"];
const STATUS_COLORS: Record<string, string> = {
  on_track: "bg-green-100 text-green-700",
  at_risk: "bg-yellow-100 text-yellow-700",
  not_realized: "bg-red-100 text-red-700",
  exceeded: "bg-blue-100 text-blue-700",
  pending: "bg-gray-100 text-gray-500",
};
const BLANK_BENEFIT = { title: "", category: "efficiency_gain", owner: "", targetValue: "", unit: "%", targetDate: "", baselineValue: "" };

interface Benefit {
  id: string;
  title: string;
  category: string;
  owner: string;
  targetValue: number;
  unit: string;
  targetDate: string;
  baselineValue: number | null;
  actualValues: Array<{ date: string; value: number; note: string }>;
  status: string;
  sourcePhase: string;
}

interface Props {
  benefits: Benefit[];
  focusBenefitId?: string | null;
  focusTab?: "register" | "report";
  focusToken?: number;
  onSave: (benefit: any) => void;
  onActual: (id: string, value: number, date: string, note: string) => void;
  onReport: () => Promise<string | null>;
}

export function BenefitsView({
  benefits,
  focusBenefitId = null,
  focusTab,
  focusToken = 0,
  onSave,
  onActual,
  onReport,
}: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ ...BLANK_BENEFIT });
  const [selected, setSelected] = useState<Benefit | null>(null);
  const [actualForm, setActualForm] = useState({ value: "", date: new Date().toISOString().slice(0, 10), note: "" });
  const [report, setReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"register" | "report">("register");
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const totalTarget = benefits.reduce((sum, benefit) => sum + (benefit.targetValue || 0), 0);
  const totalRealized = benefits.reduce((sum, benefit) => {
    const latest = benefit.actualValues?.slice(-1)[0]?.value ?? 0;
    return sum + Math.min(latest, benefit.targetValue || 0);
  }, 0);
  const realizationRate = totalTarget > 0 ? Math.round((totalRealized / totalTarget) * 100) : 0;
  const active = selected ? benefits.find((benefit) => benefit.id === selected.id) || selected : null;
  const focusedBenefit = focusBenefitId ? benefits.find((benefit) => benefit.id === focusBenefitId) || null : null;

  useEffect(() => {
    if (focusTab) setTab(focusTab);
    if (!focusBenefitId) return;
    const nextActive = benefits.find((benefit) => benefit.id === focusBenefitId);
    if (!nextActive) return;
    setSelected(nextActive);
    const frame = window.requestAnimationFrame(() => {
      itemRefs.current[focusBenefitId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [benefits, focusBenefitId, focusTab, focusToken]);

  async function loadReport() {
    setLoading(true);
    const result = await onReport();
    setReport(result);
    setLoading(false);
  }

  function submitActual(event: React.FormEvent) {
    event.preventDefault();
    if (!active) return;
    onActual(active.id, Number(actualForm.value), actualForm.date, actualForm.note);
    setActualForm({ value: "", date: new Date().toISOString().slice(0, 10), note: "" });
  }

  function submitBenefit(event: React.FormEvent) {
    event.preventDefault();
    onSave({
      ...form,
      id: crypto.randomUUID(),
      targetValue: Number(form.targetValue),
      baselineValue: form.baselineValue ? Number(form.baselineValue) : null,
      actualValues: [],
      status: "pending",
    });
    setForm({ ...BLANK_BENEFIT });
    setOpen(false);
  }

  return (
    <div className="p-4 space-y-4">
      {focusedBenefit || focusTab === "report" ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-indigo-700 mb-1">Review requested</div>
          <div className="text-xs text-indigo-900 leading-5">
            {focusedBenefit
              ? `ADAM brought you to the tracked benefit "${focusedBenefit.title}" so you can update actuals or review its delivery risk.`
              : "ADAM brought you directly to the realization report so you can review the current benefits posture."}
          </div>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Benefits Realization</h2>
        <button onClick={() => setOpen((value) => !value)} className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700">
          + Add Benefit
        </button>
      </div>

      <div className="flex gap-4 items-center text-sm border rounded p-3 bg-gray-50">
        <div className="text-center">
          <div className="text-2xl font-bold text-indigo-600">{realizationRate}%</div>
          <div className="text-xs text-gray-500">Realization Rate</div>
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Realized</span>
            <span>{realizationRate}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-indigo-600 h-2 rounded-full" style={{ width: `${realizationRate}%` }} />
          </div>
        </div>
        {[["on_track", "On Track"], ["at_risk", "At Risk"], ["not_realized", "Not Realized"], ["exceeded", "Exceeded"]].map(([status, label]) => (
          <div key={status} className="text-center">
            <div className="text-lg font-bold">{benefits.filter((benefit) => benefit.status === status).length}</div>
            <div className="text-xs text-gray-400">{label}</div>
          </div>
        ))}
      </div>

      {open ? (
        <form onSubmit={submitBenefit} className="border rounded p-3 bg-gray-50 grid grid-cols-2 gap-2 text-sm">
          <input required placeholder="Benefit title" value={form.title} onChange={(event) => setForm((current: any) => ({ ...current, title: event.target.value }))} className="col-span-2 border rounded px-2 py-1" />
          <select value={form.category} onChange={(event) => setForm((current: any) => ({ ...current, category: event.target.value }))} className="border rounded px-2 py-1">
            {CATEGORIES.map((category) => <option key={category} value={category}>{category.replace(/_/g, " ")}</option>)}
          </select>
          <input placeholder="Owner" value={form.owner} onChange={(event) => setForm((current: any) => ({ ...current, owner: event.target.value }))} className="border rounded px-2 py-1" />
          <input required type="number" placeholder="Target value" value={form.targetValue} onChange={(event) => setForm((current: any) => ({ ...current, targetValue: event.target.value }))} className="border rounded px-2 py-1" />
          <input placeholder="Unit (%, $, hrs…)" value={form.unit} onChange={(event) => setForm((current: any) => ({ ...current, unit: event.target.value }))} className="border rounded px-2 py-1" />
          <input type="number" placeholder="Baseline value" value={form.baselineValue} onChange={(event) => setForm((current: any) => ({ ...current, baselineValue: event.target.value }))} className="border rounded px-2 py-1" />
          <input type="date" placeholder="Target date" value={form.targetDate} onChange={(event) => setForm((current: any) => ({ ...current, targetDate: event.target.value }))} className="border rounded px-2 py-1" />
          <div className="col-span-2 flex gap-2">
            <button type="submit" className="bg-indigo-600 text-white px-3 py-1.5 rounded">Save</button>
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded bg-gray-200">Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="flex gap-2 border-b">
        {(["register", "report"] as const).map((value) => (
          <button key={value} onClick={() => setTab(value)} className={`text-sm px-3 py-1.5 border-b-2 capitalize ${tab === value ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-500"}`}>
            {value === "report" ? "Realization Report" : "Benefits Register"}
          </button>
        ))}
      </div>

      {tab === "register" ? (
        <div className="flex gap-4 h-[400px]">
          <div className="w-2/5 overflow-y-auto space-y-1 border-r pr-2">
            {!benefits.length ? <p className="text-sm text-gray-400 text-center pt-8">No benefits tracked yet.</p> : null}
            {benefits.map((benefit) => {
              const latest = benefit.actualValues?.slice(-1)[0]?.value;
              const progressPct = latest != null && benefit.targetValue ? Math.min(100, Math.round((latest / benefit.targetValue) * 100)) : 0;
              return (
                <div
                  key={benefit.id}
                  ref={(node) => { itemRefs.current[benefit.id] = node; }}
                  onClick={() => setSelected(benefit)}
                  className={`border rounded p-2 cursor-pointer text-xs ${selected?.id === benefit.id ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-300" : "hover:bg-gray-50"}`}
                >
                  <div className="flex justify-between items-start">
                    <span className="font-medium">{benefit.title}</span>
                    <span className={`px-1.5 rounded ${STATUS_COLORS[benefit.status]}`}>{benefit.status.replace(/_/g, " ")}</span>
                  </div>
                  <div className="text-gray-400 mt-0.5">{benefit.category.replace(/_/g, " ")} · {benefit.targetValue}{benefit.unit} target</div>
                  <div className="mt-1 flex items-center gap-1">
                    <div className="flex-1 bg-gray-200 rounded-full h-1">
                      <div className="bg-indigo-500 h-1 rounded-full" style={{ width: `${progressPct}%` }} />
                    </div>
                    <span className="text-gray-400">{progressPct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex-1 overflow-y-auto text-sm">
            {active ? (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">{active.title}</h3>
                  <p className="text-xs text-gray-400">{active.category.replace(/_/g, " ")} · Owner: {active.owner}</p>
                  <p className="text-xs text-gray-400">Target: {active.targetValue}{active.unit} by {active.targetDate || "—"}</p>
                  {active.baselineValue != null ? <p className="text-xs text-gray-400">Baseline: {active.baselineValue}{active.unit}</p> : null}
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Actuals History</p>
                  {active.actualValues?.length ? (
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="border px-2 py-1">Date</th>
                          <th className="border px-2 py-1">Value</th>
                          <th className="border px-2 py-1">Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...active.actualValues].reverse().map((actual, index) => (
                          <tr key={index}>
                            <td className="border px-2 py-1">{actual.date}</td>
                            <td className="border px-2 py-1 font-mono">{actual.value}{active.unit}</td>
                            <td className="border px-2 py-1 text-gray-500">{actual.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="text-gray-400">No actuals recorded yet.</p>}
                </div>
                <form onSubmit={submitActual} className="border-t pt-3 grid grid-cols-2 gap-2 text-xs">
                  <p className="col-span-2 font-medium text-gray-600">Record Actual</p>
                  <input required type="number" placeholder={`Value (${active.unit})`} value={actualForm.value} onChange={(event) => setActualForm((current) => ({ ...current, value: event.target.value }))} className="border rounded px-2 py-1" />
                  <input type="date" value={actualForm.date} onChange={(event) => setActualForm((current) => ({ ...current, date: event.target.value }))} className="border rounded px-2 py-1" />
                  <input placeholder="Note" value={actualForm.note} onChange={(event) => setActualForm((current) => ({ ...current, note: event.target.value }))} className="col-span-2 border rounded px-2 py-1" />
                  <button type="submit" className="col-span-2 bg-indigo-600 text-white rounded py-1 hover:bg-indigo-700">Save Actual</button>
                </form>
              </div>
            ) : <p className="text-gray-400 text-sm text-center pt-12">Select a benefit to record actuals.</p>}
          </div>
        </div>
      ) : null}

      {tab === "report" ? (
        <div className="space-y-3">
          {!report ? (
            <button onClick={loadReport} disabled={loading} className="bg-indigo-600 text-white text-sm px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-50">
              {loading ? "Generating…" : "Generate Benefits Realization Report"}
            </button>
          ) : null}
          {report ? (
            <div className="bg-gray-50 border rounded p-4">
              <FormattedDocument content={report} />
              <button onClick={() => setReport(null)} className="mt-2 text-xs text-gray-400 hover:text-gray-600">Regenerate</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
