import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import type { V3CommandMode } from "@/v3/types";
import { phaseNameById } from "@/v3/utils";

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  program: ProgramSummary | null | undefined;
  activeMode: V3CommandMode;
  activePhaseId: string | null;
  onModeChange: (mode: V3CommandMode) => void;
  onRunAgent: (agentId: string) => void;
  onSelectPhase: (phaseId: string) => void;
  onQuery?: (query: string) => Promise<string> | string;
};

type PaletteItem = {
  id: string;
  section: string;
  title: string;
  subtitle?: string;
  keywords: string;
  action: () => void;
};

function simulateQuery(q: string): string {
  const lower = q.toLowerCase();
  if (lower.includes("risk")) return "Based on the programme data, there are 3 open risks. The highest priority is related to resource availability in the Build phase. Consider running the Risk agent for a full assessment.";
  if (lower.includes("track") || lower.includes("status")) return "The programme confidence score is 72%. Strategy and Mobilise phases are complete. The Discover phase is at 65% — approaching the gate. 4 decisions are pending.";
  if (lower.includes("gate") || lower.includes("ready")) return "The current gate readiness is 68% — below the 70% threshold. Key blockers: missing architecture sign-off and 2 unresolved critical decisions.";
  if (lower.includes("decision")) return "4 decisions are open. 1 critical: 'Platform architecture selection' — raised 8 days ago. 3 high priority decisions relate to resourcing and vendor selection.";
  return "I can help you understand programme status, risks, decisions, and gate readiness. Try asking about a specific aspect of your programme.";
}

const AGENT_COMMANDS: Array<{ id: string; label: string; description: string }> = [
  { id: "gate-review", label: "Run Gate Check", description: "AI readiness assessment for current phase" },
  { id: "gate-readiness-coach", label: "Get Readiness Advice", description: "Recommended actions to improve gate score" },
  { id: "narrative", label: "Generate Summary", description: "Refresh the stakeholder programme summary" },
  { id: "risk", label: "Analyse Risks", description: "Identify risks and mitigation options" },
  { id: "milestone", label: "Update Milestones", description: "Generate or refresh milestone tracker" },
  { id: "health-heatmap", label: "Run Health Check", description: "Recalculate programme health scores" },
  { id: "change-impact", label: "Run Change Impact", description: "Assess organisational change impact" },
  { id: "deck", label: "Build Exec Deck", description: "Generate executive presentation slides" },
  { id: "closure", label: "Prepare Closure", description: "Generate programme closure summary" },
];

const PHASE_AGENTS: Record<string, string[]> = {
  strategy: ["narrative", "gate-review", "gate-readiness-coach"],
  mobilise: ["gate-review", "risk", "narrative"],
  discover: ["narrative", "gate-review", "risk"],
  design: ["narrative", "gate-review", "change-impact"],
  build: ["milestone", "gate-review", "risk"],
  operate: ["health-heatmap", "gate-review", "narrative"],
  govern: ["gate-review", "narrative", "risk"],
  optimize: ["narrative", "gate-review", "milestone"],
  valuerealize: ["narrative", "gate-review", "closure"],
};

const NAV_ITEMS: Array<{ mode: V3CommandMode; title: string; subtitle: string }> = [
  { mode: "delivery", title: "Go to Deliver", subtitle: "Phase work, pipeline and actions" },
  { mode: "governance", title: "Go to Gates", subtitle: "Gate approvals and decisions" },
  { mode: "oversight", title: "Go to Monitor", subtitle: "Programme health and KPIs" },
  { mode: "portfolio", title: "Go to Portfolio", subtitle: "All programmes" },
];

