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

import React, { useState } from "react";
import type { DocumentIntelligence, ReviewField } from "@/new/lib/documentIntelligenceTypes";
import {
  confidenceLabel,
  DOCUMENT_TYPE_LABELS,
  EXTRACTION_TYPE_COLORS,
  EXTRACTION_TYPE_LABELS,
} from "@/new/lib/documentIntelligenceTypes";
import { PHASE_INPUT_SCHEMAS } from "@/v3/lib/phaseInputSchema";

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

// ─── Single review field row ──────────────────────────────────────────────────

function ReviewFieldRow({
  field,
  onApprove,
  onReject,
  onEdit,
}: {
  field: ReviewField;
  onApprove: () => void;
  onReject: () => void;
  onEdit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(
    field.mapping.editedValue ?? field.mapping.value,
  );
  const state = field.mapping.reviewState ?? "pending";
  const displayValue =
    state === "edited" ? (field.mapping.editedValue ?? field.mapping.value) : field.mapping.value;

  return (
    <div
      style={{
        background: state === "rejected"
          ? "rgba(239,68,68,0.04)"
          : state === "approved" || state === "edited"
            ? "rgba(34,197,94,0.04)"
            : "var(--v3-surface-2, rgba(255,255,255,0.03))",
        border: `1px solid ${
          field.hasConflict && state === "pending"
            ? "rgba(245,158,11,0.3)"
            : state === "rejected"
              ? "rgba(239,68,68,0.2)"
              : state === "approved" || state === "edited"
                ? "rgba(34,197,94,0.2)"
                : "var(--v3-border, rgba(255,255,255,0.08))"
        }`,
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        opacity: state === "rejected" ? 0.55 : 1,
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
        <ExtractionBadge type={field.mapping.extractionType} />
        <ConfidenceBar score={field.mapping.confidence} />

        {/* Approve / Reject / Edit controls */}
        <div style={{ display: "flex", gap: 4 }}>
          {state !== "approved" && state !== "edited" && (
            <button
              type="button"
              onClick={onApprove}
              title="Approve"
              style={{
                background: "rgba(34,197,94,0.15)",
                border: "1px solid rgba(34,197,94,0.3)",
                borderRadius: 5,
                color: "#22c55e",
                fontSize: 11,
                padding: "2px 8px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              ✓
            </button>
          )}
          {(state === "approved" || state === "edited") && (
            <span style={{ color: "#22c55e", fontSize: 11, fontWeight: 700 }}>✓ Approved</span>
          )}
          {state !== "rejected" && (
            <button
              type="button"
              onClick={onReject}
              title="Reject"
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 5,
                color: "#ef4444",
                fontSize: 11,
                padding: "2px 8px",
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          )}
          {state === "rejected" && (
            <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 700 }}>✕ Rejected</span>
          )}
          {!editing && state !== "rejected" && (
            <button
              type="button"
              onClick={() => {
                setEditValue(displayValue);
                setEditing(true);
              }}
              title="Edit value"
              style={{
                background: "transparent",
                border: "1px solid var(--v3-border)",
                borderRadius: 5,
                color: "var(--v3-text-muted)",
                fontSize: 11,
                padding: "2px 7px",
                cursor: "pointer",
              }}
            >
              ✎
            </button>
          )}
        </div>
      </div>

      {/* Conflict warning */}
      {field.hasConflict && state === "pending" && (
        <div
          style={{
            fontSize: 10,
            color: "#f59e0b",
            background: "rgba(245,158,11,0.1)",
            borderRadius: 4,
            padding: "3px 7px",
            display: "flex",
            gap: 5,
            alignItems: "center",
          }}
        >
          <span>⚠</span>
          <span>
            Conflicts with existing value:{" "}
            <em style={{ opacity: 0.8 }}>"{(field.existingValue ?? "").slice(0, 80)}"</em>
          </span>
        </div>
      )}

      {/* Value display / edit */}
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
      ) : (
        <div
          style={{
            fontSize: 12,
            color: "var(--v3-text-secondary)",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {displayValue}
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
  onApprove,
  onReject,
  onEdit,
}: {
  phaseId: string;
  fields: ReviewField[];
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
          color: "var(--v3-accent)",
          padding: "6px 0 2px",
          borderBottom: "1px solid var(--v3-border)",
        }}
      >
        {phaseLabel}
      </div>
      {fields.map((field) => (
        <ReviewFieldRow
          key={`${field.phaseId}-${field.fieldId}`}
          field={field}
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
  saving: boolean;
  onUpdateField: (
    phaseId: string,
    fieldId: string,
    patch: { reviewState?: "approved" | "rejected" | "edited"; editedValue?: string },
  ) => void;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export function DocumentReviewPanel({
  intelligence,
  reviewFields,
  saving,
  onUpdateField,
  onApproveAll,
  onRejectAll,
  onSave,
  onCancel,
}: DocumentReviewPanelProps) {
  const docTypeLabel =
    DOCUMENT_TYPE_LABELS[intelligence.documentType as keyof typeof DOCUMENT_TYPE_LABELS] ??
    "Document";

  // Group review fields by phase
  const byPhase = reviewFields.reduce<Record<string, ReviewField[]>>((acc, f) => {
    if (!acc[f.phaseId]) acc[f.phaseId] = [];
    acc[f.phaseId].push(f);
    return acc;
  }, {});

  const approvedCount = reviewFields.filter(
    (f) => f.mapping.reviewState === "approved" || f.mapping.reviewState === "edited",
  ).length;
  const rejectedCount = reviewFields.filter((f) => f.mapping.reviewState === "rejected").length;
  const pendingCount = reviewFields.filter(
    (f) => !f.mapping.reviewState || f.mapping.reviewState === "pending",
  ).length;
  const conflictCount = reviewFields.filter((f) => f.hasConflict).length;

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
                {reviewFields.length} field{reviewFields.length !== 1 ? "s" : ""} to populate
              </span>
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

            <div style={{ display: "flex", gap: 6 }}>
              {pendingCount > 0 && (
                <button
                  type="button"
                  className="v3-button ghost"
                  style={{ fontSize: 11 }}
                  onClick={onApproveAll}
                >
                  Accept all ({pendingCount})
                </button>
              )}
              <button
                type="button"
                className="v3-button ghost"
                style={{ fontSize: 11, color: "var(--v3-text-muted)" }}
                onClick={onRejectAll}
              >
                Reject all
              </button>
            </div>
          </div>

          {/* ── Fields grouped by phase ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {Object.entries(byPhase).map(([phaseId, fields]) => (
              <PhaseGroup
                key={phaseId}
                phaseId={phaseId}
                fields={fields}
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

      {/* ── Action bar ── */}
      <div
        style={{
          display: "flex",
          gap: 8,
          paddingTop: 8,
          borderTop: "1px solid var(--v3-border)",
          justifyContent: "flex-end",
        }}
      >
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
          disabled={saving || (reviewFields.length > 0 && approvedCount === 0 && pendingCount === 0)}
        >
          {saving
            ? "Saving…"
            : approvedCount > 0
              ? `Save ${approvedCount} approved field${approvedCount !== 1 ? "s" : ""}`
              : reviewFields.length === 0
                ? "Done"
                : "Save pending fields"}
        </button>
      </div>
    </div>
  );
}
