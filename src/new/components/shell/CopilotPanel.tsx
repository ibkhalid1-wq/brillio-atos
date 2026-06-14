import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import { useCopilotThread } from "@/hooks/useCopilotThread";
import type { AppView, NudgeSummary, Persona } from "@/new/types";
import { SparklesIcon } from "@/new/components/ui/Icons";
import { useAIStatus } from "@/v3/hooks/useAIStatus";
import type { DocumentIntelligence } from "@/new/lib/documentIntelligenceTypes";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

const AI_NATIVE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);
const AI_PARSE_MAX_BYTES = 10 * 1024 * 1024;

/** Build the context message Copilot will respond to from extracted intelligence */
function buildDocumentContextMessage(fileName: string, intel: DocumentIntelligence): string {
  const ent = intel.entities ?? {};
  const lines: string[] = [
    `I've uploaded a document: "${fileName}"`,
    "",
    `DOCUMENT INTELLIGENCE SUMMARY`,
    `Type: ${intel.documentType ?? "document"}`,
    `Summary: ${intel.summary ?? "No summary available."}`,
    `Primary phase: ${intel.primaryPhase ?? "unknown"}`,
    `Confidence: ${Math.round((intel.overallConfidence ?? 0) * 100)}%`,
    "",
  ];

  const entitySections: [string, unknown[]][] = [
    ["Objectives", ent.objectives ?? []],
    ["Risks", ent.risks ?? []],
    ["Stakeholders", ent.stakeholders ?? []],
    ["Milestones", ent.milestones ?? []],
    ["Requirements", ent.requirements ?? []],
    ["Decisions", ent.decisions ?? []],
    ["Actions", ent.actions ?? []],
  ];

  const populated = entitySections.filter(([, arr]) => arr.length > 0);
  if (populated.length > 0) {
    lines.push("KEY ENTITIES DETECTED:");
    for (const [label, arr] of populated) {
      const items = (arr as Array<Record<string, unknown>>)
        .slice(0, 4)
        .map((e) => String(e.text || e.title || e.name || ""))
        .filter(Boolean);
      lines.push(`• ${label} (${arr.length}): ${items.join("; ")}${arr.length > 4 ? "…" : ""}`);
    }
    lines.push("");
  }

  const mappings = intel.methodologyMappings ?? {};
  const mappedPhases = Object.keys(mappings).filter((p) => Object.keys(mappings[p] ?? {}).length > 0);
  if (mappedPhases.length > 0) {
    lines.push("METHODOLOGY FIELDS IDENTIFIED:");
    for (const phaseId of mappedPhases) {
      const fields = Object.keys(mappings[phaseId] ?? {});
      lines.push(`• ${phaseId}: ${fields.join(", ")}`);
    }
    lines.push("");
  }

  if (intel.gaps) {
    lines.push(`GAPS IDENTIFIED: ${intel.gaps}`);
    lines.push("");
  }

  lines.push(
    "Based on this document, please:",
    "1. Acknowledge what you found and what type of document this is",
    "2. Summarise the key insights relevant to this programme",
    "3. Identify what additional information would strengthen the programme inputs",
    "4. Recommend the single best next action",
  );

  return lines.join("\n");
}

interface CopilotPanelProps {
  programId: string;
  workspaceId: string;
  persona: Persona;
  nudge?: NudgeSummary | null;
  memoryContext?: string;
  onNavigate?: (view: AppView) => void;
  open: boolean;
  onClose: () => void;
}

const WORKSPACE_LABEL: Record<string, string> = {
  home: "Transformation Advisor",
  twin: "Architect",
  work: "FDE Lead",
  decisions: "PMO Lead",
  intelligence: "Intelligence Analyst",
};

const QUICK_PROMPTS: [string, string][] = [
  ["Generate artifact", "Generate the next artifact I need in this workspace."],
  ["Queue decision", "What decision should be queued next for human review?"],
  ["Explain this", "Explain the current program state in plain language."],
  ["What's next?", "What is the single best next action right now?"],
];

