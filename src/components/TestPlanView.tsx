import React, { useState } from "react";
import { FormattedDocument } from "@/components/FormattedDocument";

interface ACItem {
  id: string;
  text: string;
  sourceArtifact: string;
  sourcePhase: string;
  status: string;
}

interface Scenario {
  id: string;
  feature: string;
  role: string;
  precondition: string;
  steps: string[];
  expectedResult: string;
  priority: string;
  status: string;
  sourcePhase?: string;
  sourceArtifact?: string;
  testedBy?: string;
  notes?: string;
  testedAt?: number | null;
}

interface Props {
  acceptanceCriteria: ACItem[];
  scenarios: Scenario[];
  onACResult: (id: string, status: string) => void;
  onScenarioResult: (id: string, status: string, testedBy: string, notes: string) => void;
  onGenerateSummary: () => Promise<string | null>;
}

const STATUS_COLORS: Record<string, string> = {
  passed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  untested: "bg-gray-100 text-gray-500",
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "text-red-600",
  medium: "text-yellow-600",
  low: "text-gray-400",
};

export function TestPlanView({
  acceptanceCriteria,
  scenarios,
  onACResult,
  onScenarioResult,
  onGenerateSummary,
}: Props) {
  const [tab, setTab] = useState<"scenarios" | "criteria" | "summary">("scenarios");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [testedBy, setTestedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterRole, setFilterRole] = useState("all");
  const [filterStat, setFilterStat] = useState("all");

  const roles = ["all", ...Array.from(new Set(scenarios.map((scenario) => scenario.role).filter(Boolean)))];
  const filtered = scenarios.filter((scenario) => (
    (filterRole === "all" || scenario.role === filterRole)
    && (filterStat === "all" || scenario.status === filterStat)
  ));
  const active = scenarios.find((scenario) => scenario.id === activeId) ?? null;

  const passed = scenarios.filter((scenario) => scenario.status === "passed").length;
  const failed = scenarios.filter((scenario) => scenario.status === "failed").length;
  const untested = scenarios.filter((scenario) => scenario.status === "untested").length;
  const total = scenarios.length;
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;

  async function loadSummary() {
    setLoading(true);
    try {
      const result = await onGenerateSummary();
      setSummary(result);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-lg font-semibold">Test Plan &amp; UAT</h2>

      <div className="flex gap-4 text-sm">
        {[["Passed", passed, "text-green-600"], ["Failed", failed, "text-red-500"], ["Untested", untested, "text-gray-400"]].map(([label, value, color]) => (
          <div key={String(label)} className="flex flex-col items-center">
            <span className={`text-2xl font-bold ${color}`}>{value}</span>
            <span className="text-xs text-gray-500">{label}</span>
          </div>
        ))}
        <div className="flex flex-1 items-center">
          <div className="h-2 w-full rounded-full bg-gray-200">
            <div className="h-2 rounded-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="ml-2 text-xs text-gray-500">{pct}%</span>
        </div>
      </div>

      <div className="flex gap-2 border-b">
        {(["scenarios", "criteria", "summary"] as const).map((nextTab) => (
          <button
            key={nextTab}
            type="button"
            onClick={() => setTab(nextTab)}
            className={`border-b-2 px-3 py-1.5 text-sm capitalize ${tab === nextTab ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-500"}`}
          >
            {nextTab === "criteria" ? "Acceptance Criteria" : nextTab === "summary" ? "UAT Report" : "Scenarios"}
          </button>
        ))}
      </div>

      {tab === "scenarios" ? (
        <div className="flex h-[500px] gap-4">
          <div className="flex w-1/2 flex-col gap-2">
            <div className="flex gap-2 text-xs">
              <select value={filterRole} onChange={(event) => setFilterRole(event.target.value)} className="rounded border px-2 py-1">
                {roles.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
              <select value={filterStat} onChange={(event) => setFilterStat(event.target.value)} className="rounded border px-2 py-1">
                {["all", "passed", "failed", "untested"].map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto">
              {filtered.map((scenario) => (
                <div
                  key={scenario.id}
                  onClick={() => {
                    setActiveId(scenario.id);
                    setTestedBy(scenario.testedBy || "");
                    setNotes(scenario.notes || "");
                  }}
                  className={`cursor-pointer rounded border p-2 text-xs ${activeId === scenario.id ? "border-indigo-400 bg-indigo-50" : "hover:bg-gray-50"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{scenario.feature}</span>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_COLORS[scenario.status] || STATUS_COLORS.untested}`}>{scenario.status}</span>
                  </div>
                  <div className="mt-0.5 text-gray-500">
                    {scenario.role} · <span className={PRIORITY_COLORS[scenario.priority] || PRIORITY_COLORS.low}>{scenario.priority}</span>
                  </div>
                </div>
              ))}
              {!filtered.length ? <p className="pt-4 text-center text-xs text-gray-400">No scenarios match this filter.</p> : null}
            </div>
          </div>

          <div className="w-1/2 overflow-y-auto rounded border p-3 text-sm">
            {active ? (
              <div className="space-y-3">
                <div>
                  <h3 className="font-semibold">{active.feature}</h3>
                  <p className="text-xs text-gray-500">{active.role} · {active.priority} priority · {active.sourcePhase || "unknown phase"}</p>
                </div>
                {active.precondition ? (
                  <div>
                    <p className="text-xs font-medium text-gray-500">Precondition</p>
                    <p className="text-sm">{active.precondition}</p>
                  </div>
                ) : null}
                <div>
                  <p className="text-xs font-medium text-gray-500">Steps</p>
                  <ol className="list-decimal space-y-0.5 pl-4 text-sm">
                    {(active.steps || []).map((step, index) => <li key={`${active.id}-step-${index}`}>{step}</li>)}
                  </ol>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500">Expected Result</p>
                  <p className="text-sm">{active.expectedResult}</p>
                </div>
                {active.status !== "untested" ? (
                  <div className={`rounded px-2 py-1 text-xs ${STATUS_COLORS[active.status] || STATUS_COLORS.untested}`}>
                    {active.status} by {active.testedBy || "?"} — {active.testedAt ? new Date(active.testedAt).toLocaleDateString() : ""}
                    {active.notes ? <p className="mt-1">{active.notes}</p> : null}
                  </div>
                ) : null}
                <div className="space-y-2 border-t pt-1">
                  <input
                    placeholder="Tested by"
                    value={testedBy}
                    onChange={(event) => setTestedBy(event.target.value)}
                    className="w-full rounded border px-2 py-1 text-xs"
                  />
                  <textarea
                    placeholder="Notes"
                    rows={2}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="w-full resize-none rounded border px-2 py-1 text-xs"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onScenarioResult(active.id, "passed", testedBy, notes)}
                      className="flex-1 rounded bg-green-600 py-1 text-xs text-white hover:bg-green-700"
                    >
                      ✓ Pass
                    </button>
                    <button
                      type="button"
                      onClick={() => onScenarioResult(active.id, "failed", testedBy, notes)}
                      className="flex-1 rounded bg-red-500 py-1 text-xs text-white hover:bg-red-600"
                    >
                      ✗ Fail
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="pt-8 text-center text-sm text-gray-400">Select a scenario to record a result.</p>
            )}
          </div>
        </div>
      ) : null}

      {tab === "criteria" ? (
        <div className="space-y-1">
          {!acceptanceCriteria.length ? <p className="text-sm text-gray-400">No criteria extracted yet.</p> : null}
          {acceptanceCriteria.map((criterion) => (
            <div key={criterion.id} className="flex items-start justify-between gap-2 rounded border p-2 text-sm">
              <div className="flex-1">
                <p>{criterion.text}</p>
                <p className="mt-0.5 text-xs text-gray-400">{criterion.sourcePhase} / {criterion.sourceArtifact}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => onACResult(criterion.id, "passed")}
                  className={`rounded px-2 py-0.5 text-xs ${criterion.status === "passed" ? "bg-green-600 text-white" : "bg-gray-100"}`}
                >
                  ✓
                </button>
                <button
                  type="button"
                  onClick={() => onACResult(criterion.id, "failed")}
                  className={`rounded px-2 py-0.5 text-xs ${criterion.status === "failed" ? "bg-red-500 text-white" : "bg-gray-100"}`}
                >
                  ✗
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {tab === "summary" ? (
        <div className="space-y-3">
          {!summary ? (
            <button
              type="button"
              onClick={loadSummary}
              disabled={loading}
              className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? "Generating..." : "Generate UAT Readiness Report"}
            </button>
          ) : null}
          {summary ? (
            <div className="prose prose-sm max-w-none rounded border bg-gray-50 p-4">
              <FormattedDocument content={summary} />
              <button type="button" onClick={() => setSummary(null)} className="mt-3 text-xs text-gray-400 hover:text-gray-600">
                Regenerate
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
