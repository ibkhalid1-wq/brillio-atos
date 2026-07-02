import React, { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import { timeAgo } from "@/v3/utils";
import {
  classifyFinding,
  domainLabel,
  FINDING_CLASS_ORDER,
  FINDING_CLASS_DESCRIPTION,
  type FindingClass,
  type ValidationDomain,
} from "@/v3/lib/crossArtifactValidation";

const CLASS_COLOR: Record<FindingClass, string> = {
  Ontology: "#6366f1",
  Governance: "#f59e0b",
  Change: "#22c55e",
  Completeness: "#94a3b8",
};

/**
 * Per-phase validation audit.
 *
 * Opens the *latest* cross-artifact-validator run for one phase and shows the
 * three things that make the AI verdict auditable: the prompt context the model
 * was given ("what was checked"), the raw findings it returned ("the response"),
 * and — when present — its reasoning trace. It reads the run straight from
 * `adam_agent_runs` (self-fetching, like AgentTraceDrawer) so it works even after
 * the run has aged out of the in-memory `activeRuns` window.
 *
 * Read-only: this surface never triggers a run. Validation is user-initiated from
 * the Ontology "Validate" buttons; this just lets the user inspect what happened.
 */

interface AuditRun {
  id: string;
  agent_id: string;
  phase_id: string;
  status: string;
  confidence: number | null;
  tokens_used: number | null;
  input_context: unknown;
  output: unknown;
  reasoning_trace: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface PhaseAuditModalProps {
  programId: string;
  phaseId: string;
  phaseLabel: string;
  onClose: () => void;
}

function formatValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    // Some contexts are a JSON string — pretty-print when it parses, else raw.
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return value;
      }
    }
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Pull the fully-assembled prompt (system + user) the edge function persisted on
 * the run. Present on validator runs from the fullPrompt-capable edge build; older
 * runs won't have it, in which case the caller falls back to the raw context.
 */
function extractFullPrompt(inputContext: unknown): { system: string; user: string } | null {
  if (!inputContext || typeof inputContext !== "object") return null;
  const fp = (inputContext as Record<string, unknown>).fullPrompt;
  if (!fp || typeof fp !== "object") return null;
  const record = fp as Record<string, unknown>;
  const system = typeof record.system === "string" ? record.system : "";
  const user = typeof record.user === "string" ? record.user : "";
  if (!system && !user) return null;
  return { system, user };
}

/** Pull the finding list out of the validator output regardless of wrapper shape. */
function extractFindings(output: unknown): Array<Record<string, unknown>> {
  if (!output || typeof output !== "object") return [];
  const container = output as Record<string, unknown>;
  const raw = Array.isArray(container.findings)
    ? container.findings
    : Array.isArray((container.result as Record<string, unknown> | undefined)?.findings)
      ? ((container.result as Record<string, unknown>).findings as unknown[])
      : [];
  return raw.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
}

/** The links the validator traced and found intact — its "what I verified" summary. */
function extractCheckedChain(output: unknown): string[] {
  if (!output || typeof output !== "object") return [];
  const container = output as Record<string, unknown>;
  const raw = Array.isArray(container.checkedChain)
    ? container.checkedChain
    : Array.isArray((container.result as Record<string, unknown> | undefined)?.checkedChain)
      ? ((container.result as Record<string, unknown>).checkedChain as unknown[])
      : [];
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {title}
      </div>
      {subtitle ? (
        <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 2, marginBottom: 8 }}>{subtitle}</div>
      ) : (
        <div style={{ height: 8 }} />
      )}
      {children}
    </div>
  );
}

function CodeBlock({ text }: { text: string }) {
  return (
    <pre
      style={{
        margin: 0, padding: "10px 12px", borderRadius: 8,
        background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)",
        fontSize: 12, lineHeight: 1.5, color: "var(--v3-text-secondary)",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
        maxHeight: 320, overflow: "auto",
      }}
    >
      {text}
    </pre>
  );
}