export function CommandPalette({
  open,
  onClose,
  program,
  activeMode,
  activePhaseId,
  onModeChange,
  onRunAgent,
  onSelectPhase,
  onQuery,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [conversationalMode, setConversationalMode] = useState(false);
  const [queryResult, setQueryResult] = useState<string | null>(null);
  const [queryPending, setQueryPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<PaletteItem[]>(() => {
    const nextItems: PaletteItem[] = [];
    const needle = query.trim().toLowerCase();

    // When query is empty, use context-first ordering
    if (!needle) {
      // 1. Suggested — phase-specific agents
      if (activePhaseId && PHASE_AGENTS[activePhaseId]) {
        const suggestedIds = PHASE_AGENTS[activePhaseId];
        const phaseName = phaseNameById(program, activePhaseId);
        const sectionLabel = `Suggested for ${phaseName}`;
        suggestedIds.forEach((agentId) => {
          const agent = AGENT_COMMANDS.find((a) => a.id === agentId);
          if (!agent) return;
          nextItems.push({
            id: `suggested-${agent.id}`,
            section: sectionLabel,
            title: agent.label,
            subtitle: agent.description,
            keywords: `${agent.label} ${agent.description} ${agent.id}`,
            action: () => {
              onRunAgent(agent.id);
              onClose();
            },
          });
        });
      }

      // 2. Navigate
      NAV_ITEMS.forEach((item) => {
        nextItems.push({
          id: `nav-${item.mode}`,
          section: "Navigate",
          title: item.title,
          subtitle: item.subtitle,
          keywords: `${item.title} ${item.subtitle} ${item.mode}`,
          action: () => {
            onModeChange(item.mode);
            onClose();
          },
        });
      });

      // 3. Jump To Phase
      (program?.phases || []).forEach((phase) => {
        const label = phaseNameById(program, phase.id);
        nextItems.push({
          id: `phase-${phase.id}`,
          section: "Jump To Phase",
          title: label,
          subtitle: phase.id === activePhaseId ? "Current active phase" : "Open this phase in Delivery",
          keywords: `${label} ${phase.id} phase`,
          action: () => {
            onSelectPhase(phase.id);
            onClose();
          },
        });
      });

      // 4. Run Agent — all agents (secondary, below fold)
      AGENT_COMMANDS.forEach((agent) => {
        nextItems.push({
          id: `agent-${agent.id}`,
          section: `Run Agent${activePhaseId ? ` (${phaseNameById(program || undefined, activePhaseId)})` : ""}`,
          title: agent.label,
          subtitle: agent.description,
          keywords: `${agent.label} ${agent.description} ${agent.id}`,
          action: () => {
            onRunAgent(agent.id);
            onClose();
          },
        });
      });

      // 5. Decisions
      (program?.decisionQueue || []).slice(0, 12).forEach((decision) => {
        const title = decision.title || decision.question || "Untitled decision";
        nextItems.push({
          id: `decision-${decision.id}`,
          section: "Decisions",
          title,
          subtitle: `${decision.phaseId || "programme"} · ${decision.status}`,
          keywords: `${title} ${decision.status} ${decision.phaseId || ""} decision`,
          action: () => {
            onModeChange("governance");
            onClose();
          },
        });
      });

      return nextItems;
    }

    // When there's a query, search across all items (flat, original order)
    NAV_ITEMS.forEach((item) => {
      nextItems.push({
        id: `nav-${item.mode}`,
        section: "Navigate",
        title: item.title,
        subtitle: item.subtitle,
        keywords: `${item.title} ${item.subtitle} ${item.mode}`,
        action: () => {
          onModeChange(item.mode);
          onClose();
        },
      });
    });

    (program?.phases || []).forEach((phase) => {
      const label = phaseNameById(program, phase.id);
      nextItems.push({
        id: `phase-${phase.id}`,
        section: "Jump To Phase",
        title: label,
        subtitle: phase.id === activePhaseId ? "Current active phase" : "Open this phase in Delivery",
        keywords: `${label} ${phase.id} phase`,
        action: () => {
          onSelectPhase(phase.id);
          onClose();
        },
      });
    });

    AGENT_COMMANDS.forEach((agent) => {
      nextItems.push({
        id: `agent-${agent.id}`,
        section: `Run Agent${activePhaseId ? ` (${phaseNameById(program || undefined, activePhaseId)})` : ""}`,
        title: agent.label,
        subtitle: agent.description,
        keywords: `${agent.label} ${agent.description} ${agent.id}`,
        action: () => {
          onRunAgent(agent.id);
          onClose();
        },
      });
    });

    (program?.decisionQueue || []).slice(0, 12).forEach((decision) => {
      const title = decision.title || decision.question || "Untitled decision";
      nextItems.push({
        id: `decision-${decision.id}`,
        section: "Decisions",
        title,
        subtitle: `${decision.phaseId || "programme"} · ${decision.status}`,
        keywords: `${title} ${decision.status} ${decision.phaseId || ""} decision`,
        action: () => {
          onModeChange("governance");
          onClose();
        },
      });
    });

    return nextItems;
  }, [activePhaseId, onClose, onModeChange, onRunAgent, onSelectPhase, program, query]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => item.keywords.toLowerCase().includes(needle));
  }, [items, query]);

  const groupedItems = useMemo(() => {
    const groups: Array<{ section: string; items: PaletteItem[] }> = [];
    filteredItems.forEach((item) => {
      const last = groups[groups.length - 1];
      if (last && last.section === item.section) {
        last.items.push(item);
      } else {
        groups.push({ section: item.section, items: [item] });
      }
    });
    return groups;
  }, [filteredItems]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    setConversationalMode(false);
    setQueryResult(null);
    setQueryPending(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (selectedIndex < filteredItems.length) return;
    setSelectedIndex(0);
  }, [filteredItems.length, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (conversationalMode) {
          setConversationalMode(false);
          setQueryResult(null);
          setQuery("");
        } else {
          onClose();
        }
        return;
      }
      if (conversationalMode) {
        if (event.key === "Enter") {
          const q = query.trim();
          if (!q) return;
          event.preventDefault();
          setQueryPending(true);
          setQueryResult(null);
          const result = onQuery ? onQuery(q) : simulateQuery(q);
          if (typeof result === "string") {
            setQueryResult(result);
            setQueryPending(false);
          } else {
            result.then((res) => {
              setQueryResult(res);
              setQueryPending(false);
            }).catch(() => {
              setQueryResult("An error occurred while processing your query.");
              setQueryPending(false);
            });
          }
        }
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((current) => (filteredItems.length ? (current + 1) % filteredItems.length : 0));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((current) => (filteredItems.length ? (current - 1 + filteredItems.length) % filteredItems.length : 0));
        return;
      }
      if (event.key === "Enter") {
        const selected = filteredItems[selectedIndex];
        if (!selected) return;
        event.preventDefault();
        selected.action();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [conversationalMode, filteredItems, onClose, onQuery, open, query, selectedIndex]);

  if (!open) return null;

  let runningIndex = -1;

  return (
    <>
      <div className="v3-sheet-overlay" onClick={onClose} />
      <div
        className="v3-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="v3-command-palette-header">
          <div>
            <div className="v3-sheet-title">Command palette</div>
            <div className="v3-command-palette-caption">
              Jump to a view, run an AI agent, or navigate to a phase
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className={`v3-button${conversationalMode ? " primary" : " ghost"}`}
              style={{ fontSize: 12, padding: "4px 10px", height: "auto" }}
              onClick={() => {
                setConversationalMode(true);
                setQueryResult(null);
                setQuery("");
                window.setTimeout(() => inputRef.current?.focus(), 0);
              }}
              aria-pressed={conversationalMode}
            >
              Copilot ✦
            </button>
            <button className="v3-sheet-close" onClick={onClose} aria-label="Close command palette">×</button>
          </div>
        </div>

        <div className="v3-command-palette-body">
          <div style={{ position: "relative" }}>
            <input
              ref={inputRef}
              type="search"
              className="v3-input v3-command-palette-input"
              aria-label={conversationalMode ? "Ask Copilot a question" : "Search commands"}
              placeholder={conversationalMode
                ? "Ask Copilot anything… e.g. 'What are the top risks?' or 'Is the programme on track?'"
                : "Jump to phase, run agent, navigate…"}
              value={query}
              style={conversationalMode ? { borderColor: "var(--v3-accent-glow)", paddingRight: 48 } : undefined}
              onChange={(event) => {
                const val = event.target.value;
                if (!conversationalMode && val.startsWith("?")) {
                  setConversationalMode(true);
                  setQuery(val.slice(1));
                } else {
                  setQuery(val);
                }
              }}
            />
            {conversationalMode && (
              <span style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.05em",
                color: "var(--v3-accent)",
                background: "var(--v3-accent-soft)",
                border: "1px solid var(--v3-accent-glow)",
                borderRadius: 4,
                padding: "1px 5px",
                pointerEvents: "none",
              }}>AI</span>
            )}
          </div>

          {conversationalMode && (
            <div style={{ padding: "4px 0 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
                Press Enter to ask · Esc to cancel
              </span>
              <button
                type="button"
                className="v3-button ghost"
                style={{ fontSize: 11, padding: "2px 8px", height: "auto" }}
                onClick={() => {
                  setConversationalMode(false);
                  setQueryResult(null);
                  setQuery("");
                  window.setTimeout(() => inputRef.current?.focus(), 0);
                }}
              >
                Clear
              </button>
            </div>
          )}

          {conversationalMode && queryPending && (
            <div style={{
              background: "var(--v3-accent-soft)",
              border: "1px solid var(--v3-accent-glow)",
              borderRadius: "var(--v3-radius)",
              padding: "12px 14px",
              fontSize: 13,
              color: "var(--v3-text-muted)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}>
              <span style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--v3-accent)",
                animation: "v3-pulse 1s ease-in-out infinite",
              }} />
              ADAM is thinking…
            </div>
          )}

          {conversationalMode && queryResult && !queryPending && (
            <div style={{
              background: "var(--v3-accent-soft)",
              border: "1px solid var(--v3-accent-glow)",
              borderRadius: "var(--v3-radius)",
              padding: "12px 14px",
              fontSize: 13,
              color: "var(--v3-text-primary)",
              marginBottom: 8,
            }}>
              {queryResult}
            </div>
          )}

          {!conversationalMode && (
          <div className="v3-command-palette-list" role="listbox" aria-label="Available commands">
            {groupedItems.length === 0 ? (
              <div className="v3-command-palette-empty">No results for "{query}".</div>
            ) : (
              groupedItems.map((group) => (
                <div key={group.section} className="v3-command-palette-group">
                  <div className="v3-command-palette-group-title">{group.section}</div>
                  <div className="v3-command-palette-group-items">
                    {group.items.map((item) => {
                      runningIndex += 1;
                      const active = runningIndex === selectedIndex;
                      const isCurrentMode = item.id === `nav-${activeMode}`;
                      const isCurrentPhase = activePhaseId && item.id === `phase-${activePhaseId}`;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`v3-command-palette-item ${active ? "active" : ""}`}
                          onMouseEnter={() => setSelectedIndex(runningIndex)}
                          onClick={item.action}
                          role="option"
                          aria-selected={active}
                        >
                          <div className="v3-command-palette-item-main">
                            <div className="v3-command-palette-item-title">{item.title}</div>
                            {item.subtitle ? (
                              <div className="v3-command-palette-item-subtitle">{item.subtitle}</div>
                            ) : null}
                          </div>
                          {isCurrentMode || isCurrentPhase ? (
                            <span className="v3-command-palette-chip">current</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
          )}

          <div style={{ padding: "8px 16px", borderTop: "1px solid var(--v3-border)", fontSize: 11, color: "var(--v3-text-muted)", display: "flex", gap: 16 }}>
            {conversationalMode ? (
              <>
                <span><kbd style={{ background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderRadius: 3, padding: "1px 5px", fontSize: 10 }}>↵</kbd> ask</span>
                <span><kbd style={{ background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderRadius: 3, padding: "1px 5px", fontSize: 10 }}>Esc</kbd> cancel</span>
              </>
            ) : (
              <>
                <span><kbd style={{ background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderRadius: 3, padding: "1px 5px", fontSize: 10 }}>↑↓</kbd> navigate</span>
                <span><kbd style={{ background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderRadius: 3, padding: "1px 5px", fontSize: 10 }}>↵</kbd> select</span>
                <span><kbd style={{ background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderRadius: 3, padding: "1px 5px", fontSize: 10 }}>Esc</kbd> close</span>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
