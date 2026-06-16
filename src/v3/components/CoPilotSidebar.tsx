import React, { useRef, useState } from "react";
import type { AIConnectionStatus } from "@/v3/hooks/useAIStatus";
import { parseDocumentToText } from "@/new/lib/parseDocumentToText";

const MAX_ATTACHMENT_CHARS = 20_000;

type ParsedAttachment = {
  filename: string;
  text: string;
  wordCount: number;
  truncated: boolean;
};

interface CoPilotSidebarProps {
  open: boolean;
  onClose: () => void;
  activePhaseId: string | null;
  programName: string;
  confidenceScore: number | null;
  openDecisionCount: number;
  anyAgentRunning: boolean;
  aiStatus?: AIConnectionStatus;
  onOpenAISettings?: () => void;
  onRunAgent: (agentId: string, phaseId?: string) => void;
  onNavigate?: (view: string) => void;
  onSendMessage?: (message: string, attachments?: File[]) => void;
}

const QUICK_ACTIONS = [
  { label: "Daily briefing", icon: "☀", agentId: "daily-briefing" },
  { label: "Gate check", icon: "⬡", agentId: "gate-review" },
  { label: "Risk review", icon: "⚑", agentId: "risk-review" },
  { label: "Status report", icon: "✦", agentId: "narrative" },
  { label: "SteerCo pack", icon: "●", agentId: "steerco-prep" },
];

