import React, { useEffect, useRef, useState } from "react";

interface BudgetEntry {
  id: string;
  date: string;
  phase: string;
  planned: number;
  actual: number;
  note: string;
}

interface EV {
  cpi: number | null;
  spi: number | null;
  eac: number | null;
  vac: number | null;
  earnedPct: number;
  burnRate?: number | null;
  totalBudget?: number | null;
}

interface Props {
  budgetLog: BudgetEntry[];
  earnedValueIndex: EV | null;
  totalBudget: number | null;
  costBurnRate?: number | null;
  focusSection?: "summary" | "log" | "entry" | null;
  focusToken?: number;
  onAddEntry: (date: string, phase: string, planned: number, actual: number, note: string) => void;
  onSetTotalBudget?: (value: number) => void;
}

const PHASES = ["strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize"];

export function BudgetView({
  budgetLog,
  earnedValueIndex: ev,
  totalBudget,
  costBurnRate,
  focusSection = null,
  focusToken = 0,
  onAddEntry,
  onSetTotalBudget,
}: Props) {
  const [form, setForm] = useState({ date: "", phase: "strategy", planned: "", actual: "", note: "" });
  const [budgetInput, setBudgetInput] = useState(totalBudget != null ? String(Math.round(totalBudget)) : "");
  const [highlightSection, setHighlightSection] = useState<"summary" | "log" | "entry" | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const entryRef = useRef<HTMLFormElement | null>(null);

  const kpis = [
    { label: "CPI", value: ev?.cpi?.toFixed(2) ?? "—", good: (ev?.cpi ?? 1) >= 0.9 },
    { label: "SPI", value: ev?.spi?.toFixed(2) ?? "—", good: (ev?.spi ?? 1) >= 0.9 },
    { label: "Est. At Comp", value: ev?.eac ? `$${Math.round(ev.eac).toLocaleString()}` : "—", good: true },
    { label: "Variance", value: ev?.vac != null ? `$${Math.round(ev.vac).toLocaleString()}` : "—", good: (ev?.vac ?? 0) >= 0 },
  ];
  const focusMessage = focusSection === "summary"
    ? "ADAM brought you to the budget summary so you can review current cost posture and variance."
    : focusSection === "log"
      ? "ADAM brought you to the spend log so you can inspect the exact budget movement behind the alert."
      : focusSection === "entry"
        ? "ADAM brought you directly to the spend-entry form so you can update the budget without extra navigation."
        : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    onAddEntry(form.date, form.phase, Number(form.planned), Number(form.actual), form.note);
    setForm({ date: "", phase: "strategy", planned: "", actual: "", note: "" });
  }

  function saveBudget() {
    if (!onSetTotalBudget) return;
    const next = Number(budgetInput);
    if (!Number.isFinite(next) || next <= 0) return;
    onSetTotalBudget(next);
  }

  useEffect(() => {
    if (!focusSection) return;
    setHighlightSection(focusSection);
    const target = focusSection === "summary"
      ? summaryRef.current
      : focusSection === "entry"
        ? entryRef.current
        : logRef.current;
    const frame = window.requestAnimationFrame(() => {
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => setHighlightSection((current) => (current === focusSection ? null : current)), 2200);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusSection, focusToken]);

  return (
    <div className="p-4 space-y-6">
      {focusMessage ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-indigo-700 mb-1">Review requested</div>
          <div className="text-xs text-indigo-900 leading-5">{focusMessage}</div>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Budget & Earned Value</h2>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Program budget</span>
          <input
            type="number"
            min={0}
            value={budgetInput}
            onChange={(event) => setBudgetInput(event.target.value)}
            placeholder="Set total budget"
            className="border rounded px-2 py-1 w-40"
          />
          {onSetTotalBudget ? (
            <button type="button" onClick={saveBudget} className="bg-gray-100 hover:bg-gray-200 rounded px-3 py-1.5">
              Save
            </button>
          ) : null}
        </div>
      </div>

      <div
        ref={summaryRef}
        className={`grid grid-cols-1 md:grid-cols-3 gap-3 rounded-xl transition-all ${
          highlightSection === "summary" ? "ring-2 ring-indigo-400 bg-indigo-50/40 p-2" : ""
        }`}
      >
        <div className="rounded-lg border p-4">
          <div className="text-xs text-gray-500">Total Budget</div>
          <div className="text-2xl font-mono font-bold mt-1">
            {totalBudget != null ? `$${Math.round(totalBudget).toLocaleString()}` : "—"}
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-xs text-gray-500">Rolling Burn Rate</div>
          <div className="text-2xl font-mono font-bold mt-1">
            {costBurnRate != null ? `$${Math.round(costBurnRate).toLocaleString()}/day` : "—"}
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-xs text-gray-500">Earned Progress</div>
          <div className="text-2xl font-mono font-bold mt-1">
            {ev?.earnedPct != null ? `${Math.round(ev.earnedPct * 100)}%` : "—"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-lg border p-3 text-center">
            <div className="text-xs text-gray-500">{kpi.label}</div>
            <div className={`text-xl font-mono font-bold mt-1 ${kpi.good ? "text-green-600" : "text-red-500"}`}>
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      <div
        ref={logRef}
        className={`rounded-xl transition-all ${highlightSection === "log" ? "ring-2 ring-indigo-400 bg-indigo-50/40 p-2" : ""}`}
      >
        <h3 className="text-sm font-medium mb-2">Spend Log</h3>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50">
              {["Date", "Phase", "Planned", "Actual", "Note"].map((header) => (
                <th key={header} className="border px-2 py-1 text-left font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {budgetLog.map((entry) => (
              <tr key={entry.id} className="hover:bg-gray-50">
                <td className="border px-2 py-1">{entry.date}</td>
                <td className="border px-2 py-1 capitalize">{entry.phase}</td>
                <td className="border px-2 py-1">${entry.planned.toLocaleString()}</td>
                <td className={`border px-2 py-1 ${entry.actual > entry.planned ? "text-red-600" : "text-green-600"}`}>
                  ${entry.actual.toLocaleString()}
                </td>
                <td className="border px-2 py-1 text-gray-500">{entry.note}</td>
              </tr>
            ))}
            {budgetLog.length === 0 ? (
              <tr>
                <td colSpan={5} className="border px-2 py-3 text-center text-gray-400">No entries yet</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <form
        ref={entryRef}
        onSubmit={submit}
        className={`grid grid-cols-2 gap-2 text-sm rounded-xl transition-all ${
          highlightSection === "entry" ? "ring-2 ring-indigo-400 bg-indigo-50/40 p-2" : ""
        }`}
      >
        <h3 className="col-span-2 font-medium">Add Spend Entry</h3>
        <input
          type="date"
          required
          value={form.date}
          onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
          className="border rounded px-2 py-1"
        />
        <select
          value={form.phase}
          onChange={(event) => setForm((current) => ({ ...current, phase: event.target.value }))}
          className="border rounded px-2 py-1"
        >
          {PHASES.map((phaseId) => <option key={phaseId} value={phaseId}>{phaseId}</option>)}
        </select>
        <input
          type="number"
          placeholder="Planned ($)"
          required
          value={form.planned}
          onChange={(event) => setForm((current) => ({ ...current, planned: event.target.value }))}
          className="border rounded px-2 py-1"
        />
        <input
          type="number"
          placeholder="Actual ($)"
          required
          value={form.actual}
          onChange={(event) => setForm((current) => ({ ...current, actual: event.target.value }))}
          className="border rounded px-2 py-1"
        />
        <input
          type="text"
          placeholder="Note"
          value={form.note}
          onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
          className="border rounded px-2 py-1 col-span-2"
        />
        <button type="submit" className="col-span-2 bg-indigo-600 text-white rounded px-3 py-1.5 hover:bg-indigo-700">
          Add Entry
        </button>
      </form>
    </div>
  );
}
