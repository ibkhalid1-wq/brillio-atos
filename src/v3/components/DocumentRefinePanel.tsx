/**
 * DocumentRefinePanel — conversational refinement for AI-generated documents.
 * User types an instruction ("make this more concise", "focus on technology risks"),
 * and the AI applies targeted edits to the document.
 */
import React, { useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";

interface RefineInstruction {
  instruction: string;
  timestamp: string;
  result?: string;
}

interface DocumentRefinePanelProps {
  programId: string | null;
  artifactType: "narrative" | "deck-section";
  sectionType?: string; // For deck: slide type like "risks", "financials"
  currentContent: string; // Current content being shown
  onRefined: (newContent: string) => void; // Called when refinement produced new content
  onClose: () => void;
}

export default function DocumentRefinePanel({
  programId,
  artifactType,
  sectionType,
  currentContent,
  onRefined,
  onClose,
}: DocumentRefinePanelProps) {
  const [instruction, setInstruction] = useState("");
  const [history, setHistory] = useState<RefineInstruction[]>([]);
  const [isRefining, setIsRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const SUGGESTIONS = [
    "Make this more concise",
    "Use more executive language",
    "Focus on the key risks",
    "Add more detail on timeline",
    "Simplify the language",
    "Make the tone more urgent",
  ];

  async function handleRefine() {
    if (!instruction.trim() || !programId || !isSupabaseConfigured || !supabase) return;
    setIsRefining(true);
    setError(null);
    try {
      const agentId = artifactType === "narrative" ? "narrative-refine" : "deck-section";
      const phaseId = artifactType === "narrative" ? instruction.trim() : (sectionType || "risks");

      const { data, error: fnError } = await supabase.functions.invoke("run-agent", {
        body: { programId, agentId, phaseId, triggeredBy: "user" },
      });

      if (fnError) throw new Error(fnError.message);
      const response = data as { output?: Record<string, unknown>; error?: string };
      if (response.error) throw new Error(response.error);

      // Extract the refined content
      const output = response.output;
      let refined = "";
      if (artifactType === "narrative" && typeof output?.narrative === "string") {
        refined = output.narrative;
      } else if (artifactType === "deck-section" && typeof (output?.slide as Record<string,unknown>)?.speakerNotes === "string") {
        refined = JSON.stringify(output?.slide, null, 2);
      }

      if (refined) {
        setHistory((prev) => [...prev, { instruction: instruction.trim(), timestamp: new Date().toISOString(), result: refined }]);
        onRefined(refined);
        setInstruction("");
      } else {
        throw new Error("No refined content returned");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refinement failed");
    } finally {
      setIsRefining(false);
    }
  }

  return (
    <div style={{
      position: "absolute", right: 0, top: 0, width: 300, height: "100%",
      background: "var(--v3-surface)", border: "1px solid var(--v3-border)",
      borderRadius: 8, boxShadow: "-4px 0 16px rgba(0,0,0,0.08)",
      display: "flex", flexDirection: "column", zIndex: 10,
    }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--v3-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)" }}>Refine with AI</div>
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2 }}>Type an instruction to edit this section</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close refine panel" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--v3-text-muted)", lineHeight: 1, padding: 2 }}>×</button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {history.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {history.map((item, i) => (
              <div key={i} style={{ marginBottom: 10, padding: "8px 10px", background: "var(--v3-surface-2)", borderRadius: 6, fontSize: 11 }}>
                <div style={{ color: "var(--v3-text-muted)", marginBottom: 2 }}>→ {item.instruction}</div>
                <div style={{ color: "var(--v3-green)", fontWeight: 500 }}>✓ Applied</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginBottom: 8 }}>Suggestions:</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button"
              onClick={() => setInstruction(s)}
              style={{ fontSize: 11, padding: "3px 8px", borderRadius: 12, border: "1px solid var(--v3-border)", background: "var(--v3-surface-2)", cursor: "pointer", color: "var(--v3-text-secondary)" }}>
              {s}
            </button>
          ))}
        </div>

        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="e.g. Make this more concise and focus on delivery risks"
          rows={3}
          style={{ width: "100%", fontSize: 12, padding: "8px 10px", border: "1px solid var(--v3-border)", borderRadius: 6, background: "var(--v3-surface-2)", color: "var(--v3-text-primary)", resize: "vertical", outline: "none" }}
          onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) void handleRefine(); }}
        />
        {error && <div style={{ fontSize: 11, color: "var(--v3-red)", marginTop: 6 }}>{error}</div>}
      </div>

      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--v3-border)" }}>
        <button
          type="button"
          disabled={!instruction.trim() || isRefining || !programId}
          onClick={() => void handleRefine()}
          style={{
            width: "100%", padding: "8px 0", borderRadius: 6, border: "none",
            background: instruction.trim() && !isRefining ? "var(--v3-accent)" : "var(--v3-surface-2)",
            color: instruction.trim() && !isRefining ? "#fff" : "var(--v3-text-muted)",
            fontSize: 12, fontWeight: 500, cursor: instruction.trim() && !isRefining ? "pointer" : "not-allowed",
          }}
        >
          {isRefining ? "Refining…" : "Apply Refinement ↵"}
        </button>
        <div style={{ fontSize: 10, color: "var(--v3-text-muted)", textAlign: "center", marginTop: 6 }}>⌘ + Enter to apply</div>
      </div>
    </div>
  );
}
