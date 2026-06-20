import { useMemo, useState } from "react";
import { usePatternLibrary } from "@/new/lib/usePatternLibrary";
import { useAgentEvents } from "@/new/lib/useAgentEvents";
import { useArtifactHistory } from "@/new/lib/useArtifactHistory";
import { getAutonomyLevel, useAutonomy } from "@/new/lib/useAutonomy";

type AdamTab = "agents" | "patterns" | "activity" | "artifacts" | "autonomy";

type Props = {
  activeTab: AdamTab;
  programId: string;
  programData: Record<string, unknown>;
  industry?: string | null;
  isRunning: Record<string, boolean>;
  onRunAgent: (agentId: string, phaseId?: string) => Promise<boolean> | boolean;
  onReloadProgram?: () => Promise<void> | void;
};

const AGENTS: Array<{ id: string; label: string; description: string; kind?: "phase" | "program" }> = [
  { id: "narrative", label: "Narrative", description: "Executive summary and story arc for the program." },
  { id: "plan", label: "Plan", description: "Transformation plan, next actions, and sequence." },
  { id: "risk", label: "Risk", description: "RAID scan and mitigation analysis." },
  { id: "milestone", label: "Milestones", description: "Milestone derivation and schedule intelligence." },
  { id: "budget", label: "Budget", description: "Budget posture, burn, and ROI signals." },
  { id: "critical-path", label: "Critical Path", description: "Bottlenecks and sequencing risks." },
  { id: "gate-review", label: "Gate Review", description: "Per-phase readiness review and sign-off prep.", kind: "phase" },
  { id: "escalation", label: "Escalation", description: "Escalation scan for stuck risks, milestones, and decisions." },
  { id: "closure", label: "Closure", description: "Program closure readiness and archive pack." },
  { id: "change-impact", label: "Change Impact", description: "Org change load, impacted groups, and interventions." },
  { id: "stakeholder", label: "Stakeholders", description: "Stakeholder map, engagement posture, and actions." },
  { id: "adoption", label: "Adoption", description: "Adoption rate, readiness gaps, and intervention guidance." },
  { id: "health-heatmap", label: "Health Heatmap", description: "Program-wide RAG and momentum view." },
  { id: "retro", label: "Retrospective", description: "Per-phase lessons learned and action items.", kind: "phase" },
  { id: "deck", label: "Executive Deck", description: "Structured deck outline for sponsors and steering." },
  { id: "scope-pcr", label: "Scope & PCR", description: "Scope creep detection and PCR recommendations." },
  { id: "pattern-query", label: "Pattern Query", description: "Pull similar-program patterns into live agent context." },
  { id: "pattern-extract", label: "Pattern Extract", description: "Write reusable patterns back to the library." },
];

function getAgentTimestamp(programData: Record<string, unknown>, agentId: string): string | null {
  const closure = programData?.closure && typeof programData.closure === "object" ? programData.closure as Record<string, unknown> : {};
  const budgetTracking = programData?.budgetTracking && typeof programData.budgetTracking === "object" ? programData.budgetTracking as Record<string, unknown> : {};
  const criticalPath = programData?.criticalPath && typeof programData.criticalPath === "object" ? programData.criticalPath as Record<string, unknown> : {};
  const programNarrative = programData?.programNarrative && typeof programData.programNarrative === "object" ? programData.programNarrative as Record<string, unknown> : {};

  const timestamps: Record<string, string | null> = {
    narrative: typeof programData.narrativeGeneratedAt === "string" ? programData.narrativeGeneratedAt : (typeof programNarrative.generatedAt === "string" ? programNarrative.generatedAt : null),
    plan: typeof programData.planGeneratedAt === "string" ? programData.planGeneratedAt : null,
    risk: typeof programData.raidGeneratedAt === "string" ? programData.raidGeneratedAt : null,
    milestone: typeof programData.milestonesGeneratedAt === "string" ? programData.milestonesGeneratedAt : null,
    budget: typeof programData.budgetGeneratedAt === "string" ? programData.budgetGeneratedAt : (typeof budgetTracking.generatedAt === "string" ? budgetTracking.generatedAt : null),
    "critical-path": typeof programData.criticalPathGeneratedAt === "string" ? programData.criticalPathGeneratedAt : (typeof criticalPath.generatedAt === "string" ? criticalPath.generatedAt : null),
    escalation: typeof programData.escalationsLastCheckedAt === "string" ? programData.escalationsLastCheckedAt : null,
    closure: typeof programData.closureGeneratedAt === "string" ? programData.closureGeneratedAt : (typeof closure.generatedAt === "string" ? closure.generatedAt : null),
    "change-impact": typeof programData.changeImpactGeneratedAt === "string" ? programData.changeImpactGeneratedAt : null,
    stakeholder: typeof programData.stakeholderGeneratedAt === "string" ? programData.stakeholderGeneratedAt : (typeof programData.stakeholdersGeneratedAt === "string" ? programData.stakeholdersGeneratedAt : null),
    adoption: typeof programData.adoptionGeneratedAt === "string" ? programData.adoptionGeneratedAt : null,
    "health-heatmap": typeof programData.healthHeatmapGeneratedAt === "string" ? programData.healthHeatmapGeneratedAt : null,
    deck: typeof programData.deckGeneratedAt === "string" ? programData.deckGeneratedAt : null,
    "scope-pcr": typeof programData.scopePcrGeneratedAt === "string" ? programData.scopePcrGeneratedAt : null,
    "pattern-query": typeof programData.patternQueryCachedAt === "string" ? programData.patternQueryCachedAt : null,
    "pattern-extract": typeof programData.patternExtractGeneratedAt === "string" ? programData.patternExtractGeneratedAt : null,
  };

  return timestamps[agentId] || null;
}

