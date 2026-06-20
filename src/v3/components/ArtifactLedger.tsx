import React from "react";
import type { ArtifactNode, PhaseArtifactSummary } from "@/v3/lib/artifactModel";
import { getAgentMeta } from "@/v3/lib/agentMeta";

const STATE_META: Record<ArtifactNode["state"], { label: string; color: string }> = {
  missing: { label: "Missing", color: "var(--v3-red)" },
  draft: { label: "Draft", color: "var(--v3-amber)" },
  ready: { label: "Ready", color: "var(--v3-accent)" },
  approved: { label: "Approved", color: "var(--v3-green)" },
  archived: { label: "Archived", color: "var(--v3-text-muted)" },
};

const ORIGIN_LABEL: Record<ArtifactNode["origin"], string> = {
  generated: "Generated",
  uploaded: "Uploaded",
  required: "Required",
};

function lineageLabel(agentId: string): string {
  const meta = getAgentMeta(agentId);
  return meta.outputArtifact || meta.label || agentId;
}

/** Why agents can (or cannot) generate artifacts for this phase. */
export interface GenerationHint {
  canGenerate: boolean;
  /** Plain-language reason — names the unmet precondition when blocked. */
  reason: string;
}

function GenerationBanner({ hint }: { hint: GenerationHint }) {
  const blocked = !hint.canGenerate;
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        padding: "8px 10px",
        border: `1px solid ${blocked ? "var(--v3-amber)" : "var(--v3-border)"}`,
        borderLeft: `3px solid ${blocked ? "var(--v3-amber)" : "var(--v3-accent)"}`,
        borderRadius: "var(--v3-radius)",
        background: "var(--v3-surface-2)",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 12, color: blocked ? "var(--v3-amber)" : "var(--v3-accent)" }}>
        {blocked ? "⚠" : "✨"}
      </span>
      <div style={{ fontSize: 11, color: "var(--v3-text-secondary)", lineHeight: 1.5 }}>
        {blocked ? (
          <>
            <strong style={{ color: "var(--v3-text-primary)" }}>Agents can't generate artifacts yet.</strong> {hint.reason}
          </>
        ) : (
          hint.reason
        )}
      </div>
    </div>
  );
}

function ArtifactRow({
  node,
  onOpen,
  onDownload,
}: {
  node: ArtifactNode;
  onOpen?: (artifactId: string) => void;
  onDownload?: (artifactId: string) => void;
}) {
  const state = STATE_META[node.state];
  const clickable = node.present && node.artifactId && onOpen;
  return (
    <div
      className="v3-artifact-ledger-row"
      style={{
        display: "grid",
        gap: 6,
        padding: "10px 12px",
        border: "1px solid var(--v3-border)",
        borderLeft: `3px solid ${state.color}`,
        borderRadius: "var(--v3-radius)",
        background: node.present ? "var(--v3-surface)" : "var(--v3-surface-2)",
        opacity: node.present ? 1 : 0.85,
        cursor: clickable ? "pointer" : "default",
      }}
      onClick={clickable ? () => onOpen!(node.artifactId!) : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)", flex: 1, minWidth: 0 }}>
          {node.label}
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, color: state.color, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {state.label}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "var(--v3-text-muted)", border: "1px solid var(--v3-border)", borderRadius: 20, padding: "1px 7px" }}>
          {node.required ? "Required" : "Additional"}
        </span>
        {node.present ? (
          <span style={{ fontSize: 10, color: "var(--v3-text-muted)", border: "1px solid var(--v3-border)", borderRadius: 20, padding: "1px 7px" }}>
            {ORIGIN_LABEL[node.origin]}
          </span>
        ) : null}
        {typeof node.quality === "number" ? (
          <span style={{ fontSize: 10, fontWeight: 600, color: node.quality >= 80 ? "var(--v3-green)" : node.quality >= 60 ? "var(--v3-amber)" : "var(--v3-red)" }}>
            {node.quality}% quality
          </span>
        ) : null}
        {node.evidence ? (
          <span style={{ fontSize: 10, color: "var(--v3-text-muted)" }}>· {node.evidence}</span>
        ) : null}
      </div>

      {node.downstream.length || node.upstream.length ? (
        <div style={{ fontSize: 10, color: "var(--v3-text-muted)", lineHeight: 1.5 }}>
          {node.upstream.length ? (
            <span>Builds on {node.upstream.map(lineageLabel).join(", ")}. </span>
          ) : null}
          {node.downstream.length ? (
            <span>Feeds {node.downstream.map(lineageLabel).join(", ")}.</span>
          ) : null}
        </div>
      ) : null}

      {node.present && node.artifactId ? (
        <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
          {onOpen ? (
            <button
              type="button"
              className="v3-button ghost"
              style={{ fontSize: 11, padding: "3px 8px" }}
              onClick={(e) => { e.stopPropagation(); onOpen(node.artifactId!); }}
            >
              Open →
            </button>
          ) : null}
          {onDownload ? (
            <button
              type="button"
              className="v3-button ghost"
              style={{ fontSize: 11, padding: "3px 8px" }}
              onClick={(e) => { e.stopPropagation(); onDownload(node.artifactId!); }}
            >
              Download
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ArtifactLedger({
  phase,
  onOpenArtifact,
  onDownloadArtifact,
  generationHint,
}: {
  phase: PhaseArtifactSummary | null;
  onOpenArtifact?: (artifactId: string) => void;
  onDownloadArtifact?: (artifactId: string) => void;
  generationHint?: GenerationHint | null;
}) {
  if (!phase) {
    return <div className="v3-context-artifacts-empty">No artifact data for this phase yet.</div>;
  }

  const coverage = phase.required > 0 ? Math.round((phase.present / phase.required) * 100) : 100;

  // Surface the generation hint when nothing has been generated yet but the phase
  // still has gaps to fill — either explaining the blocker, or prompting a run.
  const hasGenerated = phase.artifacts.some((node) => node.present && node.origin === "generated");
  const hasGaps = phase.artifacts.some((node) => node.required && !node.present);
  const showHint = !!generationHint && (!generationHint.canGenerate || (!hasGenerated && hasGaps));

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {showHint && generationHint ? <GenerationBanner hint={generationHint} /> : null}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--v3-text-secondary)" }}>
          <strong style={{ color: "var(--v3-text-primary)" }}>{phase.present}</strong> of {phase.required} required artifacts present
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: coverage >= 80 ? "var(--v3-green)" : coverage >= 50 ? "var(--v3-amber)" : "var(--v3-red)" }}>
          {coverage}% complete
        </span>
        {typeof phase.avgQuality === "number" ? (
          <span style={{ fontSize: 11, color: "var(--v3-text-muted)", marginLeft: "auto" }}>
            Avg quality {phase.avgQuality}%
          </span>
        ) : null}
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {phase.artifacts.map((node) => (
          <ArtifactRow key={node.key} node={node} onOpen={onOpenArtifact} onDownload={onDownloadArtifact} />
        ))}
        {!phase.artifacts.length ? (
          <div className="v3-context-artifacts-empty">No artifacts defined for this phase.</div>
        ) : null}
      </div>
    </div>
  );
}

export default ArtifactLedger;
