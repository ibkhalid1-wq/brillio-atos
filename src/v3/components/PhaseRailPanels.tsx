import React, { useMemo, useState } from "react";
import type { DecisionSummary, ProgramSummary, RAIDEntry, RAIDEntryType } from "@/new/types";
import { buildPhaseArtifacts } from "@/v3/lib/artifactModel";
import { selectBlockers, selectRisks } from "@/v3/lib/programRaid";
import { getPhaseArtifactDefs } from "@/v3/lib/phaseArtifacts";
import { getPhaseInputSchema } from "@/v3/lib/phaseInputSchema";
import { PROVENANCE_KEY, parseProvenance, provenanceMatches } from "@/new/lib/fieldProvenance";
import { AdamCard, AdamCardBody } from "@/v3/components/ui/AdamCard";
import { ArtifactMapTree } from "@/v3/components/ArtifactMapTree";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";
import { StatusBadge } from "@/v3/components/ui/StatusBadge";
import type { V3MoreView } from "@/v3/types";

/**
 * PhaseRailPanels — the canonical Programme right-rail surface. Two tabbed
 * sections, each self-contained:
 *
 *   • Actions      → Actions (open decisions) · Risks · Blockers, read-only
 *                    lists that deep-link to the decision queue / RAID log.
 *   • Intelligence → Artifacts · Graph · Uploads. Artifacts open a content
 *                    modal; uploads list imported source content for download.
 */

type RaidDraft = {
  type: RAIDEntryType;
  title: string;
  description: string;
  severity: RAIDEntry["severity"];
  phase: string;
  mitigation?: string;
};

type PhaseRailPanelsProps = {
  program: ProgramSummary;
  phaseId: string;
  decisions: DecisionSummary[];
  agentsAvailable?: boolean;
  /** Retained for call-site compatibility; the rail no longer raises items inline. */
  onAddDecision?: (decision: Omit<DecisionSummary, "id" | "status" | "createdAt">) => Promise<void>;
  /** Retained for call-site compatibility; the rail no longer raises items inline. */
  onAddRaid?: (draft: RaidDraft) => Promise<void>;
  onCloseRaid: (entryId: string, note?: string) => Promise<void>;
  onOpenDecide: () => void;
  onRunAgent: (agentId: string) => void;
  onOpenMoreView: (view: V3MoreView) => void;
  onUploadDocument: () => void;
};

type PrimaryTab = "actions" | "intelligence";
type ActionTab = "actions" | "blockers" | "risks";
type IntelTab = "artifacts" | "graph" | "uploads";

type UploadItem = { fieldId: string; label: string; source: string; value: string };

type ArtifactModalData = { label: string; statusLabel: string; tone: string; score: number | null; content: string };

function priorityVariant(value: string): "critical" | "high" | "medium" | "low" {
  if (value === "critical") return "critical";
  if (value === "high") return "high";
  if (value === "low") return "low";
  return "medium";
}

function severityTone(value: string): "red" | "amber" | "blue" {
  if (value === "critical") return "red";
  if (value === "high") return "amber";
  return "blue";
}

// Resolve the programme's nested data bucket (rawData or rawData.data).
function getDataBucket(program: ProgramSummary): Record<string, unknown> | null {
  const raw = program.rawData as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  return raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
    ? (raw.data as Record<string, unknown>)
    : raw;
}