function getAgentConfidence(programData: Record<string, unknown>, agentId: string): number | null {
  const recordFor = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null);
  const map: Record<string, number | null> = {
    narrative: typeof programData.narrativeConfidence === "number" ? programData.narrativeConfidence : (typeof recordFor(programData.programNarrative)?.confidence === "number" ? Number(recordFor(programData.programNarrative)?.confidence) : null),
    plan: typeof recordFor(programData.plan)?.confidence === "number" ? Number(recordFor(programData.plan)?.confidence) : null,
    budget: typeof recordFor(programData.budgetTracking)?.confidence === "number" ? Number(recordFor(programData.budgetTracking)?.confidence) : null,
    "critical-path": typeof recordFor(programData.criticalPath)?.confidence === "number" ? Number(recordFor(programData.criticalPath)?.confidence) : null,
    closure: typeof recordFor(programData.closure)?.confidence === "number" ? Number(recordFor(programData.closure)?.confidence) : null,
    "change-impact": typeof recordFor(programData.changeImpact)?.confidence === "number" ? Number(recordFor(programData.changeImpact)?.confidence) : null,
    stakeholder: typeof recordFor(programData.stakeholdersSummary)?.confidence === "number" ? Number(recordFor(programData.stakeholdersSummary)?.confidence) : null,
    adoption: typeof recordFor(programData.adoption)?.confidence === "number" ? Number(recordFor(programData.adoption)?.confidence) : null,
    "health-heatmap": typeof recordFor(programData.healthHeatmap)?.confidence === "number" ? Number(recordFor(programData.healthHeatmap)?.confidence) : null,
    deck: typeof recordFor(programData.deck)?.confidence === "number" ? Number(recordFor(programData.deck)?.confidence) : null,
    "scope-pcr": typeof recordFor(programData.scopePcr)?.confidence === "number" ? Number(recordFor(programData.scopePcr)?.confidence) : null,
  };
  return map[agentId] ?? null;
}

function formatDateTime(value: string | null): string {
  if (!value) return "Not yet run";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : "Not yet run";
}

function formatRelative(value: string): string {
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta) || delta < 0) return "just now";
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function inferPhaseTarget(programData: Record<string, unknown>, agentId: string): string {
  const phases = Array.isArray(programData.phases) ? programData.phases as Array<Record<string, unknown>> : [];
  if (!["gate-review", "retro"].includes(agentId)) return "program";
  const eligible = phases.filter((phase) => Number(phase?.pct || 0) >= 90);
  if (eligible.length > 0) return String(eligible[eligible.length - 1]?.id || "program");
  return String(phases.find((phase) => Number(phase?.pct || 0) > 0)?.id || "strategy");
}

