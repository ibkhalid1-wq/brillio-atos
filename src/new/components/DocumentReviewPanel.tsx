/**
 * DocumentReviewPanel — Review & approval UI for extracted document intelligence.
 *
 * Shows:
 * - Document summary + type badge
 * - Extracted entities (objectives, risks, stakeholders, milestones, etc.)
 * - Per-field methodology mappings with confidence, source, extraction type
 * - Conflict indicators when existing data would be overwritten
 * - In-place editing, approve/reject per field
 * - Accept All / Save Selected / Cancel actions
 */

import React, { useEffect, useRef, useState } from "react";
import type { DocumentIntelligence, ReviewField } from "@/new/lib/documentIntelligenceTypes";
import {
  confidenceLabel,
  DOCUMENT_TYPE_LABELS,
  EXTRACTION_TYPE_COLORS,
  EXTRACTION_TYPE_LABELS,
} from "@/new/lib/documentIntelligenceTypes";
import { PHASE_INPUT_SCHEMAS } from "@/v3/lib/phaseInputSchema";

// ─── KPI value formatting ─────────────────────────────────────────────────────

/**
 * Render a serialized KPI grid (`[{name,baseline,target,unit}]`) as readable
 * lines so the review panel shows "Name: baseline → target (unit)" instead of
 * raw JSON. Returns null when the value is not a KPI array.
 */
function formatKpiDisplay(raw: string): string | null {
  if (!raw.trim().startsWith("[")) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const lines = parsed
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => {
        const name = String(entry.name ?? "").trim();
        if (!name) return "";
        const baseline = String(entry.baseline ?? "").trim();
        const target = String(entry.target ?? "").trim();
        const unit = String(entry.unit ?? "").trim();
        const movement = [baseline || "—", target || "—"].join(" → ");
        return `${name}: ${movement}${unit ? ` (${unit})` : ""}`;
      })
      .filter(Boolean);
    return lines.length > 0 ? lines.join("\n") : null;
  } catch {
    return null;
  }
}

// ─── Confidence bar ───────────────────────────────────────────────────────────

