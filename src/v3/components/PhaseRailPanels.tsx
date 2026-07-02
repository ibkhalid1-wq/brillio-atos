import React, { useEffect, useMemo, useState } from "react";
import type { DecisionSummary, ProgramSummary, RAIDEntry, RAIDEntryType } from "@/new/types";
import { selectBlockers, selectRisks } from "@/v3/lib/programRaid";
import { getPhaseArtifactDefs } from "@/v3/lib/phaseArtifacts";
import { resolveArtifactReview } from "@/v3/lib/artifactReview";
import { selectModelValidationFindings } from "@/v3/lib/crossArtifactValidation";
import {
  reviewImprovementsToRecommendations,
  findingsToRecommendations,
  selfReportedGapRecommendations,
  groundingGapRecommendations,
  selectFindingsForArtifact,
  groupRecommendationsByCategory,
  matchGroundingFields,
  type ArtifactRecommendation,
  type RecommendationGroup,
} from "@/v3/lib/artifactRecommendations";
import { isFieldValueFilled } from "@/v3/components/StructuredGrid";
import { getDynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import { getGuidanceInputFields } from "@/v3/lib/phaseFlowEdges";
import { getPhaseInputSchema } from "@/v3/lib/phaseInputSchema";
import { AdamCard, AdamCardBody } from "@/v3/components/ui/AdamCard";
import { ArtifactMapTree } from "@/v3/components/ArtifactMapTree";
import { DrillDownLinks } from "@/v3/components/DrillDownLinks";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";
import { StatusBadge } from "@/v3/components/ui/StatusBadge";
import { pushV3Toast } from "@/v3/utils";
import { artifactLabelFor, inputLabelFor } from "@/v3/components/DrillDownLinks";
import type { V3MoreView } from "@/v3/types";

/**
 * PhaseRailPanels — the canonical Programme right-rail surface. Three tabbed
 * sections, each self-contained:
 *
 *   • Action Center → Actions (open decisions) · Risks · Blockers, read-only
 *                    lists that deep-link to the decision queue / RAID log.
 *   • Guidance      → Per-artifact AI-review improvement recommendations — the
 *                    signals behind the phase's input / artifact quality scores.
 *   • Intelligence → The artifact lineage graph for the phase.
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
  /**
   * Resolve an action / blocker / risk by jumping to its source. With no anchor
   * it lands on the phase's input section; with a drill-down anchor
   * (`artifact:<id>` / `input:<id>`) it scrolls to that exact element and
   * highlights it. Optional so older call sites keep compiling.
   */
  onNavigateToPhaseInputs?: (phaseId: string, anchor?: string) => void;
  /**
   * External signal to focus a primary rail tab. The nonce makes repeat requests
   * for the same tab re-fire (e.g. tapping the Input-quality tile twice), so the
   * rail always lands on Guidance even if the user already had it open.
   */
  railIntent?: { tab: PrimaryTab; nonce: number } | null;
};

export type PrimaryTab = "actions" | "guidance" | "intelligence";
type ActionTab = "actions" | "blockers" | "risks";

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