export function AdamIntelligenceWorkspace({
  activeTab,
  programId,
  programData,
  industry,
  isRunning,
  onRunAgent,
  onReloadProgram,
}: Props) {
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const { currentProgramPatterns, similarPatterns, isLoading: patternsLoading } = usePatternLibrary(programId, industry || null);
  const { events, runningAgentIds, isLoading: eventsLoading } = useAgentEvents(programId);
  const { artifacts, isLoading: artifactsLoading, isRestoring, restoreArtifact } = useArtifactHistory(programId, onReloadProgram);
  const { settings, log, isLoading: autonomyLoading, upsertSetting, autonomousActionsToday } = useAutonomy(programId);

  const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId) || null;

  const agentCards = useMemo(() => AGENTS.map((agent) => {
    const phaseId = inferPhaseTarget(programData, agent.id);
    const key = `${agent.id}:${phaseId}`;
    const running = Boolean(isRunning[key] || isRunning[agent.id] || runningAgentIds.includes(key));
    return {
      ...agent,
      phaseId,
      running,
      lastRunAt: getAgentTimestamp(programData, agent.id),
      confidence: getAgentConfidence(programData, agent.id),
    };
  }), [isRunning, programData, runningAgentIds]);

  if (activeTab === "agents") {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agentCards.map((agent) => (
          <div key={`${agent.id}:${agent.phaseId}`} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-white shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                  {agent.kind === "phase" ? `Phase-scoped · ${agent.phaseId}` : "Program agent"}
                </div>
                <div className="mt-1 text-base font-semibold">{agent.label}</div>
                <p className="mt-1 text-sm leading-6 text-white/60">{agent.description}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${agent.running ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-white/70"}`}>
                {agent.running ? "Running" : "Idle"}
              </span>
            </div>
            <div className="space-y-2 text-sm text-white/70">
              <div className="flex items-center justify-between gap-3">
                <span>Last run</span>
                <span className="text-right text-white/85">{formatDateTime(agent.lastRunAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Confidence</span>
                <span className="text-right text-white/85">{typeof agent.confidence === "number" ? `${Math.round(agent.confidence * 100)}%` : "—"}</span>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void onRunAgent(agent.id, agent.phaseId)}
                disabled={agent.running || !programId}
                className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {agent.running ? "Running…" : "Run now"}
              </button>
              <span className="text-xs text-white/40">
                {agent.lastRunAt ? `Updated ${formatRelative(agent.lastRunAt)}` : "Awaiting first run"}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activeTab === "patterns") {
    return (
      <div className="space-y-5 text-white">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm font-semibold">Patterns extracted from this program</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {(currentProgramPatterns.length ? currentProgramPatterns : []).map((pattern) => (
              <div key={pattern.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-300">
                    {pattern.patternType}
                  </span>
                  <span className="text-xs text-white/45">{Math.round(pattern.confidence * 100)}%</span>
                </div>
                <div className="mt-2 font-medium">{pattern.title}</div>
                <div className="mt-1 text-sm leading-6 text-white/60">
                  {typeof pattern.body?.summary === "string" ? pattern.body.summary : JSON.stringify(pattern.body).slice(0, 180)}
                </div>
              </div>
            ))}
            {!currentProgramPatterns.length && !patternsLoading ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-black/10 p-4 text-sm text-white/50">
                No extracted patterns yet. They will appear here after gate approvals and closure cycles.
              </div>
            ) : null}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm font-semibold">From similar programs</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {similarPatterns.slice(0, 8).map((pattern) => (
              <div key={pattern.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-violet-300">
                    {pattern.patternType}
                  </span>
                  <span className="text-xs text-white/45">{pattern.industry || "Cross-industry"}</span>
                </div>
                <div className="mt-2 font-medium">{pattern.title}</div>
                <div className="mt-1 text-sm leading-6 text-white/60">
                  {typeof pattern.body?.summary === "string" ? pattern.body.summary : JSON.stringify(pattern.body).slice(0, 180)}
                </div>
              </div>
            ))}
            {!similarPatterns.length && !patternsLoading ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-black/10 p-4 text-sm text-white/50">
                No similar-program patterns are available yet for this industry lens.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === "activity") {
    return (
      <div className="space-y-3">
        {events.map((event) => (
          <div key={event.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-white">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${event.eventType === "failed" ? "bg-rose-400" : event.eventType === "triggered" ? "bg-amber-400" : "bg-emerald-400"}`} />
                <span className="font-medium">{event.agentId}</span>
                {event.phaseId ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">{event.phaseId}</span> : null}
              </div>
              <span className="text-xs text-white/45">{formatDateTime(event.createdAt)}</span>
            </div>
            <div className="mt-2 text-sm text-white/65">
              {event.eventType}
              {typeof event.payload?.confidence === "number" ? ` · confidence ${Math.round(Number(event.payload.confidence) * 100)}%` : ""}
            </div>
            {event.payload ? (
              <pre className="mt-3 overflow-x-auto rounded-xl bg-black/30 p-3 text-xs leading-6 text-white/60">{JSON.stringify(event.payload, null, 2)}</pre>
            ) : null}
          </div>
        ))}
        {!events.length && !eventsLoading ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 p-4 text-sm text-white/50">
            No agent activity has been recorded for this program yet.
          </div>
        ) : null}
      </div>
    );
  }

  if (activeTab === "artifacts") {
    return (
      <div className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
        <div className="space-y-3">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              onClick={() => setSelectedArtifactId(artifact.id)}
              className={`w-full rounded-2xl border p-4 text-left transition ${selectedArtifactId === artifact.id ? "border-sky-400 bg-sky-500/10 text-white" : "border-white/10 bg-white/5 text-white hover:bg-white/10"}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{artifact.agentId}</div>
                  <div className="mt-1 text-xs text-white/45">
                    {artifact.phaseId || "program"} · v{artifact.version}
                  </div>
                </div>
                <div className="text-right text-xs text-white/45">
                  <div>{formatDateTime(artifact.generatedAt)}</div>
                  <div>{typeof artifact.confidence === "number" ? `${Math.round(artifact.confidence * 100)}% confidence` : "No confidence"}</div>
                </div>
              </div>
            </button>
          ))}
          {!artifacts.length && !artifactsLoading ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 p-4 text-sm text-white/50">
              No artifact versions have been stored yet for this program.
            </div>
          ) : null}
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-white">
          {selectedArtifact ? (
            <>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{selectedArtifact.agentId}</div>
                  <div className="text-xs text-white/45">Version {selectedArtifact.version} · {selectedArtifact.phaseId || "program"}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void restoreArtifact(selectedArtifact.id)}
                  disabled={isRestoring}
                  className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRestoring ? "Restoring…" : "Restore"}
                </button>
              </div>
              <pre className="max-h-[520px] overflow-auto rounded-xl bg-black/30 p-3 text-xs leading-6 text-white/65">
                {JSON.stringify(selectedArtifact.content, null, 2)}
              </pre>
            </>
          ) : (
            <div className="text-sm text-white/50">Select an artifact version to inspect or restore it.</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-white">
      <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
        Enabling L4 autonomy means ADAM will apply agent outputs without human confirmation. Only enable agents you fully trust.
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
        Autonomous actions today: <span className="font-semibold text-white">{autonomousActionsToday}</span>
      </div>
      <div className="space-y-3">
        {AGENTS.map((agent) => {
          const setting = settings.find((entry) => entry.agentId === agent.id);
          const confidence = getAgentConfidence(programData, agent.id) ?? undefined;
          const level = getAutonomyLevel(agent.id, confidence, settings);
          return (
            <div key={agent.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">{agent.label}</div>
                  <div className="text-sm text-white/55">{agent.description}</div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  level === "autonomous"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : level === "supervised"
                      ? "bg-amber-500/15 text-amber-300"
                      : level === "manual"
                        ? "bg-slate-500/15 text-slate-300"
                        : "bg-sky-500/15 text-sky-300"
                }`}>
                  {level}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={setting?.enabled === true}
                    onChange={(event) => void upsertSetting(agent.id, { enabled: event.target.checked })}
                  />
                  Enable autonomy
                </label>
                <label className="flex items-center gap-2">
                  <span>Threshold</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={setting?.trustThreshold ?? 0.85}
                    onChange={(event) => void upsertSetting(agent.id, { trustThreshold: Number(event.target.value) })}
                  />
                  <span>{((setting?.trustThreshold ?? 0.85) * 100).toFixed(0)}%</span>
                </label>
              </div>
            </div>
          );
        })}
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="mb-3 text-sm font-semibold">Autonomy log</div>
        <div className="space-y-2">
          {log.map((entry) => (
            <div key={entry.id} className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{entry.agentId} · {entry.actionType}</span>
                <span className="text-xs text-white/45">{formatDateTime(entry.createdAt)}</span>
              </div>
              <div className="mt-1 text-white/55">
                {entry.actedAutonomously ? "Autonomous" : "Queued"}{typeof entry.confidence === "number" ? ` · ${Math.round(entry.confidence * 100)}% confidence` : ""}
              </div>
              <div className="mt-1 text-white/50">{entry.reason}</div>
            </div>
          ))}
          {!log.length && !autonomyLoading ? (
            <div className="text-sm text-white/50">No autonomy actions have been logged yet.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
