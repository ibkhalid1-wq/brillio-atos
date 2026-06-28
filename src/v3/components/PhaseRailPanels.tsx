import React, { useMemo, useState } from "react";
import type { DecisionSummary, ProgramSummary, RAIDEntry, RAIDEntryType } from "@/new/types";
import { selectBlockers, selectRisks } from "@/v3/lib/programRaid";
import { getPhaseArtifactDefs } from "@/v3/lib/phaseArtifacts";
import { getPhaseInputSchema } from "@/v3/lib/phaseInputSchema";
import { PROVENANCE_KEY, parseProvenance, provenanceMatches } from "@/new/lib/fieldProvenance";
import { AdamCard, AdamCardBody } from "@/v3/components/ui/AdamCard";
import { ArtifactMapTree } from "@/v3/components/ArtifactMapTree";
import { DrillDownLinks } from "@/v3/components/DrillDownLinks";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";
import { StatusBadge } from "@/v3/components/ui/StatusBadge";
import { pushV3Toast } from "@/v3/utils";
import { artifactLabelFor, inputLabelFor } from "@/v3/components/DrillDownLinks";
import type { V3MoreView } from "@/v3/types";

/**
 * PhaseRailPanels — the canonical Programme right-rail surface. Two tabbed
 * sections, each self-contained:
 *
 *   • Actions      → Actions (open decisions) · Risks · Blockers, read-only
 *                    lists that deep-link to the decision queue / RAID log.
 *   • Intelligence → Graph · Uploads. The graph maps phase artifacts and their
 *                    lineage; uploads list imported source content for download.
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
  /** Retained for call-site compatibility; the rail no longer generates artifacts inline. */
  agentsAvailable?: boolean;
  /** Retained for call-site compatibility; the rail no longer raises items inline. */
  onAddDecision?: (decision: Omit<DecisionSummary, "id" | "status" | "createdAt">) => Promise<void>;
  /** Retained for call-site compatibility; the rail no longer raises items inline. */
  onAddRaid?: (draft: RaidDraft) => Promise<void>;
  onCloseRaid: (entryId: string, note?: string) => Promise<void>;
  onOpenDecide: () => void;
  /** Retained for call-site compatibility; the rail no longer generates artifacts inline. */
  onRunAgent?: (agentId: string) => void;
  onOpenMoreView: (view: V3MoreView) => void;
  onUploadDocument: () => void;
  /**
   * Resolve an action / blocker / risk by jumping to its source. With no anchor
   * it lands on the phase's input section; with a drill-down anchor
   * (`artifact:<id>` / `input:<id>`) it scrolls to that exact element and
   * highlights it. Optional so older call sites keep compiling.
   */
  onNavigateToPhaseInputs?: (phaseId: string, anchor?: string) => void;
};

type PrimaryTab = "actions" | "intelligence";
type ActionTab = "actions" | "blockers" | "risks";
type IntelTab = "graph" | "uploads";

type UploadItem = { fieldId: string; label: string; source: string; value: string };

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

