import React, { useEffect, useMemo, useState } from "react";
import { useCopilotThread } from "@/hooks/useCopilotThread";
import type { AppView, NudgeSummary, Persona } from "@/new/types";
import { SparklesIcon, UserIcon } from "@/new/components/ui/Icons";
import { useAIStatus } from "@/v3/hooks/useAIStatus";

interface AdvisorBarProps {
  programId: string;
  workspaceId: string;
  persona: Persona;
  nudge?: NudgeSummary | null;
  onNavigate?: (view: AppView) => void;
}

function identityForWorkspace(workspaceId: string): string {
  if (workspaceId === "home") return "Transformation Advisor";
  if (workspaceId === "twin") return "Architect";
  if (workspaceId === "work") return "FDE Lead";
  if (workspaceId === "decisions") return "PMO Lead";
  if (workspaceId === "intelligence") return "Intelligence Analyst";
  return "Workspace Advisor";
}

export function AdvisorBar({ programId, workspaceId, persona, nudge, onNavigate }: AdvisorBarProps) {
  const { messages, isLoading, sendMessage, clearThread } = useCopilotThread(programId, workspaceId);
  const [input, setInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState("");
  const aiStatus = useAIStatus();
  const aiUnavailable = aiStatus.status === "not-configured" || aiStatus.status === "error" || aiStatus.status === "offline";

  const latestMessages = useMemo(() => messages.slice(-8), [messages]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const submit = async () => {
    if (!input.trim()) return;
    try {
      setError("");
      setPanelOpen(true);
      await sendMessage(input.trim());
      setInput("");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to reach ATOS Copilot.");
      setPanelOpen(true);
    }
  };

  // When AI is unavailable, show a compact disabled bar instead of a broken Copilot
  if (aiUnavailable && aiStatus.status !== "checking") {
    return (
      <div
        className="adam-advisor-bar"
        style={{ opacity: 0.6, pointerEvents: "none", cursor: "not-allowed" }}
        title={
          aiStatus.status === "not-configured"
            ? "Copilot is unavailable — no AI provider configured."
            : "Copilot is temporarily unavailable."
        }
      >
        <div className="adam-advisor-bar-inner">
          <SparklesIcon className="acb-icon" style={{ color: "#6b7280", width: 16, height: 16 } as React.CSSProperties} />
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            {aiStatus.status === "not-configured"
              ? "Copilot unavailable — connect an AI provider in Settings"
              : "Copilot temporarily unavailable"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      {panelOpen ? (
        <div className="adam-advisor-panel">
          <div className="adam-stack p-4">
            <div className="adam-row adam-space-between">
              <div className="adam-title">{identityForWorkspace(workspaceId)}</div>
              <div className="adam-row">
                <button type="button" className="adam-button-ghost" onClick={() => void clearThread()}>
                  Clear
                </button>
                <button type="button" className="adam-button-ghost" onClick={() => setPanelOpen(false)}>
                  Close
                </button>
              </div>
            </div>
            <div className="adam-list adam-scroll" style={{ maxHeight: "48vh" }}>
              {latestMessages.map((message) => (
                <div
                  key={`${message.timestamp}-${message.role}`}
                  className={`adam-list-item ${message.role === "assistant" ? "border-blue-500/20 bg-blue-500/8" : ""}`}
                >
                  <div className="adam-micro adam-muted capitalize">{message.role}</div>
                  <div className="mt-2 adam-body">{message.content}</div>
                </div>
              ))}
              {isLoading ? <div className="adam-list-item adam-body adam-muted">Streaming response...</div> : null}
              {error ? <div className="adam-list-item text-sm text-rose-200">{error}</div> : null}
            </div>
            <div className="adam-row" style={{ flexWrap: "wrap" }}>
              {[
                ["Generate artifact", "Generate the next artifact I need in this workspace."],
                ["Queue decision", "What decision should be queued next for human review?"],
                ["Explain this", "Explain the current program state in plain language."],
                ["What's next?", "What is the single best next action right now?"],
              ].map(([label, prompt]) => (
                <button
                  key={label}
                  type="button"
                  className="adam-chip"
                  onClick={() => {
                    setInput(prompt);
                    void sendMessage(prompt).catch((caughtError) => {
                      setError(caughtError instanceof Error ? caughtError.message : "Unable to reach ATOS Copilot.");
                    });
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="adam-advisor-bar">
        <div className="flex w-full items-center gap-3 px-4">
          <div className="adam-row min-w-[220px]">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5">
              <UserIcon className="h-4 w-4 text-blue-300" />
            </span>
            <div className="adam-stack" style={{ gap: 2 }}>
              <span className="adam-micro adam-muted capitalize">{persona}</span>
              <span className="adam-title">{identityForWorkspace(workspaceId)}</span>
            </div>
          </div>

          <button
            type="button"
            className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left"
            onClick={() => {
              if (nudge?.actionView && onNavigate) onNavigate(nudge.actionView);
              else setPanelOpen(true);
            }}
          >
            <div className="adam-row">
              <SparklesIcon className="h-4 w-4 text-blue-300" />
              <span className="adam-body">
                {nudge?.message || "Ask Copilot anything..."}
              </span>
            </div>
          </button>

          <div className="flex min-w-[320px] items-center gap-2">
            <input
              className="adam-input"
              value={input}
              placeholder="Ask Copilot anything..."
              onChange={(event) => setInput(event.target.value)}
              onFocus={() => setPanelOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <button type="button" className="adam-button" onClick={() => void submit()}>
              Send
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
