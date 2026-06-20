import React, { useMemo, useState } from "react";
import { AgentScheduleManager } from "@/components/agents/AgentScheduleManager";
import { AgentTraceViewer } from "@/components/agents/AgentTraceViewer";
import { EvalDashboard } from "@/components/evals/EvalDashboard";
import { useAgentRun } from "@/hooks/useAgentRun";
import type { AgentRun } from "@/lib/adamSync";

interface AgentObservabilityViewProps {
  programId: string;
  programName?: string;
  projectData?: Record<string, unknown> | null;
}

function statusTone(status: AgentRun["status"]): string {
  switch (status) {
    case "complete":
      return "bg-emerald-100 text-emerald-700";
    case "paused":
      return "bg-amber-100 text-amber-700";
    case "failed":
    case "cancelled":
      return "bg-rose-100 text-rose-700";
    case "running":
      return "bg-cyan-100 text-cyan-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function isEvalAdmin(projectData: Record<string, unknown> | null): boolean {
  const explicitRole = typeof projectData?._currentUserRole === "string" ? projectData._currentUserRole : "";
  const explicitAdmin = projectData?._currentUserIsAdmin === true || explicitRole === "admin" || explicitRole === "owner";
  const signedIn = typeof projectData?._currentUserId === "string" && projectData._currentUserId.length > 0;
  const localOverride = typeof window !== "undefined" && window.localStorage.getItem("adam_eval_admin") === "true";
  return explicitAdmin || (signedIn && localOverride);
}

export function AgentObservabilityView({ programId, programName = "Program", projectData = null }: AgentObservabilityViewProps) {
  const { activeRuns, isRunning, resumeRun } = useAgentRun(programId);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const showEvalDashboard = useMemo(() => isEvalAdmin(projectData), [projectData]);

  const pausedRuns = useMemo(() => activeRuns.filter((run) => run.status === "paused"), [activeRuns]);
  const liveRuns = useMemo(() => activeRuns.filter((run) => run.status === "running"), [activeRuns]);

  const stats = useMemo(() => {
    const totalRuns = activeRuns.length;
    const runsWithConfidence = activeRuns.filter((run) => typeof run.confidence === "number");
    const averageConfidence = runsWithConfidence.length
      ? Math.round((runsWithConfidence.reduce((sum, run) => sum + Number(run.confidence || 0), 0) / runsWithConfidence.length) * 100)
      : 0;
    const artifacts = Object.values(((projectData?.phaseArtifacts as Record<string, Record<string, Record<string, unknown>>> | undefined) || {}))
      .flatMap((phaseArtifacts) => Object.values(phaseArtifacts || {}));
    const agentDraftArtifacts = artifacts.filter((artifact) => artifact?.agentDrafted);
    const acceptedArtifacts = agentDraftArtifacts.filter((artifact) => artifact?.status === "approved");
    const artifactAcceptanceRate = agentDraftArtifacts.length
      ? Math.round((acceptedArtifacts.length / agentDraftArtifacts.length) * 100)
      : 0;
    const completedRuns = activeRuns.filter((run) => run.started_at && run.completed_at);
    const averageResolutionMinutes = completedRuns.length
      ? Math.round(
          completedRuns.reduce((sum, run) => (
            sum + (new Date(run.completed_at || "").getTime() - new Date(run.started_at || "").getTime())
          ), 0) / completedRuns.length / 60000,
        )
      : 0;
    return {
      totalRuns,
      averageConfidence,
      artifactAcceptanceRate,
      averageResolutionMinutes,
    };
  }, [activeRuns, projectData]);

  return (
    <div className="space-y-6 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Agent observability</h2>
          <p className="mt-1 text-sm text-slate-500">
            Live execution, pauses, schedules, and traces for {programName}.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600">
          <span className={`h-2 w-2 rounded-full ${isRunning ? "bg-cyan-500" : "bg-slate-300"}`} />
          {isRunning ? "Agents active now" : "No active runs"}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {[
          { label: "Total runs", value: stats.totalRuns, tone: "text-slate-900" },
          { label: "Avg confidence", value: `${stats.averageConfidence}%`, tone: "text-cyan-700" },
          { label: "Artifact acceptance", value: `${stats.artifactAcceptanceRate}%`, tone: "text-emerald-700" },
          { label: "Avg resolution time", value: `${stats.averageResolutionMinutes}m`, tone: "text-amber-700" },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{card.label}</div>
            <div className={`mt-2 text-2xl font-semibold ${card.tone}`}>{card.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">Paused runs</h3>
            </div>
            <div className="divide-y divide-slate-200">
              {pausedRuns.length === 0 && (
                <div className="px-4 py-5 text-sm text-slate-500">No runs are waiting for human input.</div>
              )}
              {pausedRuns.map((run) => (
                <div key={run.id} className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{run.agent_id} · {run.phase_id}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Awaiting decision {run.awaiting_decision_id || "—"} · Started {run.started_at ? new Date(run.started_at).toLocaleString() : "—"}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedRunId(run.id)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
                    >
                      View trace
                    </button>
                    {run.awaiting_decision_id ? (
                      <button
                        type="button"
                        onClick={() => void resumeRun({
                          runId: run.id,
                          decisionId: run.awaiting_decision_id || "",
                          resolution: "approved",
                          humanNote: "Approved from observability console.",
                        })}
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800"
                      >
                        Resume
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">Run history</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {["Agent", "Phase", "Status", "Triggered by", "Started", "Confidence", "Trace"].map((header) => (
                      <th key={header} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeRuns.map((run) => (
                    <tr key={run.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-medium text-slate-900">{run.agent_id}</td>
                      <td className="px-4 py-3 text-slate-600">{run.phase_id}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusTone(run.status)}`}>
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{run.scheduled_by || "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{run.started_at ? new Date(run.started_at).toLocaleString() : "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{run.confidence != null ? `${Math.round(run.confidence * 100)}%` : "—"}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setSelectedRunId(run.id)}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                  {activeRuns.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                        No server-side agent runs recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">Active now</h3>
            </div>
            <div className="space-y-3 px-4 py-4">
              {liveRuns.length === 0 && (
                <div className="text-sm text-slate-500">No agents are actively running right now.</div>
              )}
              {liveRuns.map((run) => (
                <div key={run.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{run.agent_id}</div>
                      <div className="mt-1 text-xs text-slate-500">{run.phase_id}</div>
                    </div>
                    <span className="h-2.5 w-2.5 rounded-full bg-cyan-500 shadow-[0_0_0_6px_rgba(6,182,212,0.14)]" />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <AgentScheduleManager
            programId={programId}
            runs={activeRuns}
            onOpenTrace={(runId) => setSelectedRunId(runId)}
          />
        </div>
      </div>

      {showEvalDashboard ? (
        <EvalDashboard />
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
          Eval dashboard is limited to admin users. If you need local access in this environment, set <code className="rounded bg-white px-1 py-0.5 text-xs text-slate-700">localStorage.adam_eval_admin = "true"</code> while signed in.
        </section>
      )}

      {selectedRunId ? (
        <AgentTraceViewer runId={selectedRunId} onClose={() => setSelectedRunId(null)} />
      ) : null}
    </div>
  );
}
