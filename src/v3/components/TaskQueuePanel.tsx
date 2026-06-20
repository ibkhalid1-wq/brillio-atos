import React, { useState } from "react";
import type { PhaseAgentTask } from "@/lib/adamPhaseAgentTypes";

interface TaskQueuePanelProps {
  tasks: PhaseAgentTask[];
  phaseId: string;
  onAnswerQuestion: (taskId: string, answer: string) => Promise<void>;
  onAcknowledgeTask: (taskId: string) => void;
  onRunAgent: (agentId: string) => void;
}

const TASK_TYPE_LABELS: Record<string, string> = {
  draft_artifact: "Draft artifact",
  populate_fields: "Fill in fields",
  ask_question: "Answer question",
  gate_assessment: "Gate check",
  generate_handoff: "Generate handoff",
  revise_artifact: "Revise artifact",
  escalate: "Escalation",
  proactive_nudge: "Suggestion",
  generate_briefing: "Generate briefing",
  predict_downstream_risk: "Risk prediction",
};

function priorityTone(priority: string | undefined): "red" | "amber" | "muted" {
  if (priority === "critical") return "red";
  if (priority === "high") return "amber";
  return "muted";
}

export default function TaskQueuePanel({ tasks, phaseId, onAnswerQuestion, onAcknowledgeTask, onRunAgent }: TaskQueuePanelProps) {
  const [answerMap, setAnswerMap] = useState<Record<string, string>>({});
  const [answerOpenMap, setAnswerOpenMap] = useState<Record<string, boolean>>({});
  const [savingMap, setSavingMap] = useState<Record<string, boolean>>({});
  const pending = tasks.filter((task) => task.status === "pending" || task.status === "running");

  if (!pending.length) {
    return (
      <div className="v3-card-sm">
        <div className="v3-card-title">Task queue</div>
        <div style={{ fontSize: 12, color: "var(--v3-text-muted)" }}>No pending tasks for this phase.</div>
      </div>
    );
  }

  return (
    <div className="v3-card-sm">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div className="v3-card-title" style={{ margin: 0 }}>Task queue</div>
        <span className="v3-chip muted">{pending.length} pending</span>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {pending.slice(0, 5).map((task) => (
          <div key={task.id} className="v3-task-card" data-phase={phaseId}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", justifyContent: "space-between" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                  <span className={`v3-chip ${priorityTone(task.priority)}`} style={{ fontSize: 11 }}>
                    {task.priority ?? "medium"}
                  </span>
                  <span className="v3-chip muted" style={{ fontSize: 11 }}>
                    {TASK_TYPE_LABELS[task.type] ?? task.type}
                  </span>
                  {task.status === "running" ? (
                    <span className="v3-chip blue" style={{ fontSize: 11 }}>Running…</span>
                  ) : null}
                </div>
                <div style={{ fontSize: 13, color: "var(--v3-text-primary)", lineHeight: 1.5 }}>
                  {task.description}
                </div>
                {task.reason ? (
                  <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 3 }}>{task.reason}</div>
                ) : null}
              </div>
            </div>

            {task.type === "ask_question" && task.status === "pending" ? (
              <div style={{ marginTop: 8 }}>
                {!answerOpenMap[task.id] ? (
                  <button
                    type="button"
                    className="v3-button primary"
                    style={{ fontSize: 11, padding: "4px 10px" }}
                    onClick={() => setAnswerOpenMap((current) => ({ ...current, [task.id]: true }))}
                  >
                    Answer →
                  </button>
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
                    <textarea
                      className="v3-input v3-textarea"
                      rows={2}
                      placeholder="Your answer…"
                      value={answerMap[task.id] ?? ""}
                      onChange={(event) => setAnswerMap((current) => ({ ...current, [task.id]: event.target.value }))}
                      autoFocus
                    />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="v3-button ghost"
                        style={{ fontSize: 11 }}
                        onClick={() => setAnswerOpenMap((current) => ({ ...current, [task.id]: false }))}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="v3-button primary"
                        style={{ fontSize: 11 }}
                        disabled={!answerMap[task.id]?.trim() || savingMap[task.id]}
                        onClick={async () => {
                          setSavingMap((current) => ({ ...current, [task.id]: true }));
                          try {
                            await onAnswerQuestion(task.id, answerMap[task.id]);
                            setAnswerOpenMap((current) => ({ ...current, [task.id]: false }));
                          } finally {
                            setSavingMap((current) => ({ ...current, [task.id]: false }));
                          }
                        }}
                      >
                        {savingMap[task.id] ? "Saving…" : "Submit answer"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {(task.type === "draft_artifact" || task.type === "generate_handoff") && task.status === "pending" ? (
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="v3-button ghost"
                  style={{ fontSize: 11, padding: "4px 10px" }}
                  onClick={() => onRunAgent(
                    task.type === "generate_handoff" ? "handoff"
                      : "narrative",
                  )}
                >
                  Run agent →
                </button>
              </div>
            ) : null}

            {task.type === "proactive_nudge" ? (
              <button
                type="button"
                className="v3-button ghost"
                style={{ fontSize: 11, marginTop: 6 }}
                onClick={() => onAcknowledgeTask(task.id)}
              >
                Got it
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