export default function PhaseAuditModal({ programId, phaseId, phaseLabel, onClose }: PhaseAuditModalProps) {
  const [run, setRun] = useState<AuditRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which class buckets are collapsed. Empty = all expanded (default).
  const [collapsedClasses, setCollapsedClasses] = useState<Set<FindingClass>>(new Set());

  const toggleClass = (cls: FindingClass) =>
    setCollapsedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(cls)) next.delete(cls);
      else next.add(cls);
      return next;
    });

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    void supabase
      .from("adam_agent_runs")
      .select("id, agent_id, phase_id, status, confidence, tokens_used, input_context, output, reasoning_trace, started_at, completed_at, created_at")
      .eq("program_id", programId)
      .eq("agent_id", "cross-artifact-validator")
      .eq("phase_id", phaseId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error: queryError }: { data: AuditRun | null; error: { message: string } | null }) => {
        if (cancelled) return;
        if (queryError) {
          setError(queryError.message || "Failed to load the validation run.");
          return;
        }
        setRun(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [programId, phaseId]);

  const findings = useMemo(() => (run ? extractFindings(run.output) : []), [run]);
  const checkedChain = useMemo(() => (run ? extractCheckedChain(run.output) : []), [run]);
  const fullPrompt = useMemo(() => (run ? extractFullPrompt(run.input_context) : null), [run]);
  // Group findings by top-level class (Ontology / Governance / Change /
  // Completeness) in the shared order, so the audit reads as classified buckets.
  const groupedFindings = useMemo(() => {
    const groups = new Map<FindingClass, Array<Record<string, unknown>>>();
    for (const f of findings) {
      const cls = classifyFinding((typeof f.domain === "string" ? f.domain : "delivery-readiness") as ValidationDomain);
      const bucket = groups.get(cls) ?? [];
      bucket.push(f);
      groups.set(cls, bucket);
    }
    return FINDING_CLASS_ORDER
      .filter((cls) => groups.has(cls))
      .map((cls) => ({ cls, items: groups.get(cls)! }));
  }, [findings]);
  const durationSec = run?.started_at && run?.completed_at
    ? ((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1)
    : null;

  return (
    <>
      <div className="v3-sheet-overlay" onClick={onClose} />
      <div className="v3-sheet" style={{ width: "min(680px, 100vw)" }}>
        <div className="v3-sheet-header">
          <div>
            <div className="v3-sheet-title">Validation audit</div>
            <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 2 }}>
              {phaseLabel} · cross-artifact validator
            </div>
          </div>
          <button className="v3-sheet-close" onClick={onClose}>×</button>
        </div>

        <div className="v3-sheet-body">
          {loading ? (
            <div style={{ display: "grid", gap: 8 }}>
              {[1, 2, 3, 4].map((i) => <div key={i} className="v3-skeleton" style={{ height: 48, borderRadius: 8 }} />)}
            </div>
          ) : error ? (
            <div style={{ color: "var(--v3-red)", fontSize: 13 }}>{error}</div>
          ) : !run ? (
            <div style={{ color: "var(--v3-text-muted)", fontSize: 13, lineHeight: 1.6 }}>
              No validation has been run for this phase yet. Click <strong>Validate</strong> on the phase to run the
              cross-artifact validator — its prompt, what it checked, and its response will appear here.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
                <span className={`v3-chip ${run.status === "complete" ? "green" : run.status === "failed" ? "red" : "amber"}`}>{run.status}</span>
                {run.confidence !== null ? (
                  <span className={`v3-chip ${run.confidence >= 0.8 ? "green" : run.confidence >= 0.6 ? "amber" : "red"}`}>
                    {Math.round(run.confidence * 100)}% confidence
                  </span>
                ) : null}
                {findings.length > 0 ? (
                  <span className="v3-chip amber">{findings.length} finding{findings.length > 1 ? "s" : ""}</span>
                ) : (
                  <span className="v3-chip green">clean</span>
                )}
                {durationSec ? <span className="v3-chip muted">{durationSec}s</span> : null}
                {run.tokens_used ? <span className="v3-chip muted">{run.tokens_used.toLocaleString()} tokens</span> : null}
                <span className="v3-chip muted">{timeAgo(run.completed_at || run.created_at)}</span>
              </div>

              {fullPrompt ? (
                <>
                  <Section
                    title="AI prompt · system"
                    subtitle="The full instruction set the validator was given — its role, the phase intent, the objective knowledge graph, the integrity checks and the required output schema."
                  >
                    <CodeBlock text={fullPrompt.system || "No system prompt recorded."} />
                  </Section>
                  <Section
                    title="AI prompt · user (what was checked)"
                    subtitle="The input context the validator reasoned over — objective, phase intent, delivery-chain knowledge graph and artifacts."
                  >
                    <CodeBlock text={fullPrompt.user || "No user prompt recorded."} />
                  </Section>
                </>
              ) : (
                <Section
                  title="What was checked"
                  subtitle="The prompt context sent to the validator — the objective, phase intent, delivery-chain knowledge graph and artifacts it reasoned over. (Run again to capture the complete system + user prompt.)"
                >
                  <CodeBlock text={formatValue(run.input_context) || "No input context recorded."} />
                </Section>
              )}

              <Section
                title="Response"
                subtitle={findings.length > 0
                  ? "The findings the validator returned, classified into Ontology / Governance / Change / Completeness. Each names the gap, a recommendation, and what it was checked against."
                  : "The validator returned no cross-artifact gaps for this phase."}
              >
                {findings.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {groupedFindings.map(({ cls, items }) => {
                      const collapsed = collapsedClasses.has(cls);
                      return (
                      <div key={cls} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => toggleClass(cls)}
                          aria-expanded={!collapsed}
                          title={`${FINDING_CLASS_DESCRIPTION[cls]} — click to ${collapsed ? "show" : "hide"}.`}
                          style={{
                            display: "flex", alignItems: "center", gap: 8, width: "100%",
                            background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left",
                          }}
                        >
                          <span style={{ fontSize: 10, color: "var(--v3-text-muted)", width: 10, display: "inline-block", transition: "transform 0.15s", transform: collapsed ? "rotate(0deg)" : "rotate(90deg)" }}>▶</span>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: CLASS_COLOR[cls] }} />
                          <span style={{ fontSize: 12, fontWeight: 700, color: CLASS_COLOR[cls] }}>{cls}</span>
                          <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>{items.length}</span>
                        </button>
                        {collapsed ? null : items.map((f, index) => (
                          <div
                            key={(typeof f.findingId === "string" && f.findingId) || `${cls}-${index}`}
                            style={{ padding: "10px 12px", borderRadius: 8, background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderLeft: `3px solid ${CLASS_COLOR[cls]}` }}
                          >
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                              {typeof f.severity === "string" ? (
                                <span className="v3-chip muted" style={{ fontSize: 10 }}>{f.severity}</span>
                              ) : null}
                              {typeof f.domain === "string" ? (
                                <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>{domainLabel(f.domain)}</span>
                              ) : null}
                            </div>
                            {typeof f.issue === "string" ? (
                              <div style={{ fontSize: 13, color: "var(--v3-text-primary)" }}>{f.issue}</div>
                            ) : null}
                            {typeof f.recommendation === "string" && f.recommendation ? (
                              <div style={{ fontSize: 12, color: "var(--v3-accent)", marginTop: 2 }}>→ {f.recommendation}</div>
                            ) : null}
                            {Array.isArray(f.evidence) && f.evidence.length > 0 ? (
                              <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 4 }}>
                                checked against: {(f.evidence as unknown[]).filter((e) => typeof e === "string").join("; ")}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      );
                    })}
                  </div>
                ) : checkedChain.length > 0 ? (
                  <div style={{ fontSize: 13, color: "var(--v3-text-secondary)" }}>
                    No gaps — see “Verified intact” below for what was traced.
                  </div>
                ) : (
                  <CodeBlock text={formatValue(run.output) || "No response recorded."} />
                )}
              </Section>

              {checkedChain.length > 0 ? (
                <Section
                  title="Verified intact"
                  subtitle="The links the validator traced and found sound — what a clean (or partial) verdict is actually backed by."
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {checkedChain.map((line, index) => (
                      <div key={index} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <span style={{ marginTop: 5, flexShrink: 0, width: 6, height: 6, borderRadius: "50%", background: "var(--v3-green, #22c55e)" }} />
                        <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", lineHeight: 1.5 }}>{line}</div>
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}

              {run.reasoning_trace ? (
                <Section title="Reasoning trace" subtitle="How the validator arrived at its verdict.">
                  <CodeBlock text={run.reasoning_trace} />
                </Section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
