import { useMemo } from "react";
import { predictGateFailure, type PredictedRisk } from "@/lib/adamGateRisk";

const PHASES = ["strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize"];

export function useGateRiskMonitor(projectData: any): PredictedRisk[] {
  return useMemo(() => {
    if (!projectData) return [];
    return PHASES
      .map((phaseId) => predictGateFailure(phaseId, projectData))
      .filter((risk) => risk.level !== "low")
      .sort((left, right) => right.riskScore - left.riskScore);
  }, [
    projectData?.id,
    ...PHASES.map((phaseId) => Object.keys(projectData?.phaseArtifacts?.[phaseId] ?? {}).length),
    projectData?.phaseGuidance,
  ]);
}

export type { PredictedRisk } from "@/lib/adamGateRisk";
