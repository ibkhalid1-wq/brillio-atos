import React, { useMemo, useState } from "react";
import { ADAM_AGENT_PROMPTS, type AdamAgentId } from "@/lib/adamAgentPrompts";
import { generatePromptImprovements } from "@/lib/evals/adamPromptImprover";
import { runAllEvals, runEval, type EvalResult, type EvalRunSummary } from "@/lib/evals/adamEvalRunner";
import {
  PROMPT_REGISTRY,
  getActivePrompt,
  promotePromptVersion,
  resetPromptRegistry,
  type PromptVersion,
} from "@/lib/adamPromptRegistry";

const DIMENSIONS = [
  "accuracy",
  "completeness",
  "specificity",
  "consistency",
  "schema_validity",
  "confidence_calibration",
  "pause_behavior",
  "tone",
  "hallucination",
] as const;

type EvalDimensionKey = typeof DIMENSIONS[number];

function scoreTone(score: number): string {
  if (score >= 0.85) return "bg-emerald-100 text-emerald-700";
  if (score >= 0.75) return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

function versionTone(status: PromptVersion["status"]): string {
  if (status === "active") return "bg-cyan-100 text-cyan-700";
  if (status === "draft") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-500";
}

interface EvalDashboardProps {
  defaultAgentId?: AdamAgentId;
}

export function EvalDashboard({ defaultAgentId = "strategy" }: EvalDashboardProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<AdamAgentId>(defaultAgentId);
  const [summaries, setSummaries] = useState<Record<string, EvalRunSummary>>({});
  const [runningAgentId, setRunningAgentId] = useState<string | null>(null);
  const [registryTick, setRegistryTick] = useState(0);
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);
  const [improvementText, setImprovementText] = useState<string>("");
  const [improving, setImproving] = useState(false);

  const agentIds = useMemo(() => Object.keys(ADAM_AGENT_PROMPTS) as AdamAgentId[], []);
  const registry = PROMPT_REGISTRY;
  void registryTick;

  const selectedSummary = summaries[selectedAgentId] || null;
  const selectedVersions = registry[selectedAgentId] || [];
  const failingCases = selectedSummary?.results.filter((result) => !result.passed) || [];

  const matrixRows = useMemo(() => {
    return agentIds.map((agentId) => {
      const summary = summaries[agentId];
      const activeVersion = getActivePrompt(agentId);
      const scores = summary?.scoresByDimension || (activeVersion.evalScores?.byDimension || {});
      return {
        agentId,
        agentName: ADAM_AGENT_PROMPTS[agentId].agentName,
        overall: summary?.averageScore || activeVersion.evalScores?.overallScore || 0,
        scores,
      };
    });
  }, [agentIds, summaries, registryTick]);

  async function handleRunAll() {
    setRunningAgentId("all");
    try {
      const next = await runAllEvals({});
      setSummaries(next);
    } finally {
      setRunningAgentId(null);
    }
  }

  async function handleRunAgent(agentId: AdamAgentId) {
    setRunningAgentId(agentId);
    try {
      const summary = await runEval({ agentId });
      setSummaries((current) => ({ ...current, [agentId]: summary }));
      setSelectedAgentId(agentId);
    } finally {
      setRunningAgentId(null);
    }
  }

  async function handleGenerateImprovements() {
    if (!selectedSummary || failingCases.length === 0) return;
    setImproving(true);
    try {
      const weakest = [...selectedSummary.results]
        .flatMap((result) => result.dimensionScores)
        .sort((left, right) => left.score - right.score)
        .slice(0, 3)
        .map((entry) => entry.dimension);
      const improvement = await generatePromptImprovements({
        agentId: selectedAgentId,
        currentPrompt: getActivePrompt(selectedAgentId).prompt,
        failingCases,
        weakDimensions: Array.from(new Set(weakest)),
      });
      setImprovementText([
        `Diagnosis: ${improvement.diagnosis}`,
        "",
        ...improvement.suggestedChanges.map((change, index) => (
          `${index + 1}. ${change.section}\nCurrent: ${change.current}\nSuggested: ${change.suggested}\nWhy: ${change.rationale}\nImpact: ${change.expectedImpact}`
        )),
      ].join("\n\n"));
    } finally {
      setImproving(false);
    }
  }

  function handlePromote(agentId: AdamAgentId, version: string) {
    promotePromptVersion(agentId, version);
    setRegistryTick((current) => current + 1);
  }

  function handleResetRegistry() {
    resetPromptRegistry();
    setRegistryTick((current) => current + 1);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Eval dashboard</h3>
          <p className="mt-1 text-xs text-slate-500">
            Prompt quality, version history, failing cases, and promotion controls for the ADAM agent library.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleRunAll()}
            disabled={runningAgentId !== null}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {runningAgentId === "all" ? "Running all evals…" : "Run all evals"}
          </button>
          <button
            type="button"
            onClick={handleResetRegistry}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
          >
            Reset registry
          </button>
        </div>
      </div>

      <div className="space-y-6 p-4">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Agent health matrix</h4>
            <div className="flex flex-wrap gap-2">
              {agentIds.map((agentId) => (
                <button
                  key={agentId}
                  type="button"
                  onClick={() => setSelectedAgentId(agentId)}
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    selectedAgentId === agentId
                      ? "bg-cyan-100 text-cyan-700"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {agentId}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500">Agent</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500">Overall</th>
                  {DIMENSIONS.map((dimension) => (
                    <th key={dimension} className="px-3 py-2 text-left font-semibold text-slate-500">
                      {dimension.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {matrixRows.map((row) => (
                  <tr key={row.agentId} className={row.agentId === selectedAgentId ? "bg-cyan-50/40" : ""}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">{row.agentName}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">{row.agentId}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-1 ${scoreTone(row.overall)}`}>
                        {row.overall ? row.overall.toFixed(2) : "—"}
                      </span>
                    </td>
                    {DIMENSIONS.map((dimension) => {
                      const score = Number(row.scores[dimension] || 0);
                      return (
                        <td key={dimension} className="px-3 py-2">
                          <span className={`rounded-full px-2 py-1 ${scoreTone(score)}`}>
                            {score ? score.toFixed(2) : "—"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="space-y-4 rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Version history</h4>
                <p className="mt-1 text-xs text-slate-500">
                  Active prompt registry for {ADAM_AGENT_PROMPTS[selectedAgentId].agentName}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRunAgent(selectedAgentId)}
                disabled={runningAgentId !== null}
                className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {runningAgentId === selectedAgentId ? "Running…" : `Run ${selectedAgentId}`}
              </button>
            </div>

            <div className="space-y-3">
              {selectedVersions.map((version) => (
                <div key={version.version} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">v{version.version}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${versionTone(version.status)}`}>
                          {version.status}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{version.changelog}</div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        Published {new Date(version.publishedAt).toLocaleDateString()} by {version.publishedBy}
                      </div>
                    </div>
                    {version.status !== "active" ? (
                      <button
                        type="button"
                        onClick={() => handlePromote(selectedAgentId, version.version)}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
                      >
                        Promote
                      </button>
                    ) : null}
                  </div>
                  {version.evalScores ? (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        Overall score <span className="font-semibold text-slate-900">{version.evalScores.overallScore.toFixed(2)}</span>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        Sample size <span className="font-semibold text-slate-900">{version.evalScores.sampleSize}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      No eval scores recorded yet for this version.
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4 rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Failing cases</h4>
                <p className="mt-1 text-xs text-slate-500">
                  Current failures for {selectedAgentId}. Use these to decide whether to improve or roll back the active prompt.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleGenerateImprovements()}
                disabled={improving || failingCases.length === 0}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {improving ? "Generating…" : "Suggest improvements"}
              </button>
            </div>

            {failingCases.length === 0 ? (
              <div className="rounded-xl bg-emerald-50 px-4 py-6 text-sm text-emerald-700">
                No failing cases for the currently loaded run. Execute evals to refresh this view.
              </div>
            ) : (
              <div className="space-y-3">
                {failingCases.map((result) => (
                  <FailingCaseCard
                    key={result.evalCaseId}
                    result={result}
                    expanded={expandedCaseId === result.evalCaseId}
                    onToggle={() => setExpandedCaseId((current) => current === result.evalCaseId ? null : result.evalCaseId)}
                  />
                ))}
              </div>
            )}

            {improvementText ? (
              <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Prompt improvement draft</div>
                <pre className="mt-2 whitespace-pre-wrap text-xs leading-6 text-cyan-900">{improvementText}</pre>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </section>
  );
}

function FailingCaseCard({
  result,
  expanded,
  onToggle,
}: {
  result: EvalResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const weakest = [...result.dimensionScores]
    .sort((left, right) => left.score - right.score)
    .slice(0, 2);

  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{result.evalCaseId}</div>
          <div className="mt-1 text-xs text-slate-600">
            Score {result.weightedScore.toFixed(2)} · weakest {weakest.map((entry) => entry.dimension).join(", ")}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
        >
          {expanded ? "Hide details" : "View full output"}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {result.dimensionScores.filter((entry) => !entry.passed).slice(0, 3).map((entry) => (
          <div key={entry.dimension} className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600">
            <span className="font-semibold text-rose-700">{entry.dimension}</span> — {entry.reasoning}
          </div>
        ))}
      </div>

      {expanded ? (
        <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-white p-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Issues</div>
            <ul className="mt-2 space-y-1 text-xs text-slate-700">
              {result.issues.map((issue) => <li key={issue}>• {issue}</li>)}
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Recommendations</div>
            <ul className="mt-2 space-y-1 text-xs text-slate-700">
              {result.recommendations.map((recommendation) => <li key={recommendation}>• {recommendation}</li>)}
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Agent output excerpt</div>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
              {result.agentOutput}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