function ConfidenceBar({ score }: { score: number }) {
  const { label, color } = confidenceLabel(score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 90 }}>
      <div
        style={{
          flex: 1,
          height: 4,
          background: "var(--v3-surface-3, rgba(255,255,255,0.06))",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.round(score * 100)}%`,
            background: color,
            borderRadius: 2,
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <span style={{ fontSize: 10, color, fontWeight: 600, whiteSpace: "nowrap" }}>
        {label} {Math.round(score * 100)}%
      </span>
    </div>
  );
}

// ─── Extraction type badge ────────────────────────────────────────────────────

function ExtractionBadge({ type }: { type: string }) {
  const color = EXTRACTION_TYPE_COLORS[type as keyof typeof EXTRACTION_TYPE_COLORS] ?? "#6b7280";
  const label = EXTRACTION_TYPE_LABELS[type as keyof typeof EXTRACTION_TYPE_LABELS] ?? type;
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color,
        background: `${color}1a`,
        border: `1px solid ${color}33`,
        borderRadius: 4,
        padding: "2px 5px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// ─── Value pane (one side of the current-vs-imported comparison) ──────────────

function ValuePane({
  heading,
  value,
  tone,
}: {
  heading: string;
  value: string;
  tone: "current" | "incoming";
}) {
  const accent = tone === "current" ? "var(--v3-text-muted)" : "var(--v3-accent)";
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: "var(--v3-surface-3, rgba(255,255,255,0.03))",
        border: "1px solid var(--v3-border, rgba(255,255,255,0.08))",
        borderRadius: 6,
        padding: "7px 9px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: accent }}>
        {heading}
      </span>
      <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {(formatKpiDisplay(value) ?? value) || <em style={{ opacity: 0.5 }}>(empty)</em>}
      </div>
    </div>
  );
}

// ─── Resolution action button (Replace / Merge / Dismiss / Import) ────────────

function ResolutionButton({
  label,
  hint,
  color,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      style={{
        background: active ? `${color}26` : "transparent",
        border: `1px solid ${active ? color : "var(--v3-border, rgba(255,255,255,0.12))"}`,
        borderRadius: 5,
        color: active ? color : "var(--v3-text-secondary)",
        fontSize: 11,
        fontWeight: active ? 700 : 600,
        padding: "3px 10px",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {active ? `✓ ${label}` : label}
    </button>
  );
}

// ─── Single review field row ──────────────────────────────────────────────────

function ReviewFieldRow({
  field,
  locked = false,
  onApprove,
  onReject,
  onEdit,
}: {
  field: ReviewField;
  /** Phase gate is approved → field is frozen: imports only on explicit override. */
  locked?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onEdit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(
    field.mapping.editedValue ?? field.mapping.value,
  );
  const state = field.mapping.reviewState ?? "pending";
  const incomingValue = field.mapping.value;
  const existingValue = field.existingValue ?? "";
  // A populated field: the programme already holds a value the import would touch,
  // so the user gets an explicit Replace / Merge / Dismiss choice side by side.
  const hasExisting = field.hasConflict && !!existingValue.trim();

  // Replace is modelled as an "edited" state whose value equals the import verbatim
  // (overwrite); a hand-edit is an "edited" state whose value diverges from it.
  const isReplace = state === "edited" && (field.mapping.editedValue ?? "").trim() === incomingValue.trim();
  const isMerge = state === "approved";
  const isDismiss = state === "rejected";
  const resolutionLabel = isDismiss
    ? "Dismissed"
    : state === "edited"
      ? (isReplace ? "Replaced" : "Edited")
      : isMerge
        ? (hasExisting ? "Merged" : "Imported")
        : null;

  const decidedValue = state === "edited" ? (field.mapping.editedValue ?? incomingValue) : incomingValue;

  const borderColor = isDismiss
    ? "rgba(239,68,68,0.25)"
    : resolutionLabel
      ? "rgba(34,197,94,0.28)"
      : locked
        ? "rgba(148,163,184,0.3)"
        : hasExisting
          ? "rgba(245,158,11,0.32)"
          : "var(--v3-border, rgba(255,255,255,0.08))";
  const bg = isDismiss
    ? "rgba(239,68,68,0.04)"
    : resolutionLabel
      ? "rgba(34,197,94,0.04)"
      : "var(--v3-surface-2, rgba(255,255,255,0.03))";

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        opacity: isDismiss ? 0.6 : 1,
        transition: "all 0.15s",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--v3-text-secondary)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            flex: 1,
          }}
        >
          {field.fieldLabel}
        </span>
        {locked && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: "var(--v3-text-muted)",
              background: "var(--v3-surface-2, rgba(255,255,255,0.04))",
              border: "1px solid var(--v3-border)",
              borderRadius: 4,
              padding: "1px 6px",
            }}
            title="This phase's gate is approved (completed) — its inputs are frozen. Replace or Merge raises a change request instead of writing directly."
          >
            🔒 Gate approved
          </span>
        )}
        <ExtractionBadge type={field.mapping.extractionType} />
        <ConfidenceBar score={field.mapping.confidence} />
        {resolutionLabel && (
          <span style={{ color: isDismiss ? "#ef4444" : "#22c55e", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
            {isDismiss ? "✕" : "✓"} {resolutionLabel}
          </span>
        )}
      </div>

      {/* Frozen-by-default note for an untouched locked field. */}
      {locked && !resolutionLabel && !isDismiss && (
        <div
          style={{
            fontSize: 10,
            color: "var(--v3-text-muted)",
            background: "var(--v3-surface-2, rgba(255,255,255,0.04))",
            borderRadius: 4,
            padding: "3px 7px",
          }}
        >
          Completed phase — Replace or Merge raises a change request to apply; it won't write directly.
        </div>
      )}

      {/* Value comparison / edit */}
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            rows={Math.min(6, (editValue.match(/\n/g)?.length ?? 0) + 2)}
            style={{
              width: "100%",
              background: "var(--v3-surface-3)",
              border: "1px solid var(--v3-accent)",
              borderRadius: 5,
              color: "var(--v3-text-primary)",
              fontSize: 12,
              padding: "6px 8px",
              resize: "vertical",
              fontFamily: "inherit",
              lineHeight: 1.5,
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="v3-button primary"
              style={{ fontSize: 11, padding: "4px 12px" }}
              onClick={() => {
                onEdit(editValue);
                setEditing(false);
              }}
            >
              Save edit
            </button>
            <button
              type="button"
              className="v3-button ghost"
              style={{ fontSize: 11, padding: "4px 12px" }}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : hasExisting ? (
        // Side-by-side: the value already in the programme vs. what the import brings.
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ValuePane heading="Current value" value={existingValue} tone="current" />
          <ValuePane heading="Imported value" value={incomingValue} tone="incoming" />
        </div>
      ) : (
        <div
          style={{
            fontSize: 12,
            color: "var(--v3-text-secondary)",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {formatKpiDisplay(decidedValue) ?? decidedValue}
        </div>
      )}

      {/* Resolution actions — Replace / Merge / Dismiss for a populated field,
          Import / Dismiss for a fresh one. Always available so a decision can be
          changed; the active choice is highlighted. */}
      {!editing && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {hasExisting ? (
            <>
              <ResolutionButton
                label="Replace"
                hint="Overwrite the existing value with the imported one"
                color="#22c55e"
                active={isReplace}
                onClick={() => onEdit(incomingValue)}
              />
              <ResolutionButton
                label="Merge"
                hint="Blend the existing value with the imported one (keeps both)"
                color="#6366f1"
                active={isMerge}
                onClick={onApprove}
              />
            </>
          ) : (
            <ResolutionButton
              label="Import"
              hint="Add this value to the programme"
              color="#22c55e"
              active={isMerge}
              onClick={onApprove}
            />
          )}
          <ResolutionButton
            label="Dismiss"
            hint="Discard the imported value — keep the programme as is"
            color="#ef4444"
            active={isDismiss}
            onClick={onReject}
          />
          <button
            type="button"
            onClick={() => {
              setEditValue(decidedValue);
              setEditing(true);
            }}
            title="Edit the value before importing"
            style={{
              background: "transparent",
              border: "1px solid var(--v3-border)",
              borderRadius: 5,
              color: "var(--v3-text-muted)",
              fontSize: 11,
              padding: "3px 9px",
              cursor: "pointer",
              marginLeft: "auto",
            }}
          >
            ✎ Edit
          </button>
        </div>
      )}

      {/* Source reference */}
      {field.mapping.source && (
        <div style={{ fontSize: 10, color: "var(--v3-text-muted)", fontStyle: "italic", marginTop: 2 }}>
          Source: "{field.mapping.source.slice(0, 100)}"
        </div>
      )}
    </div>
  );
}

// ─── Phase group ──────────────────────────────────────────────────────────────

function PhaseGroup({
  phaseId,
  fields,
  locked = false,
  onApprove,
  onReject,
  onEdit,
}: {
  phaseId: string;
  fields: ReviewField[];
  /** Phase gate is approved → all its fields are frozen and excluded from import. */
  locked?: boolean;
  onApprove: (fieldId: string) => void;
  onReject: (fieldId: string) => void;
  onEdit: (fieldId: string, value: string) => void;
}) {
  const schema = PHASE_INPUT_SCHEMAS[phaseId];
  const phaseLabel = schema?.title ?? `${phaseId.charAt(0).toUpperCase()}${phaseId.slice(1)} Phase`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: locked ? "var(--v3-text-muted)" : "var(--v3-accent)",
          padding: "6px 0 2px",
          borderBottom: "1px solid var(--v3-border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{phaseLabel}</span>
        {locked && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: "var(--v3-text-muted)",
              background: "var(--v3-surface-2, rgba(255,255,255,0.04))",
              border: "1px solid var(--v3-border)",
              borderRadius: 4,
              padding: "1px 6px",
              textTransform: "none",
            }}
          >
            🔒 Gate approved — overrides raise a change request
          </span>
        )}
      </div>
      {fields.map((field) => (
        <ReviewFieldRow
          key={`${field.phaseId}-${field.fieldId}`}
          field={field}
          locked={locked}
          onApprove={() => onApprove(field.fieldId)}
          onReject={() => onReject(field.fieldId)}
          onEdit={(value) => onEdit(field.fieldId, value)}
        />
      ))}
    </div>
  );
}

// ─── Entity summary card ──────────────────────────────────────────────────────

function EntitySummaryCard({
  label,
  count,
  icon,
}: {
  label: string;
  count: number;
  icon: string;
}) {
  if (count === 0) return null;
  return (
    <div
      style={{
        background: "var(--v3-surface-2)",
        border: "1px solid var(--v3-border)",
        borderRadius: 8,
        padding: "8px 12px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--v3-text-primary)", lineHeight: 1 }}>{count}</div>
        <div style={{ fontSize: 10, color: "var(--v3-text-muted)", marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface DocumentReviewPanelProps {
  intelligence: DocumentIntelligence;
  reviewFields: ReviewField[];
  /** Gate-approved phases — their fields render frozen and are excluded from import. */
  lockedPhaseIds?: Set<string>;
  saving: boolean;
  onUpdateField: (
    phaseId: string,
    fieldId: string,
    patch: { reviewState?: "approved" | "rejected" | "edited"; editedValue?: string },
  ) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function DocumentReviewPanel({
  intelligence,
  reviewFields,
  lockedPhaseIds,
  saving,
  onUpdateField,
  onSave,
  onCancel,
}: DocumentReviewPanelProps) {
  const docTypeLabel =
    DOCUMENT_TYPE_LABELS[intelligence.documentType as keyof typeof DOCUMENT_TYPE_LABELS] ??
    "Document";

  const isPhaseLocked = (phaseId: string) => !!lockedPhaseIds?.has(phaseId);

  // Group review fields by phase
  const byPhase = reviewFields.reduce<Record<string, ReviewField[]>>((acc, f) => {
    if (!acc[f.phaseId]) acc[f.phaseId] = [];
    acc[f.phaseId].push(f);
    return acc;
  }, {});

  // Fields in gate-locked phases are frozen by default: they play no part in the
  // auto-commit gate (so an untouched locked field never blocks or triggers a
  // save), but the user can now explicitly override each one (Replace/Merge) and
  // those overrides do persist. Counts and auto-commit scope to the non-locked
  // (active) set; locked overrides are tracked separately.
  const activeFields = reviewFields.filter((f) => !isPhaseLocked(f.phaseId));
  const lockedFields = reviewFields.filter((f) => isPhaseLocked(f.phaseId));
  const lockedFieldCount = lockedFields.length;
  const lockedPhaseCount = Object.keys(byPhase).filter((phaseId) => isPhaseLocked(phaseId)).length;
  const lockedOverrideCount = lockedFields.filter(
    (f) => f.mapping.reviewState === "approved" || f.mapping.reviewState === "edited",
  ).length;

  const approvedCount = activeFields.filter(
    (f) => f.mapping.reviewState === "approved" || f.mapping.reviewState === "edited",
  ).length;
  const rejectedCount = activeFields.filter((f) => f.mapping.reviewState === "rejected").length;
  const pendingCount = activeFields.filter(
    (f) => !f.mapping.reviewState || f.mapping.reviewState === "pending",
  ).length;
  const conflictCount = activeFields.filter((f) => f.hasConflict).length;

  // Auto-commit once every extracted field has been decided (approved/edited or
  // rejected) — no explicit Save/Cancel. Approved fields persist; if everything
  // was rejected there is nothing to import, so the review just dismisses. A
  // short debounce lets a burst of rapid per-field decisions settle, and the
  // ref guard ensures it fires exactly once.
  const firedRef = useRef(false);
  // Latch the latest callbacks so the debounce timer below doesn't reset every
  // render (the parent passes fresh inline closures for onSave/onCancel).
  const onSaveRef = useRef(onSave);
  const onCancelRef = useRef(onCancel);
  onSaveRef.current = onSave;
  onCancelRef.current = onCancel;
  const allDecided = activeFields.length > 0 && pendingCount === 0;
  useEffect(() => {
    if (!allDecided || saving || firedRef.current) return;
    const timer = window.setTimeout(() => {
      firedRef.current = true;
      // Persist if anything is importable — an active approval/edit or an
      // explicit locked-phase override; otherwise there is nothing to save.
      if (approvedCount > 0 || lockedOverrideCount > 0) onSaveRef.current();
      else onCancelRef.current();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [allDecided, approvedCount, lockedOverrideCount, saving]);

  const ent = intelligence.entities ?? {};
  const entityCounts = [
    { label: "Objectives", count: ent.objectives?.length ?? 0, icon: "🎯" },
    { label: "Risks", count: ent.risks?.length ?? 0, icon: "⚠️" },
    { label: "Stakeholders", count: ent.stakeholders?.length ?? 0, icon: "👥" },
    { label: "Milestones", count: ent.milestones?.length ?? 0, icon: "📅" },
    { label: "Requirements", count: ent.requirements?.length ?? 0, icon: "📋" },
    { label: "Actions", count: ent.actions?.length ?? 0, icon: "✅" },
    { label: "Decisions", count: ent.decisions?.length ?? 0, icon: "🔀" },
    { label: "Technologies", count: ent.technologies?.length ?? 0, icon: "⚙️" },
  ].filter((e) => e.count > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Document summary ── */}
      <div
        style={{
          background: "var(--v3-surface-2)",
          border: "1px solid var(--v3-border)",
          borderRadius: 10,
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: "var(--v3-accent)",
              background: "rgba(99,102,241,0.12)",
              border: "1px solid rgba(99,102,241,0.25)",
              borderRadius: 5,
              padding: "2px 7px",
            }}
          >
            {docTypeLabel}
          </span>
          <ConfidenceBar score={intelligence.overallConfidence ?? 0.75} />
        </div>

        <p
          style={{
            fontSize: 12,
            color: "var(--v3-text-secondary)",
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {intelligence.summary}
        </p>

        {/* Entity counts */}
        {entityCounts.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginTop: 4,
            }}
          >
            {entityCounts.map((e) => (
              <EntitySummaryCard key={e.label} {...e} />
            ))}
          </div>
        )}

        {/* Gaps notice */}
        {intelligence.gaps && (
          <div
            style={{
              fontSize: 11,
              color: "#f59e0b",
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.2)",
              borderRadius: 6,
              padding: "6px 10px",
            }}
          >
            <strong>Gaps identified:</strong> {intelligence.gaps}
          </div>
        )}
      </div>

      {/* ── Review fields header ── */}
      {reviewFields.length > 0 ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)" }}>
                {activeFields.length} field{activeFields.length !== 1 ? "s" : ""} to populate
              </span>
              {lockedFieldCount > 0 && (
                <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
                  🔒 {lockedFieldCount} frozen in {lockedPhaseCount} locked phase{lockedPhaseCount !== 1 ? "s" : ""}
                  {lockedOverrideCount > 0 ? ` · ${lockedOverrideCount} overridden` : ""}
                </span>
              )}
              {conflictCount > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    color: "#f59e0b",
                    background: "rgba(245,158,11,0.1)",
                    border: "1px solid rgba(245,158,11,0.25)",
                    borderRadius: 4,
                    padding: "2px 6px",
                    fontWeight: 600,
                  }}
                >
                  {conflictCount} conflict{conflictCount !== 1 ? "s" : ""}
                </span>
              )}
              {approvedCount > 0 && (
                <span style={{ fontSize: 11, color: "#22c55e" }}>✓ {approvedCount} approved</span>
              )}
              {rejectedCount > 0 && (
                <span style={{ fontSize: 11, color: "#ef4444" }}>✕ {rejectedCount} rejected</span>
              )}
            </div>

            {pendingCount > 0 && (
              // Every field is decided individually — there is deliberately no
              // batch Accept-all / Reject-all. Forcing a per-field Replace / Merge /
              // Dismiss keeps the PM accountable for each imported value rather than
              // rubber-stamping an extraction.
              <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }} aria-live="polite">
                {pendingCount} field{pendingCount !== 1 ? "s" : ""} awaiting your decision
              </span>
            )}
          </div>

          {/* ── Fields grouped by phase ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {Object.entries(byPhase).map(([phaseId, fields]) => (
              <PhaseGroup
                key={phaseId}
                phaseId={phaseId}
                fields={fields}
                locked={isPhaseLocked(phaseId)}
                onApprove={(fieldId) =>
                  onUpdateField(phaseId, fieldId, { reviewState: "approved" })
                }
                onReject={(fieldId) =>
                  onUpdateField(phaseId, fieldId, { reviewState: "rejected" })
                }
                onEdit={(fieldId, value) =>
                  onUpdateField(phaseId, fieldId, { reviewState: "edited", editedValue: value })
                }
              />
            ))}
          </div>
        </>
      ) : (
        <div
          style={{
            fontSize: 12,
            color: "var(--v3-text-muted)",
            textAlign: "center",
            padding: "16px 0",
          }}
        >
          No methodology fields could be mapped from this document.
          The document has been stored and you can reference it manually.
        </div>
      )}

      {/* ── Status bar ── approve/reject each field; approved fields auto-save
          once everything is decided. No explicit Save/Cancel. The only control
          is a Done affordance for the empty "nothing mapped" terminal state. */}
      <div
        style={{
          display: "flex",
          gap: 8,
          paddingTop: 8,
          borderTop: "1px solid var(--v3-border)",
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        {reviewFields.length === 0 ? (
          <button
            type="button"
            className="v3-button primary"
            style={{ fontSize: 12 }}
            onClick={onSave}
          >
            Done
          </button>
        ) : activeFields.length === 0 ? (
          // Every mapped phase is gate-approved (completed), so auto-commit never
          // fires. If the user has explicitly overridden one or more frozen inputs,
          // offer to raise a change request for just those (approving it reopens the
          // gate and applies them); otherwise there is nothing to do.
          lockedOverrideCount > 0 ? (
            <>
              <span style={{ fontSize: 12, color: "var(--v3-text-muted)" }} aria-live="polite">
                {saving
                  ? "Raising change requests…"
                  : `${lockedOverrideCount} completed-phase field${lockedOverrideCount !== 1 ? "s" : ""} to raise as change request${lockedOverrideCount !== 1 ? "s" : ""}`}
              </span>
              <button
                type="button"
                className="v3-button ghost"
                style={{ fontSize: 12 }}
                onClick={onCancel}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="v3-button primary"
                style={{ fontSize: 12 }}
                onClick={onSave}
                disabled={saving}
              >
                Raise {lockedOverrideCount} change request{lockedOverrideCount !== 1 ? "s" : ""}
              </button>
            </>
          ) : (
            <>
              <span style={{ fontSize: 12, color: "var(--v3-text-muted)" }} aria-live="polite">
                All mapped phases are gate-approved (completed) — override a field above to raise a change request.
              </span>
              <button
                type="button"
                className="v3-button ghost"
                style={{ fontSize: 12 }}
                onClick={onCancel}
              >
                Done
              </button>
            </>
          )
        ) : (
          <span style={{ fontSize: 12, color: "var(--v3-text-muted)" }} aria-live="polite">
            {saving
              ? "Saving approved fields…"
              : pendingCount > 0
                ? `${pendingCount} field${pendingCount !== 1 ? "s" : ""} left to review — approved fields save automatically`
                : approvedCount > 0
                  ? `Saving ${approvedCount} approved field${approvedCount !== 1 ? "s" : ""}…`
                  : "No fields approved — nothing to import"}
          </span>
        )}
      </div>
    </div>
  );
}
