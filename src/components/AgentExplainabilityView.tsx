import React, { useState } from "react";

const PHASES = ["strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize"];

interface DataPoint {
  key: string;
  value: string;
  weight: "high" | "medium" | "low";
}

interface AuditEntry {
  id: string;
  taskType: string;
  outcome: string;
  ts: number;
  insight: string;
  reasoningTrace: string;
  observationSummary: string;
  planSummary: string;
  executionSummary: string;
  evaluationSummary: string;
  confidence: number;
  dataPoints: DataPoint[];
  humanReadable: string;
}

interface Props {
  agentStates: Record<string, { auditLog?: AuditEntry[]; autonomyMode?: string; lastRanAt?: number | null }>;
}

const OUTCOME_COLORS: Record<string, string> = {
  accepted: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  skipped: "bg-gray-100 text-gray-500",
  error: "bg-orange-100 text-orange-700",
};

const WEIGHT_COLORS: Record<string, string> = {
  high: "border-red-400 bg-red-50",
  medium: "border-yellow-400 bg-yellow-50",
  low: "border-gray-300 bg-gray-50",
};

export function AgentExplainabilityView({ agentStates }: Props) {
  const [selectedPhase, setSelectedPhase] = useState(PHASES[0]);
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const [section, setSection] = useState<"why" | "trace" | "data">("why");

  const state = agentStates[selectedPhase];
  const entries = state?.auditLog || [];

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-lg font-semibold">Agent Explainability</h2>
      <p className="text-sm text-gray-500">Understand why agents took each action with a simple observe → plan → execute → evaluate trail.</p>

      <div className="flex flex-wrap gap-1">
        {PHASES.map((phaseId) => (
          <button
            key={phaseId}
            type="button"
            onClick={() => {
              setSelectedPhase(phaseId);
              setSelectedEntry(null);
            }}
            className={`rounded-full border px-2.5 py-1 text-xs capitalize ${selectedPhase === phaseId ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-300 hover:bg-gray-50"}`}
          >
            {phaseId}
          </button>
        ))}
      </div>

      {state ? (
        <div className="flex gap-4 text-xs text-gray-400">
          <span>Mode: <strong>{state.autonomyMode || "—"}</strong></span>
          <span>Last ran: {state.lastRanAt ? new Date(state.lastRanAt).toLocaleString() : "—"}</span>
          <span>{entries.length} logged actions</span>
        </div>
      ) : null}

      <div className="flex h-[520px] gap-4">
        <div className="w-2/5 space-y-1 overflow-y-auto border-r pr-2">
          {!entries.length ? <p className="pt-8 text-center text-sm text-gray-400">No agent actions recorded yet for this phase.</p> : null}
          {[...entries].reverse().map((entry) => (
            <div
              key={entry.id}
              onClick={() => {
                setSelectedEntry(entry);
                setSection("why");
              }}
              className={`cursor-pointer rounded border p-2 text-xs ${selectedEntry?.id === entry.id ? "border-indigo-400 bg-indigo-50" : "hover:bg-gray-50"}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-mono font-medium">{entry.taskType}</span>
                <span className={`rounded px-1.5 py-0.5 ${OUTCOME_COLORS[entry.outcome] || "bg-gray-100"}`}>{entry.outcome}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-gray-400">
                <span>{new Date(entry.ts).toLocaleTimeString()}</span>
                <div className="h-1 flex-1 rounded-full bg-gray-200">
                  <div className="h-1 rounded-full bg-indigo-500" style={{ width: `${entry.confidence}%` }} />
                </div>
                <span>{entry.confidence}%</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {selectedEntry ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-sm font-semibold">{selectedEntry.taskType}</h3>
                <span className={`rounded px-2 py-0.5 text-xs ${OUTCOME_COLORS[selectedEntry.outcome] || "bg-gray-100"}`}>{selectedEntry.outcome}</span>
              </div>

              <div className="flex gap-2 border-b">
                {[["why", "Plain English"], ["trace", "Full Trace"], ["data", "Data Points"]].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSection(id as "why" | "trace" | "data")}
                    className={`border-b-2 px-3 py-1.5 text-xs ${section === id ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-500"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {section === "why" ? (
                <div className="space-y-3 text-sm">
                  {selectedEntry.humanReadable ? (
                    <div className="rounded border border-blue-100 bg-blue-50 p-3">
                      <pre className="whitespace-pre-wrap font-sans text-sm text-blue-900">{selectedEntry.humanReadable}</pre>
                    </div>
                  ) : (
                    <p className="text-gray-400">No plain-English explanation generated for this action.</p>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      ["Observed", selectedEntry.observationSummary],
                      ["Planned", selectedEntry.planSummary],
                      ["Executed", selectedEntry.executionSummary],
                      ["Evaluated", selectedEntry.evaluationSummary],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded border p-2">
                        <p className="mb-1 font-medium text-gray-500">{label}</p>
                        <p className="text-gray-700">{value || "—"}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-500">Confidence:</span>
                    <div className="h-2 flex-1 rounded-full bg-gray-200">
                      <div className="h-2 rounded-full bg-indigo-500 transition-all" style={{ width: `${selectedEntry.confidence}%` }} />
                    </div>
                    <span className="font-mono">{selectedEntry.confidence}%</span>
                  </div>
                </div>
              ) : null}

              {section === "trace" ? (
                <div className="max-h-80 overflow-y-auto rounded bg-gray-900 p-3 font-mono text-xs text-green-400">
                  <pre className="whitespace-pre-wrap">{selectedEntry.reasoningTrace || "No reasoning trace captured."}</pre>
                </div>
              ) : null}

              {section === "data" ? (
                <div className="space-y-1">
                  {selectedEntry.dataPoints?.length ? selectedEntry.dataPoints.map((dataPoint, index) => (
                    <div key={`${selectedEntry.id}-dp-${index}`} className={`rounded border-l-2 px-2 py-1.5 text-xs ${WEIGHT_COLORS[dataPoint.weight] || WEIGHT_COLORS.low}`}>
                      <span className="font-medium">{dataPoint.key}</span>
                      <span className="mx-1 text-gray-500">→</span>
                      <span>{dataPoint.value}</span>
                      <span className="ml-2 text-gray-400">({dataPoint.weight} weight)</span>
                    </div>
                  )) : (
                    <p className="text-xs text-gray-400">No data points recorded for this action.</p>
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              Select an agent action to see its explanation.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
