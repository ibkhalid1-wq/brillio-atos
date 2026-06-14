import { useEffect, useRef } from "react";
import type { AgentRun } from "@/lib/adamSync";

const AGENT_LABELS: Record<string, string> = {
  narrative: "Narrative",
  plan: "Action plan",
  risk: "Risk log",
  milestone: "Milestones",
  budget: "Budget",
  "critical-path": "Critical path",
  "change-impact": "Change impact",
  stakeholder: "Stakeholder map",
  adoption: "Adoption tracker",
  "health-heatmap": "Health heatmap",
  retro: "Retrospective",
  deck: "Status deck",
  "scope-pcr": "Scope & PCR",
  "gate-review": "Gate review",
  escalation: "Escalation",
  closure: "Closure pack",
};

const TRIGGER_REASONS: Partial<Record<string, string>> = {
  "health-heatmap": "following gate review",
  retro: "following gate review completion",
  plan: "following risk update",
  risk: "following plan update",
};

export function useAgentCascadeToasts(activeRuns: AgentRun[]) {
  const prevRunIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const currentIds = new Set(activeRuns.map((run) => run.id));

    activeRuns.forEach((run) => {
      if (!prevRunIds.current.has(run.id) && run.status === "running" && run.triggered_by === "trigger") {
        const label = AGENT_LABELS[run.agent_id] || run.agent_id;
        const reason = TRIGGER_REASONS[run.agent_id];
        window.dispatchEvent(new CustomEvent("atlas-v3-toast", {
          detail: {
            message: `ADAM is updating ${label}${reason ? ` ${reason}` : ""}`,
            icon: "◎",
          },
        }));
      }
    });

    prevRunIds.current = currentIds;
  }, [activeRuns]);
}