function triggerDownload(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

function RailModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="v3-rail-modal-overlay" role="presentation" onClick={onClose}>
      <div className="v3-rail-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="v3-rail-modal-head">
          <span className="v3-rail-modal-title">{title}</span>
          <button type="button" className="v3-rail-modal-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="v3-rail-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function PhaseRailPanels({
  program,
  phaseId,
  decisions,
  agentsAvailable = true,
  onCloseRaid,
  onOpenDecide,
  onRunAgent,
  onOpenMoreView,
  onUploadDocument,
}: PhaseRailPanelsProps) {
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>("actions");
  const [actionTab, setActionTab] = useState<ActionTab>("actions");
  const [intelTab, setIntelTab] = useState<IntelTab>("artifacts");
  const [closingId, setClosingId] = useState<string | null>(null);
  const [openArtifact, setOpenArtifact] = useState<ArtifactModalData | null>(null);

  const blockers = useMemo(() => selectBlockers(program, { phaseId }), [program, phaseId]);
  const risks = useMemo(() => selectRisks(program, { phaseId }), [program, phaseId]);

  // Full artifact bodies for the current phase, keyed by artifact/def id.
  const artifactContentById = useMemo(() => {
    const map = new Map<string, string>();
    const bucket = getDataBucket(program);
    const phaseBucket = bucket?.phaseArtifacts && typeof bucket.phaseArtifacts === "object" && !Array.isArray(bucket.phaseArtifacts)
      ? (bucket.phaseArtifacts as Record<string, unknown>)[phaseId]
      : null;
    if (!phaseBucket || typeof phaseBucket !== "object") return map;
    for (const [artifactId, value] of Object.entries(phaseBucket as Record<string, unknown>)) {
      const entry = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
      if (!entry) continue;
      const content = typeof entry.content === "string" && entry.content.trim()
        ? entry.content
        : typeof entry.contentSummary === "string" ? entry.contentSummary : "";
      if (content.trim()) map.set(artifactId, content);
    }
    return map;
  }, [program, phaseId]);

  const artifacts = useMemo(() => {
    const summary = buildPhaseArtifacts(program, phaseId);
    const byKey = new Map((summary?.artifacts ?? []).map((node) => [node.key, node]));
    // Mirror the Programme artifacts column: Narrative leads as its own inline
    // preview there, so it is excluded from the artifact-chip list on both
    // surfaces. Counts are derived from the displayed defs to stay consistent.
    const defs = getPhaseArtifactDefs(phaseId).filter((def) => def.id !== "narrative");
    const required = defs.length;
    const present = defs.filter((def) => byKey.get(def.id)?.present).length;
    return { defs, byKey, present, required };
  }, [program, phaseId]);

  // Imported source content for this phase, derived from field provenance. Only
  // values that still match the imported snapshot are listed (a hand-edit drops
  // the entry), so the uploads list never mislabels content the PM rewrote.
  const uploads = useMemo<UploadItem[]>(() => {
    const bucket = getDataBucket(program);
    const phaseInputs = bucket?.phaseInputs && typeof bucket.phaseInputs === "object" && !Array.isArray(bucket.phaseInputs)
      ? (bucket.phaseInputs as Record<string, Record<string, string>>)[phaseId] ?? {}
      : {};
    const provenance = parseProvenance((phaseInputs as Record<string, unknown>)[PROVENANCE_KEY]);
    const labels = new Map(getPhaseInputSchema(phaseId).fields.map((field) => [field.id, field.label]));
    const items: UploadItem[] = [];
    for (const [fieldId, prov] of Object.entries(provenance)) {
      const live = phaseInputs[fieldId];
      if (!provenanceMatches(prov, live)) continue;
      items.push({ fieldId, label: labels.get(fieldId) ?? fieldId, source: prov.source, value: typeof live === "string" ? live : prov.value });
    }
    return items;
  }, [program, phaseId]);

  const actionTabs: { id: ActionTab; label: string; count: number }[] = [
    { id: "actions", label: "Actions", count: decisions.length },
    { id: "risks", label: "Risks", count: risks.length },
    { id: "blockers", label: "Blockers", count: blockers.length },
  ];
  const openActionCount = decisions.length + blockers.length + risks.length;
  const intelTabs: { id: IntelTab; label: string }[] = [
    { id: "artifacts", label: "Artifacts" },
    { id: "graph", label: "Graph" },
    { id: "uploads", label: "Uploads" },
  ];

  const closeRaid = async (entryId: string) => {
    setClosingId(entryId);
    try {
      await onCloseRaid(entryId);
    } finally {
      setClosingId(null);
    }
  };

  const primaryTabs: { id: PrimaryTab; label: string; count: number }[] = [
    { id: "actions", label: "Action Center", count: openActionCount },
    { id: "intelligence", label: "Intelligence", count: artifacts.required },
  ];

  const openArtifactModal = (defLabel: string, defId: string, statusLabel: string, tone: string, score: number | null) => {
    setOpenArtifact({
      label: defLabel,
      statusLabel,
      tone,
      score,
      content: artifactContentById.get(defId) ?? "",
    });
  };

  return (
    <div className="v3-rail-panels">
      <div className="v3-rail-primary-tabs" role="tablist" aria-label="Phase rail sections">
        {primaryTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={primaryTab === tab.id}
            className={`v3-rail-primary-tab ${primaryTab === tab.id ? "is-active" : ""}`}
            onClick={() => setPrimaryTab(tab.id)}
          >
            {tab.label}
            {tab.count > 0 ? <span className="v3-action-tab-count">{tab.count}</span> : null}
          </button>
        ))}
      </div>

      {/* ACTION CENTER */}
      {primaryTab === "actions" ? (
      <AdamCard>
        <AdamCardBody>
          <div className="v3-action-tabs v3-action-tabs--rail" role="tablist" aria-label="Phase actions">
            {actionTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={actionTab === tab.id}
                className={`v3-action-tab ${actionTab === tab.id ? "is-active" : ""}`}
                onClick={() => setActionTab(tab.id)}
              >
                {tab.label}
                <span className="v3-action-tab-count">{tab.count}</span>
              </button>
            ))}
          </div>

          {actionTab === "actions" ? (
            decisions.length ? (
              <div className="v3-rail-list">
                {decisions.slice(0, 5).map((decision) => (
                  <div
                    key={decision.id}
                    className="v3-rail-item is-clickable"
                    role="button"
                    tabIndex={0}
                    aria-label={`Open action: ${decision.question || decision.title || "Open decision"}`}
                    onClick={() => onOpenDecide()}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenDecide(); } }}
                  >
                    <div className="v3-rail-item-head">
                      <StatusBadge variant={priorityVariant(decision.priority)} size="sm" />
                      <span className="v3-rail-item-title">{decision.question || decision.title || "Open decision"}</span>
                    </div>
                    {decision.recommendation ? <div className="v3-rail-item-sub">{decision.recommendation}</div> : null}
                  </div>
                ))}
                <button type="button" className="v3-button ghost v3-button-inline-xs v3-rail-footer-link" onClick={onOpenDecide}>Open Action Center →</button>
              </div>
            ) : (
              <div className="v3-rail-empty">No open decisions for this phase.</div>
            )
          ) : null}

          {actionTab === "blockers" ? (
            blockers.length ? (
              <div className="v3-rail-list">
                {blockers.map((entry) => (
                  <div
                    key={entry.id}
                    className="v3-rail-item is-clickable"
                    role="button"
                    tabIndex={0}
                    aria-label={`Open blocker in RAID log: ${entry.title}`}
                    onClick={() => onOpenMoreView("risks")}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenMoreView("risks"); } }}
                  >
                    <div className="v3-rail-item-head">
                      <span className={`v3-chip v3-chip-tight ${severityTone(entry.severity)}`}>{entry.severity}</span>
                      <span className="v3-rail-item-title">{entry.title}</span>
                    </div>
                    {entry.description ? <div className="v3-rail-item-sub">{entry.description}</div> : null}
                    <div className="v3-rail-item-foot">
                      <span className="v3-rail-item-age"><RelativeTime date={entry.createdAt} /></span>
                      <button type="button" className="v3-button ghost v3-button-inline-xs" disabled={closingId === entry.id} onClick={(event) => { event.stopPropagation(); void closeRaid(entry.id); }}>{closingId === entry.id ? "Resolving…" : "Resolve"}</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="v3-rail-empty">No open blockers — nothing standing in the way.</div>
            )
          ) : null}

          {actionTab === "risks" ? (
            risks.length ? (
              <div className="v3-rail-list">
                {risks.map((entry) => (
                  <div
                    key={entry.id}
                    className="v3-rail-item is-clickable"
                    role="button"
                    tabIndex={0}
                    aria-label={`Open risk in RAID log: ${entry.title}`}
                    onClick={() => onOpenMoreView("risks")}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenMoreView("risks"); } }}
                  >
                    <div className="v3-rail-item-head">
                      <span className={`v3-chip v3-chip-tight ${severityTone(entry.severity)}`}>{entry.severity}</span>
                      <span className="v3-rail-item-title">{entry.title}</span>
                    </div>
                    {entry.description ? <div className="v3-rail-item-sub">{entry.description}</div> : null}
                    {entry.mitigation ? <div className="v3-rail-item-sub">Mitigation: {entry.mitigation}</div> : null}
                    <div className="v3-rail-item-foot">
                      <span className="v3-rail-item-age"><RelativeTime date={entry.createdAt} /></span>
                      <button type="button" className="v3-button ghost v3-button-inline-xs" disabled={closingId === entry.id} onClick={(event) => { event.stopPropagation(); void closeRaid(entry.id); }}>{closingId === entry.id ? "Resolving…" : "Resolve"}</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="v3-rail-empty">No open risks logged for this phase.</div>
            )
          ) : null}
        </AdamCardBody>
      </AdamCard>
      ) : null}

      {/* INTELLIGENCE */}
      {primaryTab === "intelligence" ? (
      <AdamCard>
        <AdamCardBody>
          <div className="v3-action-tabs v3-action-tabs--rail" role="tablist" aria-label="Phase intelligence">
            {intelTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={intelTab === tab.id}
                className={`v3-action-tab ${intelTab === tab.id ? "is-active" : ""}`}
                onClick={() => setIntelTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {intelTab === "artifacts" ? (
            <div className="v3-rail-list">
              {artifacts.required > 0 ? (
                <div className="v3-rail-meta">{artifacts.present}/{artifacts.required} produced</div>
              ) : null}
              {artifacts.defs.map((def) => {
                const node = artifacts.byKey.get(def.id);
                const present = !!node?.present;
                const score = typeof node?.quality === "number" ? node.quality : null;
                const state = node?.state ?? "missing";
                const statusLabel = !present ? "Missing" : state === "approved" ? "Approved" : state === "ready" ? "Ready" : "Draft";
                const tone = !present ? "muted" : state === "approved" ? "green" : state === "ready" ? "blue" : "amber";
                const hasContent = present && artifactContentById.has(def.id);
                return (
                  <div
                    key={def.id}
                    className={`v3-rail-item v3-rail-item--row${hasContent ? " is-clickable" : ""}`}
                    role={hasContent ? "button" : undefined}
                    tabIndex={hasContent ? 0 : undefined}
                    aria-label={hasContent ? `Open ${def.label}` : undefined}
                    onClick={hasContent ? () => openArtifactModal(def.label, def.id, statusLabel, tone, score) : undefined}
                    onKeyDown={hasContent ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openArtifactModal(def.label, def.id, statusLabel, tone, score); } } : undefined}
                  >
                    <div className="v3-rail-item-head">
                      <span className="v3-rail-item-title">{def.label}</span>
                      <span className={`v3-chip v3-chip-tight ${tone}`}>{statusLabel}{score != null ? ` · ${score}%` : ""}</span>
                    </div>
                    <button type="button" className="v3-button ghost v3-button-inline-xs" disabled={!agentsAvailable} onClick={(event) => { event.stopPropagation(); onRunAgent(def.id); }} title={present ? `Regenerate ${def.label}` : `Generate ${def.label}`}>
                      {present ? "↻ Regenerate" : "Generate"}
                    </button>
                  </div>
                );
              })}
              <button type="button" className="v3-button ghost v3-button-inline-xs v3-rail-footer-link" onClick={() => onOpenMoreView("artifact-map")}>Open full artifact map →</button>
            </div>
          ) : null}

          {intelTab === "graph" ? (
            <div className="v3-rail-list">
              <ArtifactMapTree program={program} phaseId={phaseId} />
              <button type="button" className="v3-button ghost v3-button-inline-xs v3-rail-footer-link" onClick={() => onOpenMoreView("artifact-map")}>Open full artifact map →</button>
            </div>
          ) : null}

          {intelTab === "uploads" ? (
            <div className="v3-rail-list">
              {uploads.length ? (
                <>
                  <div className="v3-rail-meta">{uploads.length} imported {uploads.length === 1 ? "document" : "documents"}</div>
                  {uploads.map((item) => (
                    <div key={item.fieldId} className="v3-rail-item">
                      <div className="v3-rail-item-head">
                        <span className="v3-rail-item-title">{item.label}</span>
                        <button
                          type="button"
                          className="v3-button ghost v3-button-inline-xs"
                          title={`Download ${item.label}`}
                          onClick={() => triggerDownload(`${slugify(item.label)}.txt`, item.source ? `${item.label}\n\nSource: ${item.source}\n\n${item.value}` : `${item.label}\n\n${item.value}`)}
                        >
                          ↓ Download
                        </button>
                      </div>
                      {item.source ? <div className="v3-rail-item-sub">Source: {item.source}</div> : null}
                    </div>
                  ))}
                </>
              ) : (
                <div className="v3-rail-empty">Import source documents to ground ATOS's analysis. Files are parsed into phase inputs automatically.</div>
              )}
              <button type="button" className="v3-button primary v3-button-inline-xs v3-rail-footer-link" onClick={onUploadDocument}>Upload document →</button>
              <button type="button" className="v3-button ghost v3-button-inline-xs v3-rail-footer-link" onClick={() => onOpenMoreView("documents")}>Manage documents →</button>
            </div>
          ) : null}
        </AdamCardBody>
      </AdamCard>
      ) : null}

      {openArtifact ? (
        <RailModal title={openArtifact.label} onClose={() => setOpenArtifact(null)}>
          <div className="v3-rail-modal-meta">
            <span className={`v3-chip v3-chip-tight ${openArtifact.tone}`}>{openArtifact.statusLabel}{openArtifact.score != null ? ` · ${openArtifact.score}%` : ""}</span>
            <button
              type="button"
              className="v3-button ghost v3-button-inline-xs"
              onClick={() => triggerDownload(`${slugify(openArtifact.label)}.txt`, `${openArtifact.label}\n\n${openArtifact.content}`)}
            >
              ↓ Download
            </button>
          </div>
          <div className="v3-rail-modal-content">{openArtifact.content || "No content captured for this artifact yet."}</div>
        </RailModal>
      ) : null}
    </div>
  );
}

export default PhaseRailPanels;