export default function CoPilotSidebar({
  open,
  onClose,
  activePhaseId,
  openDecisionCount,
  anyAgentRunning,
  aiStatus,
  onOpenAISettings,
  onRunAgent,
  onSendMessage,
}: CoPilotSidebarProps) {
  const [inputText, setInputText] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [parsedDocs, setParsedDocs] = useState<ParsedAttachment[]>([]);
  const [parsing, setParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const aiConnected = !aiStatus || aiStatus === "connected" || aiStatus === "checking";
  const phaseArg = activePhaseId ?? "program";

  const handleSend = () => {
    const msg = inputText.trim();
    if (!msg && attachments.length === 0) return;
    if (!onSendMessage) {
      // Copilot not yet connected — no-op with console warning only
      console.warn("[CoPilotSidebar] onSendMessage not wired — message discarded.");
      return;
    }
    const docContext = parsedDocs
      .filter((doc) => doc.text.trim().length > 0)
      .map((doc) =>
        `--- Document: ${doc.filename} (${doc.wordCount.toLocaleString()} words${doc.truncated ? ", truncated" : ""}) ---\n${doc.text.slice(0, MAX_ATTACHMENT_CHARS)}`,
      )
      .join("\n\n");
    const combined = [msg, docContext].filter(Boolean).join("\n\n");
    onSendMessage(combined, attachments);
    setInputText("");
    setAttachments([]);
    setParsedDocs([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAttachClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  };

  const canSend = inputText.trim().length > 0 || attachments.length > 0;

  return (
    <>
      {/* Overlay */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.25)",
            zIndex: 199,
          }}
        />
      )}

      {/* Sidebar panel */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: 340,
          height: "100%",
          zIndex: 200,
          background: "var(--v3-surface)",
          borderLeft: "1px solid var(--v3-border)",
          boxShadow: "-12px 0 32px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transform: open ? "translateX(0)" : "translateX(360px)",
          transition: "transform 0.25s cubic-bezier(0.4,0,0.2,1)",
          boxSizing: "border-box",
          fontFamily: "var(--v3-font)",
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px 14px",
            borderBottom: "1px solid var(--v3-border-soft)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "var(--v3-accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                color: "#fff",
                flexShrink: 0,
              }}
            >
              ✦
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--v3-text-primary)", lineHeight: 1.2 }}>
                Copilot
              </div>
              <div style={{ fontSize: 11, color: "var(--v3-text-muted)", lineHeight: 1.2, marginTop: 1 }}>
                {!aiConnected
                  ? "Smart features unavailable"
                  : anyAgentRunning
                  ? "Working…"
                  : "Ready"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Status dot */}
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: !aiConnected
                  ? "var(--v3-red)"
                  : anyAgentRunning
                  ? "var(--v3-amber)"
                  : "var(--v3-green)",
                display: "inline-block",
                boxShadow: !aiConnected
                  ? "0 0 5px var(--v3-red)"
                  : anyAgentRunning
                  ? "0 0 5px var(--v3-amber)"
                  : "0 0 5px var(--v3-green)",
                animation: anyAgentRunning ? "copilot-pulse 1.2s ease-in-out infinite" : "none",
              }}
            />
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 20,
                color: "var(--v3-text-muted)",
                lineHeight: 1,
                padding: "2px 4px",
                borderRadius: 6,
                fontFamily: "var(--v3-font)",
                display: "flex",
                alignItems: "center",
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* ── AI not connected banner ── */}
        {!aiConnected && (
          <div
            style={{
              margin: "12px 16px 0",
              padding: "12px 14px",
              background: "rgba(239,68,68,0.07)",
              borderRadius: 10,
              border: "1px solid rgba(239,68,68,0.2)",
              flexShrink: 0,
            }}
          >
            <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 600, color: "var(--v3-text-primary)" }}>
              Smart features unavailable
            </p>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--v3-text-secondary)", lineHeight: 1.5 }}>
              Programme analysis and recommendations are unavailable. You can still manage risks, decisions, and milestones manually.
            </p>
            {onOpenAISettings && (
              <button
                onClick={() => { onClose(); onOpenAISettings(); }}
                style={{
                  padding: "6px 12px", fontSize: 12, fontWeight: 600,
                  background: "var(--v3-accent)", color: "#fff", border: "none",
                  borderRadius: 8, cursor: "pointer", fontFamily: "var(--v3-font)",
                }}
              >
                Configure →
              </button>
            )}
          </div>
        )}

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>

          {/* Quick actions */}
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 10,
              fontWeight: 700,
              color: "var(--v3-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
            }}
          >
            Quick actions
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
            {QUICK_ACTIONS.map(({ label, icon, agentId }) => (
              <button
                key={agentId}
                onClick={() => aiConnected && onRunAgent(agentId, phaseArg)}
                disabled={!aiConnected}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  background: "var(--v3-surface-2)",
                  border: "1px solid var(--v3-border-soft)",
                  borderRadius: 10,
                  cursor: aiConnected ? "pointer" : "not-allowed",
                  color: aiConnected ? "var(--v3-text-primary)" : "var(--v3-text-muted)",
                  fontSize: 13,
                  fontFamily: "var(--v3-font)",
                  textAlign: "left",
                  opacity: aiConnected ? 1 : 0.45,
                  transition: "background 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  if (!aiConnected) return;
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--v3-surface-3)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--v3-accent)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--v3-surface-2)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--v3-border-soft)";
                }}
              >
                <span style={{ fontSize: 14, color: "var(--v3-accent)", width: 18, textAlign: "center" }}>{icon}</span>
                <span style={{ flex: 1 }}>{label}</span>
                <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>→</span>
              </button>
            ))}
          </div>

          {/* Decision nudge */}
          {openDecisionCount > 0 && (
            <div
              style={{
                padding: "10px 14px",
                background: "rgba(245,158,11,0.08)",
                border: "1px solid rgba(245,158,11,0.22)",
                borderRadius: 10,
                marginBottom: 16,
              }}
            >
              <span style={{ fontSize: 12, color: "var(--v3-text-secondary)" }}>
                ◆ {openDecisionCount} decision{openDecisionCount !== 1 ? "s" : ""} awaiting review
              </span>
            </div>
          )}
        </div>

        {/* ── Compose bar ── */}
        <div
          style={{
            borderTop: "1px solid var(--v3-border-soft)",
            padding: "12px 16px 16px",
            flexShrink: 0,
            background: "var(--v3-surface)",
          }}
        >
          {/* Attachment pills */}
          {attachments.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
              {parsing && (
                <div style={{ fontSize: 11, color: "var(--v3-accent)", padding: "2px 4px" }}>
                  ◌ Extracting document text…
                </div>
              )}
              {attachments.map((f, i) => {
                const parsed = parsedDocs.find((d) => d.filename === f.name);
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "5px 10px",
                      background: "var(--v3-surface-2)",
                      border: `1px solid ${parsed ? "color-mix(in srgb, var(--v3-accent) 40%, var(--v3-border-soft))" : "var(--v3-border-soft)"}`,
                      borderRadius: 10,
                      fontSize: 11,
                      color: "var(--v3-text-secondary)",
                    }}
                  >
                    <span style={{ fontSize: 13 }}>
                      {f.name.endsWith(".pdf") ? "⊡" : f.name.endsWith(".pptx") ? "⊟" : f.name.endsWith(".docx") ? "≡" : f.name.endsWith(".xlsx") ? "⊞" : "⊠"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
                        {f.name}
                      </div>
                      {parsed && (
                        <div style={{ fontSize: 10, color: "var(--v3-accent)", marginTop: 1 }}>
                          {parsed.wordCount.toLocaleString()} words extracted{parsed.truncated ? " (truncated)" : ""}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setAttachments((a) => a.filter((_, j) => j !== i));
                        setParsedDocs((prev) => prev.filter((d) => d.filename !== f.name));
                      }}
                      style={{
                        background: "none", border: "none", padding: 0,
                        cursor: "pointer", fontSize: 14, color: "var(--v3-text-muted)",
                        lineHeight: 1, flexShrink: 0,
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Input row */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 6,
              background: "var(--v3-surface-2)",
              border: "1px solid var(--v3-border)",
              borderRadius: 12,
              padding: "8px 10px",
            }}
          >
            {/* Hidden file input — placed outside any overflow-hidden ancestor via portal-like positioning */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.pptx,.png,.jpg,.jpeg"
              style={{ position: "fixed", top: "-9999px", left: "-9999px", opacity: 0, pointerEvents: "none" }}
              onChange={async (e) => {
                const files = Array.from(e.target.files || []);
                if (files.length === 0) return;
                setAttachments((a) => [...a, ...files]);
                e.target.value = "";
                // Parse documents in background
                setParsing(true);
                try {
                  const parsed = await Promise.all(
                    files.map(async (file): Promise<ParsedAttachment> => {
                      const result = await parseDocumentToText(file);
                      const text = result.ok ? result.text : "";
                      return {
                        filename: file.name,
                        text,
                        wordCount: result.ok ? (result.wordCount ?? 0) : 0,
                        truncated: text.length > MAX_ATTACHMENT_CHARS,
                      };
                    }),
                  );
                  setParsedDocs((prev) => [...prev, ...parsed]);
                } finally {
                  setParsing(false);
                }
              }}
            />

            {/* Attach button */}
            <button
              type="button"
              title="Attach document"
              onClick={handleAttachClick}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "3px 5px",
                borderRadius: 6,
                color: "var(--v3-text-muted)",
                fontSize: 18,
                lineHeight: 1,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                transition: "color 0.1s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--v3-accent)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--v3-text-muted)"; }}
            >
              +
            </button>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Copilot anything…"
              rows={1}
              style={{
                flex: 1,
                resize: "none",
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--v3-text-primary)",
                fontSize: 13,
                fontFamily: "var(--v3-font)",
                lineHeight: 1.5,
                padding: "1px 0",
                maxHeight: 120,
                overflowY: "auto",
              }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = Math.min(t.scrollHeight, 120) + "px";
              }}
            />

            {/* Send button */}
            <button
              type="button"
              title="Send"
              onClick={handleSend}
              disabled={!canSend}
              style={{
                background: canSend ? "var(--v3-accent)" : "var(--v3-surface-3)",
                border: "none",
                borderRadius: 8,
                width: 30,
                height: 30,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: canSend ? "pointer" : "default",
                color: canSend ? "#fff" : "var(--v3-text-muted)",
                flexShrink: 0,
                transition: "background 0.15s, color 0.15s",
                fontSize: 14,
              }}
            >
              ↑
            </button>
          </div>

          <p style={{ margin: "6px 0 0", fontSize: 10, color: "var(--v3-text-muted)", textAlign: "center" }}>
            ⏎ send · ⇧⏎ new line · + attach files
          </p>
        </div>
      </div>

      <style>{`
        @keyframes copilot-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </>
  );
}
