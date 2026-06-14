import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Decision {
  title: string;
  detail: string;
  owner: string | null;
  source: string;
}

interface ActionItem {
  title: string;
  owner: string | null;
  dueDate: string | null;
  priority: "high" | "medium" | "low";
  source: string;
}

interface Blocker {
  title: string;
  impact: string;
  owner: string | null;
  source: string;
}

interface ExtractedNotes {
  decisions: Decision[];
  actionItems: ActionItem[];
  blockers: Blocker[];
  keyDiscussions: Array<{ topic: string; summary: string; outcome: string | null }>;
  meetingNoteId?: string | null;
}

type Stage = "idle" | "extracting" | "reviewing" | "saving" | "done" | "error";

interface MeetingNotesPanelProps {
  programId: string | null;
  onClose?: () => void;
  onComplete?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        border: "2px solid var(--v3-accent)",
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: "var(--v3-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function CheckItem({
  label,
  sublabel,
  checked,
  onChange,
}: {
  label: string;
  sublabel?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "7px 0",
        cursor: "pointer",
        borderBottom: "1px solid var(--v3-border)",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: "var(--v3-accent)", flexShrink: 0 }}
      />
      <div>
        <div style={{ fontSize: 13, color: "var(--v3-text-primary)", lineHeight: 1.4 }}>{label}</div>
        {sublabel && (
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2, lineHeight: 1.3 }}>
            {sublabel}
          </div>
        )}
      </div>
    </label>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MeetingNotesPanel({
  programId,
  onClose,
  onComplete,
}: MeetingNotesPanelProps) {
  const [transcriptText, setTranscriptText] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedNotes | null>(null);
  const [meetingNoteId, setMeetingNoteId] = useState<string | null>(null);

  // Selection state — default all checked
  const [selectedDecisions, setSelectedDecisions] = useState<Set<number>>(new Set());
  const [selectedActions, setSelectedActions] = useState<Set<number>>(new Set());
  const [selectedBlockers, setSelectedBlockers] = useState<Set<number>>(new Set());

  // ── Extract ──────────────────────────────────────────────────────────────

  async function handleExtract() {
    if (!programId || !transcriptText.trim()) return;

    setStage("extracting");
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "meeting-notes-processor",
        {
          body: { programId, transcriptText: transcriptText.trim() },
        },
      );

      if (fnError) {
        throw new Error(fnError.message || "Function invocation failed.");
      }

      if (!data?.ok) {
        throw new Error(data?.error || "Extraction failed.");
      }

      const notes: ExtractedNotes = {
        decisions: data.decisions ?? [],
        actionItems: data.actionItems ?? [],
        blockers: data.blockers ?? [],
        keyDiscussions: data.keyDiscussions ?? [],
        meetingNoteId: data.meetingNoteId ?? null,
      };

      setExtracted(notes);
      setMeetingNoteId(data.meetingNoteId ?? null);

      // Default — select all items
      setSelectedDecisions(new Set(notes.decisions.map((_, i) => i)));
      setSelectedActions(new Set(notes.actionItems.map((_, i) => i)));
      setSelectedBlockers(new Set(notes.blockers.map((_, i) => i)));

      setStage("reviewing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setStage("error");
    }
  }

  // ── Approve ──────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!extracted || !programId) return;

    setStage("saving");
    setError(null);

    const approvedDecisions = extracted.decisions.filter((_, i) => selectedDecisions.has(i));
    const approvedActions = extracted.actionItems.filter((_, i) => selectedActions.has(i));
    const approvedBlockers = extracted.blockers.filter((_, i) => selectedBlockers.has(i));

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "meeting-notes-processor",
        {
          body: {
            action: "approve",
            programId,
            meetingNoteId,
            approved: {
              decisions: approvedDecisions,
              actionItems: approvedActions,
              blockers: approvedBlockers,
            },
          },
        },
      );

      if (fnError) {
        throw new Error(fnError.message || "Save failed.");
      }

      if (!data?.ok) {
        const errDetail = data?.errors?.join("; ") || data?.error || "Save failed.";
        throw new Error(errDetail);
      }

      setStage("done");
      onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setStage("error");
    }
  }

  // ── Reset ────────────────────────────────────────────────────────────────

  function reset() {
    setTranscriptText("");
    setStage("idle");
    setError(null);
    setExtracted(null);
    setMeetingNoteId(null);
    setSelectedDecisions(new Set());
    setSelectedActions(new Set());
    setSelectedBlockers(new Set());
  }

  // ── Counts ───────────────────────────────────────────────────────────────

  const totalSelected =
    selectedDecisions.size + selectedActions.size + selectedBlockers.size;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        background: "var(--v3-surface)",
        border: "1px solid var(--v3-border)",
        borderRadius: "var(--v3-radius-lg)",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 620,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--v3-text-primary)" }}>
            Meeting Notes
          </div>
          <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 3 }}>
            Paste a transcript or meeting minutes to extract decisions, actions, and blockers.
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--v3-text-muted)",
              fontSize: 20,
              lineHeight: 1,
              padding: 2,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* ── Stage: idle ──────────────────────────────────────────────────── */}
      {stage === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <textarea
            placeholder="Paste meeting transcript, notes, or minutes here…"
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
            rows={8}
            style={{
              width: "100%",
              background: "var(--v3-surface-2)",
              border: "1px solid var(--v3-border)",
              borderRadius: "var(--v3-radius)",
              padding: "10px 12px",
              fontSize: 13,
              color: "var(--v3-text-primary)",
              resize: "vertical",
              outline: "none",
              lineHeight: 1.6,
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />

          <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
            You can paste raw transcript text, structured meeting minutes, or bullet-point notes.
            The AI will extract and categorise the content automatically.
          </div>

          <button
            type="button"
            className="v3-button primary"
            onClick={() => void handleExtract()}
            disabled={!transcriptText.trim() || !programId}
            style={{ alignSelf: "flex-start" }}
          >
            Extract with AI →
          </button>

          {!programId && (
            <div style={{ fontSize: 11, color: "#f59e0b" }}>
              A programme must be selected before extracting.
            </div>
          )}
        </div>
      )}

      {/* ── Stage: extracting ────────────────────────────────────────────── */}
      {stage === "extracting" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "20px 0",
            color: "var(--v3-text-secondary)",
            fontSize: 13,
          }}
        >
          <Spinner />
          <span>AI is analysing meeting notes…</span>
        </div>
      )}

      {/* ── Stage: saving ────────────────────────────────────────────────── */}
      {stage === "saving" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "20px 0",
            color: "var(--v3-text-secondary)",
            fontSize: 13,
          }}
        >
          <Spinner />
          <span>Saving to programme…</span>
        </div>
      )}

      {/* ── Stage: reviewing ─────────────────────────────────────────────── */}
      {stage === "reviewing" && extracted && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Decisions */}
          {extracted.decisions.length > 0 && (
            <div>
              <SectionLabel>
                Decisions ({selectedDecisions.size}/{extracted.decisions.length} selected)
              </SectionLabel>
              {extracted.decisions.map((d, i) => (
                <CheckItem
                  key={i}
                  label={d.title}
                  sublabel={[d.owner ? `Owner: ${d.owner}` : null, d.detail].filter(Boolean).join(" · ") || undefined}
                  checked={selectedDecisions.has(i)}
                  onChange={(checked) => {
                    setSelectedDecisions((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(i); else next.delete(i);
                      return next;
                    });
                  }}
                />
              ))}
            </div>
          )}

          {/* Action Items */}
          {extracted.actionItems.length > 0 && (
            <div>
              <SectionLabel>
                Action Items ({selectedActions.size}/{extracted.actionItems.length} selected)
              </SectionLabel>
              {extracted.actionItems.map((a, i) => {
                const sub = [
                  a.owner ? `Owner: ${a.owner}` : null,
                  a.dueDate ? `Due: ${a.dueDate}` : null,
                  a.priority !== "medium" ? `Priority: ${a.priority}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <CheckItem
                    key={i}
                    label={a.title}
                    sublabel={sub || undefined}
                    checked={selectedActions.has(i)}
                    onChange={(checked) => {
                      setSelectedActions((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(i); else next.delete(i);
                        return next;
                      });
                    }}
                  />
                );
              })}
            </div>
          )}

          {/* Blockers */}
          {extracted.blockers.length > 0 && (
            <div>
              <SectionLabel>
                Blockers ({selectedBlockers.size}/{extracted.blockers.length} selected)
              </SectionLabel>
              {extracted.blockers.map((b, i) => (
                <CheckItem
                  key={i}
                  label={b.title}
                  sublabel={[b.impact, b.owner ? `Owner: ${b.owner}` : null].filter(Boolean).join(" · ") || undefined}
                  checked={selectedBlockers.has(i)}
                  onChange={(checked) => {
                    setSelectedBlockers((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(i); else next.delete(i);
                      return next;
                    });
                  }}
                />
              ))}
            </div>
          )}

          {extracted.decisions.length === 0 &&
            extracted.actionItems.length === 0 &&
            extracted.blockers.length === 0 && (
            <div
              style={{
                padding: "16px 14px",
                background: "var(--v3-surface-2)",
                borderRadius: "var(--v3-radius)",
                fontSize: 13,
                color: "var(--v3-text-muted)",
                textAlign: "center",
              }}
            >
              No decisions, actions, or blockers were identified in the transcript.
            </div>
          )}

          {/* Action bar */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", paddingTop: 4 }}>
            <button
              type="button"
              className="v3-button primary"
              onClick={() => void handleSave()}
              disabled={totalSelected === 0}
            >
              Save to Programme ({totalSelected} item{totalSelected !== 1 ? "s" : ""})
            </button>
            <button
              type="button"
              onClick={reset}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--v3-text-muted)",
                fontSize: 12,
                padding: 0,
                textDecoration: "underline",
              }}
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {/* ── Stage: done ──────────────────────────────────────────────────── */}
      {stage === "done" && (
        <div
          style={{
            background: "var(--v3-green-soft)",
            border: "1px solid rgba(34,197,94,0.2)",
            borderRadius: "var(--v3-radius)",
            padding: "14px 16px",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-green)" }}>
            Meeting notes saved successfully
          </div>
          <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 5, lineHeight: 1.5 }}>
            Selected decisions have been added to the decision queue and action items and blockers
            have been added to the RAID log.
          </div>
          <button
            type="button"
            className="v3-button ghost"
            style={{ fontSize: 12, marginTop: 10 }}
            onClick={reset}
          >
            Process another
          </button>
        </div>
      )}

      {/* ── Stage: error ─────────────────────────────────────────────────── */}
      {stage === "error" && error && (
        <div
          style={{
            background: "var(--v3-red-soft)",
            border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: "var(--v3-radius)",
            padding: "12px 14px",
            fontSize: 13,
            color: "var(--v3-red)",
          }}
        >
          {error}
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className="v3-button ghost"
              style={{ fontSize: 12 }}
              onClick={reset}
            >
              Try again
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
