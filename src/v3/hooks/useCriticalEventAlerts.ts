import { useEffect, useRef } from "react";
import type { ProgramSummary } from "@/new/types";
import { pushV3Toast } from "@/v3/utils";

export function useCriticalEventAlerts(program: ProgramSummary | null) {
  const prevSnapshot = useRef<{
    escalationCount: number;
    atRiskPhases: Set<string>;
    remediationGates: Set<string>;
  }>({ escalationCount: 0, atRiskPhases: new Set(), remediationGates: new Set() });

  useEffect(() => {
    if (!program) return;

    const openEscalations = (program.escalations || []).filter((entry) => entry.status === "open");
    const atRiskPhases = new Set(
      program.phases.filter((phase) => phase.status === "at-risk" || phase.status === "blocked").map((phase) => phase.id),
    );
    const remediationGates = new Set(
      Object.entries(program.gateReviews || {})
        .filter(([, review]) => review?.status === "remediation-requested")
        .map(([id]) => id),
    );

    const previous = prevSnapshot.current;

    if (openEscalations.length > previous.escalationCount && previous.escalationCount > 0) {
      pushV3Toast(openEscalations[0]?.title || "New escalation raised", { tone: "warning", icon: "⚠", duration: 6000 });
    }

    atRiskPhases.forEach((id) => {
      if (!previous.atRiskPhases.has(id)) {
        const phase = program.phases.find((entry) => entry.id === id);
        pushV3Toast(`${phase?.displayName || id} is now at risk`, { tone: "warning", icon: "◎", duration: 5000 });
      }
    });

    remediationGates.forEach((id) => {
      if (!previous.remediationGates.has(id)) {
        const phase = program.phases.find((entry) => entry.id === id);
        pushV3Toast(`Gate review: remediation required for ${phase?.displayName || id}`, { tone: "error", duration: 6000 });
      }
    });

    prevSnapshot.current = { escalationCount: openEscalations.length, atRiskPhases, remediationGates };
  }, [program]);
}