export function PhaseRailPanels({
  program,
  phaseId,
  decisions,
  onCloseRaid,
  onOpenDecide,
  onOpenMoreView,
  onNavigateToPhaseInputs,
  railIntent,
}: PhaseRailPanelsProps) {
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>("actions");
  const [actionTab, setActionTab] = useState<ActionTab>("actions");
  const [closingId, setClosingId] = useState<string | null>(null);

  // Honour external tab requests (e.g. the StageView quality tiles opening
  // Guidance). Keyed on the nonce so the same tab can be re-requested.
  useEffect(() => {
    if (railIntent) setPrimaryTab(railIntent.tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railIntent?.nonce]);

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

  // Guidance: the per-artifact improvement recommendations from each AI review.
  // These are the exact signals behind the phase's input- and artifact-quality
  // scores, so this tab is the "why is quality X% and what do I fix" surface the
  // quality tiles deep-link into. Only artifacts that carry recommendations show.
  const guidanceItems = useMemo(() => {
    const bucket = getDataBucket(program);
    const store = getDynamicSchemaStore(program.rawData);
    // Semantic layer: the cross-artifact validator's persisted findings, folded
    // into each artifact's guidance so the categories reflect real disciplines —
    // reviewer prose is Completeness, but an un-traced requirement is Ontology.
    const findings = selectModelValidationFindings(program);
    const schema = getPhaseInputSchema(phaseId, store);
    // The persisted values for this phase's inputs, so we can tell which grounding
    // inputs are still empty — those become deterministic "Add X" gaps below.
    const phaseInputsRaw = bucket && typeof bucket.phaseInputs === "object" && bucket.phaseInputs
      ? (bucket.phaseInputs as Record<string, unknown>)[phaseId]
      : null;
    const phaseInputs = phaseInputsRaw && typeof phaseInputsRaw === "object"
      ? (phaseInputsRaw as Record<string, unknown>)
      : {};
    return getPhaseArtifactDefs(phaseId, store)
      .map((def) => {
        const review = resolveArtifactReview(bucket, def.id, phaseId);
        const artifactFindings = selectFindingsForArtifact(findings, def.id, phaseId)
          .filter((f) => f.domain !== "artifact-completeness");
        // The grounding inputs this artifact is generated from, with what each must
        // hold and whether it is filled — the same set the Improve modal prescribes.
        const groundingFields = getGuidanceInputFields(phaseId, def.id, store).map((fieldId) => {
          const fieldDef = schema.fields.find((field) => field.id === fieldId);
          const requirement = [fieldDef?.placeholder, fieldDef?.hint]
            .filter((part): part is string => !!part && part.trim().length > 0)
            .join(" — ") || `Provide ${fieldDef?.label ?? fieldId}.`;
          return {
            id: fieldId,
            label: fieldDef?.label ?? fieldId,
            type: fieldDef?.type,
            requirement,
            filled: isFieldValueFilled(fieldDef, phaseInputs[fieldId]),
          };
        });
        const recommendations: (ArtifactRecommendation & { fieldId?: string })[] = [
          // Empty grounding inputs are the highest-leverage, most concrete fixes, so
          // they lead — and each carries a fieldId so it renders a jump-to-field chip,
          // matching the Improve modal. Skip artifact-reference inputs: the generating
          // agent receives the upstream deliverable via cross-phase context, so a blank
          // selector is not a real gap the user must fill.
          ...groundingGapRecommendations(
            groundingFields.filter((field) => field.type !== "artifact-reference"),
          ),
          ...reviewImprovementsToRecommendations(review?.improvements ?? []),
          ...findingsToRecommendations(artifactFindings),
          ...selfReportedGapRecommendations(bucket, def.id),
        ];
        if (recommendations.length === 0) return null;
        // id + label only, for the prose chip-matching path (recs with no fieldId).
        const fields = groundingFields.map(({ id, label }) => ({ id, label }));
        // The full grounding-input set (bar artifact-reference selectors), carried
        // so the render can show a fallback index when no line names a field — an
        // artifact's inputs must never be fully hidden behind unmatched prose.
        const inputs = groundingFields
          .filter((field) => field.type !== "artifact-reference")
          .map(({ id, label, filled }) => ({ id, label, filled }));
        return {
          id: def.id,
          label: def.label,
          score: review?.score ?? null,
          fields,
          inputs,
          groups: groupRecommendationsByCategory(recommendations),
        };
      })
      .filter(
        (item): item is { id: string; label: string; score: number | null; fields: Array<{ id: string; label: string }>; inputs: Array<{ id: string; label: string; filled: boolean }>; groups: RecommendationGroup<ArtifactRecommendation & { fieldId?: string }>[] } =>
          item !== null,
      );
  }, [program, phaseId]);
  const guidanceCount = useMemo(
    () => guidanceItems.reduce(
      (sum, item) => sum + item.groups.reduce((n, g) => n + g.items.length, 0),
      0,
    ),
    [guidanceItems],
  );

  const actionTabs: { id: ActionTab; label: string; count: number }[] = [
    { id: "actions", label: "Actions", count: decisions.length },
    { id: "risks", label: "Risks", count: risks.length },
    { id: "blockers", label: "Blockers", count: blockers.length },
  ];
  const openActionCount = decisions.length + blockers.length + risks.length;

  const closeRaid = async (entryId: string) => {
    setClosingId(entryId);
    try {
      await onCloseRaid(entryId);
    } finally {
      setClosingId(null);
    }
  };

  const primaryTabs: { id: PrimaryTab; label: string; count: number }[] = [
    { id: "actions", label: "Action", count: openActionCount },
    { id: "guidance", label: "Guidance", count: guidanceCount },
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

      {/* GUIDANCE */}
      {primaryTab === "guidance" ? (
      <AdamCard>
        <AdamCardBody>
          {guidanceItems.length ? (
            <div className="v3-rail-list">
              <div className="v3-rail-meta">
                Improvement Recommendations
              </div>
              {guidanceItems.map((item) => {
                // Whether any recommendation across all groups resolves to at least
                // one grounding-input chip. If nothing does, the prose named no
                // field the matcher could find — so we fall back to an index of the
                // artifact's inputs, keeping them one click away rather than hidden.
                const anyChip = onNavigateToPhaseInputs && item.groups.some((group) =>
                  group.items.some((rec) =>
                    (rec.fieldId
                      ? item.fields.filter((field) => field.id === rec.fieldId)
                      : matchGroundingFields(`${rec.title} ${rec.detail ?? ""}`, item.fields)
                    ).length > 0,
                  ),
                );
                const showInputIndex = onNavigateToPhaseInputs && !anyChip && item.inputs.length > 0;
                return (
                <div key={item.id} className="v3-rail-item">
                  <div className="v3-rail-item-head">
                    <span className="v3-rail-item-title">{item.label}</span>
                    {item.score != null ? (
                      <span className={`v3-chip v3-chip-tight ${item.score >= 75 ? "green" : item.score >= 50 ? "amber" : "red"}`}>{item.score}%</span>
                    ) : null}
                  </div>
                  {item.groups.map((group) => (
                    <div key={group.category} className="v3-rail-guidance-group">
                      <div className="v3-rail-guidance-category" title={group.description}>{group.category}</div>
                      <ul className="v3-rail-guidance-list">
                        {group.items.map((rec, idx) => {
                          // The grounding field(s) this line points at. A
                          // deterministic gap carries an explicit fieldId (resolve it
                          // directly); a prose recommendation names the field in text
                          // (match it) — either way the user jumps straight to the
                          // input to update, the same signal as the Improve modal.
                          const recFields = rec.fieldId
                            ? item.fields.filter((field) => field.id === rec.fieldId)
                            : matchGroundingFields(`${rec.title} ${rec.detail ?? ""}`, item.fields);
                          return (
                          <li key={idx} className="v3-rail-item-sub">
                            {rec.title}{rec.detail ? ` — ${rec.detail}` : ""}
                            {onNavigateToPhaseInputs && recFields.length ? (
                              <div className="v3-drilldown-row">
                                {recFields.map((field) => (
                                  <button
                                    key={field.id}
                                    type="button"
                                    className="v3-drilldown-chip"
                                    data-kind="input"
                                    onClick={() => drillTo(phaseId, `input:${field.id}`)}
                                    title={`Go to "${field.label}" to update it`}
                                  >
                                    <span aria-hidden="true">▸ </span>
                                    {field.label}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                  {showInputIndex ? (
                    <div className="v3-rail-guidance-group">
                      <div className="v3-rail-guidance-category" title="Grounding inputs this artifact is generated from — open any to strengthen it.">Grounding inputs</div>
                      <div className="v3-drilldown-row">
                        {item.inputs.map((field) => (
                          <button
                            key={field.id}
                            type="button"
                            className={`v3-drilldown-chip${field.filled ? "" : " thin"}`}
                            data-kind="input"
                            onClick={() => drillTo(phaseId, `input:${field.id}`)}
                            title={`Go to "${field.label}" to update it`}
                          >
                            <span aria-hidden="true">▸ </span>
                            {field.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                );
              })}
            </div>
          ) : (
            <div className="v3-rail-empty">No artifact reviews yet. Generate and review this phase's artifacts to see improvement guidance.</div>
          )}
        </AdamCardBody>
      </AdamCard>
      ) : null}

      {/* INTELLIGENCE — the artifact lineage graph for this phase. */}
      {primaryTab === "intelligence" ? (
      <AdamCard>
        <AdamCardBody>
          <div className="v3-rail-list">
            <button type="button" className="v3-button ghost v3-button-inline-xs v3-rail-footer-link" onClick={() => onOpenMoreView("artifact-map")}>Open full artifact map →</button>
            <ArtifactMapTree program={program} phaseId={phaseId} />
          </div>
        </AdamCardBody>
      </AdamCard>
      ) : null}
    </div>
  );
}

export default PhaseRailPanels;