export function PhaseRailPanels({
  program,
  phaseId,
  decisions,
  onCloseRaid,
  onOpenDecide,
  onOpenMoreView,
  onUploadDocument,
  onNavigateToPhaseInputs,
}: PhaseRailPanelsProps) {
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>("actions");
  const [actionTab, setActionTab] = useState<ActionTab>("actions");
  const [intelTab, setIntelTab] = useState<IntelTab>("graph");
  const [closingId, setClosingId] = useState<string | null>(null);

  const blockers = useMemo(() => selectBlockers(program, { phaseId }), [program, phaseId]);
  const risks = useMemo(() => selectRisks(program, { phaseId }), [program, phaseId]);

  // Drill an item down to its source input/artifact. Items resolve at the phase
  // they belong to (falling back to the focused phase), so the user always lands
  // somewhere editable. No-ops when no navigator is wired in.
  const drillTo = (itemPhase: string | null | undefined, anchor: string) => {
    if (!onNavigateToPhaseInputs) return;
    const target = itemPhase && itemPhase !== "all" ? itemPhase : phaseId;
    onNavigateToPhaseInputs(target, anchor);
  };

  // The single best source anchor for an item: prefer its first related input
  // (the field a PM would actually edit), then fall back to its artifact. Returns
  // both the anchor and a human label so the toast can name the destination.
  const primaryAnchorFor = (
    itemPhase: string | null | undefined,
    relatedArtifactId?: string | null,
    relatedInputIds?: string[],
  ): { anchor: string; label: string } | null => {
    const resolvedPhase = itemPhase && itemPhase !== "all" ? itemPhase : phaseId;
    const firstInput = (relatedInputIds ?? [])[0];
    if (firstInput) return { anchor: `input:${firstInput}`, label: inputLabelFor(resolvedPhase, firstInput) };
    if (relatedArtifactId) return { anchor: `artifact:${relatedArtifactId}`, label: artifactLabelFor(relatedArtifactId) };
    return null;
  };

  // Click handler for an Action Center item. When the item carries a source
  // anchor, jump to that field (it flashes via the navigator) and raise a context
  // toast with a button back to the full surface; otherwise open the surface
  // directly so the item is never a dead click.
  const resolveItem = (args: {
    itemPhase: string | null | undefined;
    title: string;
    relatedArtifactId?: string | null;
    relatedInputIds?: string[];
    kindLabel: string;
    openLabel: string;
    openSurface: () => void;
  }) => {
    // Without a navigator wired in there's nothing to drill to — open the surface.
    if (!onNavigateToPhaseInputs) {
      args.openSurface();
      return;
    }
    // Every rail click lands on the programme phase the item belongs to. When the
    // item carries a source anchor we flash the exact field/artifact; otherwise we
    // still navigate to that phase's inputs section so the click is never a dead
    // end and never bounces the user to a different surface unexpectedly. The full
    // surface (Action Center / RAID log) stays one tap away via the toast action.
    const target = primaryAnchorFor(args.itemPhase, args.relatedArtifactId, args.relatedInputIds);
    const resolvedPhase = args.itemPhase && args.itemPhase !== "all" ? args.itemPhase : phaseId;
    if (target) {
      drillTo(args.itemPhase, target.anchor);
    } else {
      onNavigateToPhaseInputs(resolvedPhase);
    }
    pushV3Toast(`${args.kindLabel}: ${args.title} → ${target ? target.label : "Phase inputs"}`, {
      tone: "info",
      icon: "↳",
      duration: 6000,
      action: { label: args.openLabel, onClick: args.openSurface },
    });
  };

  // Required-artifact count for this phase, surfaced on the Intelligence tab badge.
  const artifactCount = useMemo(() => getPhaseArtifactDefs(phaseId).length, [phaseId]);

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
    { id: "intelligence", label: "Intelligence", count: artifactCount },
  ];

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
                    onClick={() => resolveItem({ itemPhase: decision.phaseId, title: decision.question || decision.title || "Open decision", relatedArtifactId: decision.relatedArtifactId, relatedInputIds: decision.relatedInputIds, kindLabel: "Action", openLabel: "Open Action Center", openSurface: onOpenDecide })}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); resolveItem({ itemPhase: decision.phaseId, title: decision.question || decision.title || "Open decision", relatedArtifactId: decision.relatedArtifactId, relatedInputIds: decision.relatedInputIds, kindLabel: "Action", openLabel: "Open Action Center", openSurface: onOpenDecide }); } }}
                  >
                    <div className="v3-rail-item-head">
                      <StatusBadge variant={priorityVariant(decision.priority)} size="sm" />
                      <span className="v3-rail-item-title">{decision.question || decision.title || "Open decision"}</span>
                    </div>
                    {decision.recommendation ? <div className="v3-rail-item-sub">{decision.recommendation}</div> : null}
                    <DrillDownLinks
                      phaseId={decision.phaseId && decision.phaseId !== "all" ? decision.phaseId : phaseId}
                      relatedArtifactId={decision.relatedArtifactId}
                      relatedInputIds={decision.relatedInputIds}
                      onDrill={(anchor) => drillTo(decision.phaseId, anchor)}
                    />
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
                    aria-label={`Open blocker in the risk & blocker log: ${entry.title}`}
                    onClick={() => resolveItem({ itemPhase: entry.phase, title: entry.title, relatedArtifactId: entry.relatedArtifactId, relatedInputIds: entry.relatedInputIds, kindLabel: "Blocker", openLabel: "Open risk & blocker log", openSurface: () => onOpenMoreView("risks") })}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); resolveItem({ itemPhase: entry.phase, title: entry.title, relatedArtifactId: entry.relatedArtifactId, relatedInputIds: entry.relatedInputIds, kindLabel: "Blocker", openLabel: "Open risk & blocker log", openSurface: () => onOpenMoreView("risks") }); } }}
                  >
                    <div className="v3-rail-item-head">
                      <span className={`v3-chip v3-chip-tight ${severityTone(entry.severity)}`}>{entry.severity}</span>
                      <span className="v3-rail-item-title">{entry.title}</span>
                    </div>
                    {entry.description ? <div className="v3-rail-item-sub">{entry.description}</div> : null}
                    <DrillDownLinks
                      phaseId={entry.phase && entry.phase !== "all" ? entry.phase : phaseId}
                      relatedArtifactId={entry.relatedArtifactId}
                      relatedInputIds={entry.relatedInputIds}
                      onDrill={(anchor) => drillTo(entry.phase, anchor)}
                    />
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
                    aria-label={`Open risk in the risk & blocker log: ${entry.title}`}
                    onClick={() => resolveItem({ itemPhase: entry.phase, title: entry.title, relatedArtifactId: entry.relatedArtifactId, relatedInputIds: entry.relatedInputIds, kindLabel: "Risk", openLabel: "Open risk & blocker log", openSurface: () => onOpenMoreView("risks") })}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); resolveItem({ itemPhase: entry.phase, title: entry.title, relatedArtifactId: entry.relatedArtifactId, relatedInputIds: entry.relatedInputIds, kindLabel: "Risk", openLabel: "Open risk & blocker log", openSurface: () => onOpenMoreView("risks") }); } }}
                  >
                    <div className="v3-rail-item-head">
                      <span className={`v3-chip v3-chip-tight ${severityTone(entry.severity)}`}>{entry.severity}</span>
                      <span className="v3-rail-item-title">{entry.title}</span>
                    </div>
                    {entry.description ? <div className="v3-rail-item-sub">{entry.description}</div> : null}
                    {entry.mitigation ? <div className="v3-rail-item-sub">Mitigation: {entry.mitigation}</div> : null}
                    <DrillDownLinks
                      phaseId={entry.phase && entry.phase !== "all" ? entry.phase : phaseId}
                      relatedArtifactId={entry.relatedArtifactId}
                      relatedInputIds={entry.relatedInputIds}
                      onDrill={(anchor) => drillTo(entry.phase, anchor)}
                    />
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

          {intelTab === "graph" ? (
            <div className="v3-rail-list">
              <button type="button" className="v3-button ghost v3-button-inline-xs v3-rail-footer-link" onClick={() => onOpenMoreView("artifact-map")}>Open full artifact map →</button>
              <ArtifactMapTree program={program} phaseId={phaseId} />
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
    </div>
  );
}

export default PhaseRailPanels;
