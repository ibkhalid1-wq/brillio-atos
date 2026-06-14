import React, { useEffect, useMemo, useState } from "react";
import { sanitizeMarkdown } from "@/lib/sanitize";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";
import type { ProgramSummary } from "@/new/types";
import { checkNarrativeCompleteness, checkDeckCompleteness, checkPlanCompleteness } from "@/v3/lib/documentCompleteness";

interface ArtifactEditorProps {
  label: string;
  content: string;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
  generatedAt?: string | null;
  program?: ProgramSummary;
  artifactType?: "narrative" | "deck" | "plan" | string;
}

export default function ArtifactEditor({ label, content, onSave, onClose, generatedAt, program, artifactType }: ArtifactEditorProps) {
  const [value, setValue] = useState(content);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = value !== content;

  const completenessWarnings = useMemo(() => {
    if (!program) return [];
    if (artifactType === "narrative") return checkNarrativeCompleteness(program);
    if (artifactType === "deck") return checkDeckCompleteness(program);
    if (artifactType === "plan") return checkPlanCompleteness(program);
    return [];
  }, [program, artifactType]);

  useEffect(() => {
    setValue(content);
  }, [content]);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(sanitizeMarkdown(value));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="v3-artifact-editor">
      <div className="v3-artifact-editor-header">
        <div>
          <div className="v3-artifact-editor-label">{label}</div>
          {generatedAt ? (
            <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2 }}>
              Last generated <RelativeTime date={generatedAt} />
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {dirty ? (
            <button
              type="button"
              className="v3-button primary"
              style={{ fontSize: 12 }}
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saved ? "Saved ✓" : saving ? "Saving…" : "Save changes"}
            </button>
          ) : null}
          <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {dirty ? (
        <div style={{ fontSize: 11, color: "var(--v3-amber, #f59e0b)", marginBottom: 8 }}>
          ⚠ Unsaved changes — your edits override the agent-generated version.
        </div>
      ) : null}
      {completenessWarnings.length > 0 && (
        <div style={{ marginBottom: 12, padding: "10px 14px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#f59e0b", marginBottom: 4 }}>Input gaps detected</div>
          {completenessWarnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: "var(--v3-text-muted)", display: "flex", gap: 6, marginTop: 2 }}>
              <span style={{ color: w.severity === "blocking" ? "var(--v3-red)" : "#f59e0b" }}>{w.severity === "blocking" ? "●" : "○"}</span>
              <span><strong>{w.field}</strong> — {w.impact}</span>
            </div>
          ))}
        </div>
      )}
      <textarea
        className="v3-input v3-textarea v3-artifact-editor-textarea"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={16}
        aria-label={`Edit ${label}`}
      />
      <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 6 }}>
        Edits are saved as human overrides. The agent will incorporate your version on the next run.
      </div>
    </div>
  );
}