export function CopilotPanel({
  programId,
  workspaceId,
  persona,
  nudge,
  memoryContext,
  onNavigate,
  open,
  onClose,
}: CopilotPanelProps) {
  const { messages, isLoading, sendMessage, clearThread } = useCopilotThread(programId, workspaceId, memoryContext);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const visibleMessages = useMemo(() => messages.slice(-12), [messages]);
  const roleLabel = WORKSPACE_LABEL[workspaceId] || "Advisor";
  const aiStatus = useAIStatus();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [fileProcessing, setFileProcessing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submit = async () => {
    if (!input.trim() && !attachedFile) return;
    setError("");
    setFileError(null);

    // ── File attachment: extract intelligence then send as rich context message ──
    if (attachedFile) {
      if (!isSupabaseConfigured || !supabase) {
        setFileError("Supabase is not configured.");
        return;
      }
      setFileProcessing(true);
      try {
        const file = attachedFile;
        const canUseNative = AI_NATIVE_TYPES.has(file.type) && file.size <= AI_PARSE_MAX_BYTES;
        let fileAttachment: { base64: string; mimeType: string; name: string } | undefined;
        let text = "";

        if (canUseNative) {
          try {
            fileAttachment = { base64: await fileToBase64(file), mimeType: file.type, name: file.name };
          } catch { /* fall through to text parse */ }
        }

        if (!fileAttachment) {
          const { parseDocumentToText } = await import("@/new/lib/parseDocumentToText");
          const parsed = await parseDocumentToText(file);
          if (parsed.ok) text = parsed.text ?? "";
        }

        const { data, error: fnErr } = await supabase.functions.invoke("document-intelligence", {
          body: {
            programId,
            text: text || undefined,
            fileName: file.name,
            fileAttachment: fileAttachment || undefined,
          },
        });

        if (fnErr) throw new Error(fnErr.message);

        const resp = data as { ok: boolean; intelligence?: DocumentIntelligence; error?: string; isAIUnavailable?: boolean };

        if (resp.isAIUnavailable) {
          setFileError("AI provider is not configured. Copilot cannot process documents without an AI provider.");
          setFileProcessing(false);
          return;
        }

        if (!resp.ok || !resp.intelligence) {
          throw new Error(resp.error || "Extraction returned no data.");
        }

        // Build context message and send it through the normal Copilot thread
        const contextMessage = buildDocumentContextMessage(file.name, resp.intelligence);
        const combinedMessage = input.trim()
          ? `${contextMessage}\n\nAdditional context from user: ${input.trim()}`
          : contextMessage;

        setAttachedFile(null);
        setInput("");
        setFileProcessing(false);
        await sendMessage(combinedMessage);
      } catch (err) {
        setFileProcessing(false);
        setFileError(err instanceof Error ? err.message : "Could not process the attached document.");
      }
      return;
    }

    // ── Plain text message ──
    try {
      await sendMessage(input.trim());
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reach Copilot.");
    }
  };

  if (!open) return null;

  // ── AI unavailable — show disabled state instead of broken Copilot ──────
  const aiUnavailable = aiStatus.status === "not-configured" || aiStatus.status === "error" || aiStatus.status === "offline";
  if (aiUnavailable && aiStatus.status !== "checking") {
    return (
      <>
        <div className="acb-copilot-scrim" onClick={onClose} />
        <aside className="acb-copilot-panel">
          <div className="acb-copilot-header">
            <div className="acb-copilot-header-left">
              <SparklesIcon className="acb-icon" style={{ color: "#6b7280" } as React.CSSProperties} />
              <div>
                <div className="adam-title">Copilot</div>
                <div className="adam-micro adam-muted">Unavailable</div>
              </div>
            </div>
            <button type="button" className="adam-button-ghost" style={{ minHeight: 30, padding: "0 10px", fontSize: 12 }} onClick={onClose}>
              Close
            </button>
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              padding: 32,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 40 }}>🤖</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--adam-text-primary, #fff)" }}>
              {aiStatus.status === "not-configured"
                ? "AI provider not configured"
                : "AI services temporarily unavailable"}
            </div>
            <div style={{ fontSize: 13, color: "var(--adam-text-muted, #9ca3af)", lineHeight: 1.6, maxWidth: 300 }}>
              {aiStatus.status === "not-configured"
                ? "Copilot requires an AI provider to be connected. Open AI Settings to connect Anthropic, OpenAI, or Google."
                : "Copilot is temporarily unavailable. Core platform features continue to work normally. Please try again shortly."}
            </div>
            {aiStatus.status === "not-configured" && (
              <button
                type="button"
                className="adam-button-primary"
                style={{ fontSize: 13 }}
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("adam:open-ai-settings"));
                  onClose();
                }}
              >
                Open AI Settings →
              </button>
            )}
            {aiStatus.status !== "not-configured" && (
              <button
                type="button"
                className="adam-button-ghost"
                style={{ fontSize: 13 }}
                onClick={() => aiStatus.recheck()}
              >
                Retry connection
              </button>
            )}
          </div>
        </aside>
      </>
    );
  }

  return (
    <>
      <div className="acb-copilot-scrim" onClick={onClose} />
      <aside className="acb-copilot-panel">
        <div className="acb-copilot-header">
          <div className="acb-copilot-header-left">
            <SparklesIcon className="acb-icon" style={{ color: "#93c5fd" } as React.CSSProperties} />
            <div>
              <div className="adam-title">{roleLabel}</div>
              <div className="adam-micro adam-muted capitalize">{persona}</div>
            </div>
          </div>
          <div className="adam-row">
            <button
              type="button"
              className="adam-button-ghost"
              style={{ minHeight: 30, padding: "0 10px", fontSize: 12 }}
              onClick={() => void clearThread()}
            >
              Clear
            </button>
            <button
              type="button"
              className="adam-button-ghost"
              style={{ minHeight: 30, padding: "0 10px", fontSize: 12 }}
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        {nudge ? (
          <div className="acb-nudge-banner">
            <span className="adam-body" style={{ fontSize: 12 }}>
              {nudge.message}
            </span>
            {nudge.actionView && onNavigate ? (
              <button
                type="button"
                className="adam-button-ghost"
                style={{ minHeight: 26, padding: "0 8px", fontSize: 11, flexShrink: 0 }}
                onClick={() => {
                  onNavigate(nudge.actionView!);
                  onClose();
                }}
              >
                {nudge.actionLabel || "Go →"}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="acb-copilot-messages adam-scroll">
          {!visibleMessages.length && !isLoading ? (
            <div className="acb-copilot-empty">Ask anything about the transformation program, agents, or next steps.</div>
          ) : null}
          {visibleMessages.map((msg) => (
            <div
              key={`${msg.timestamp}-${msg.role}`}
              className={`acb-message ${msg.role === "assistant" ? "is-assistant" : "is-user"}`}
            >
              <div className="acb-message-role">{msg.role === "assistant" ? roleLabel : "You"}</div>
              <div className="acb-message-body">{msg.content}</div>
            </div>
          ))}
          {isLoading ? (
            <div className="acb-message is-assistant">
              <div className="acb-message-role">{roleLabel}</div>
              <div className="acb-message-body adam-muted">Thinking…</div>
            </div>
          ) : null}
          {error ? (
            <div className="acb-message is-error">
              <div className="acb-message-body">{error}</div>
            </div>
          ) : null}
        </div>

        {messages.length >= 14 ? (
          <div style={{ fontSize: 10, color: "var(--v3-text-muted)", textAlign: "center", padding: "4px 0", borderTop: "1px solid var(--v3-border-soft)" }}>
            Earlier messages are being summarised to maintain context quality.
          </div>
        ) : null}

        <div className="acb-quick-prompts">
          {QUICK_PROMPTS.map(([label, prompt]) => (
            <button
              key={label}
              type="button"
              className="adam-chip"
              onClick={() =>
                void sendMessage(prompt).catch((e) =>
                  setError(e instanceof Error ? e.message : "Error"),
                )
              }
            >
              {label}
            </button>
          ))}
        </div>

        {/* File attachment chip */}
        {attachedFile && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              background: "rgba(99,102,241,0.1)",
              borderTop: "1px solid rgba(99,102,241,0.2)",
              fontSize: 12,
            }}
          >
            <span style={{ fontSize: 14 }}>📎</span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--adam-text-primary, #fff)" }}>
              {attachedFile.name}
            </span>
            <span style={{ fontSize: 11, color: "var(--adam-text-muted, #9ca3af)" }}>
              {(attachedFile.size / 1024).toFixed(0)} KB
            </span>
            {!fileProcessing && (
              <button
                type="button"
                onClick={() => setAttachedFile(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--adam-text-muted)", fontSize: 14, lineHeight: 1, padding: 2 }}
              >
                ×
              </button>
            )}
          </div>
        )}

        {/* File processing indicator */}
        {fileProcessing && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              background: "rgba(99,102,241,0.08)",
              borderTop: "1px solid rgba(99,102,241,0.15)",
              fontSize: 12,
              color: "#93c5fd",
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                border: "2px solid #93c5fd",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "acb-spin 0.8s linear infinite",
                flexShrink: 0,
              }}
            />
            Analysing document with AI…
          </div>
        )}

        {/* File error */}
        {fileError && (
          <div style={{ padding: "6px 12px", fontSize: 11, color: "#ef4444", borderTop: "1px solid rgba(239,68,68,0.2)" }}>
            {fileError}
          </div>
        )}

        <div className="acb-copilot-input-row">
          {/* Paperclip / attach button */}
          <button
            type="button"
            title="Attach a document"
            onClick={() => fileInputRef.current?.click()}
            disabled={fileProcessing || isLoading}
            style={{
              background: attachedFile ? "rgba(99,102,241,0.15)" : "transparent",
              border: "1px solid var(--v3-border, rgba(255,255,255,0.1))",
              borderRadius: 6,
              color: attachedFile ? "#93c5fd" : "var(--adam-text-muted, #9ca3af)",
              cursor: "pointer",
              fontSize: 16,
              padding: "0 8px",
              minHeight: 34,
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            📎
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,.md,.html,.png,.jpg,.jpeg,.webp,.gif,.json,.zip,.eml"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setAttachedFile(file);
                setFileError(null);
              }
              e.target.value = "";
            }}
          />
          <input
            className="adam-input"
            value={input}
            placeholder={attachedFile ? "Add a note (optional) then Send…" : "Ask Copilot anything…"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            disabled={fileProcessing}
          />
          <button
            type="button"
            className="adam-button"
            onClick={() => void submit()}
            disabled={fileProcessing || isLoading || (!input.trim() && !attachedFile)}
          >
            {fileProcessing ? "…" : "Send"}
          </button>
        </div>

        <style>{`@keyframes acb-spin { to { transform: rotate(360deg); } }`}</style>
      </aside>
    </>
  );
}
