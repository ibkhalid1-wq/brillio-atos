export type RiskLevel = "critical" | "high" | "medium" | "low";

export type RiskReason = {
  severity: "critical" | "high" | "medium";
  msg: string;
};

export type PredictedRisk = {
  phaseId: string;
  level: RiskLevel;
  riskScore: number;
  reasons: RiskReason[];
  readiness: number;
  confidence: number;
  blockerCount: number;
  exitsPassing: boolean;
  contradictionCount: number;
  projectedWeeksToGate: number;
  snapshot: { ts: number; readiness: number; blockerCount: number };
};

export type RiskTrend = "improving" | "worsening" | "stable";

export function recordGateRiskSnapshot(phaseId: string, risk: PredictedRisk, programId: string): void {
  if (typeof window === "undefined" || !programId) return;
  const key = `gate_risk_${programId}`;
  let parsed: any = {};
  try {
    parsed = JSON.parse(window.localStorage.getItem(key) || "{}");
  } catch {
    parsed = {};
  }
  const history = parsed?.history ?? {};
  const nextHistory = Array.isArray(history?.[phaseId]) ? history[phaseId] : [];
  const payload = {
    ...(parsed ?? {}),
    history: {
      ...history,
      [phaseId]: [...nextHistory, risk.snapshot].slice(-30),
    },
  };
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch { /* best effort */ }
}

export function getRiskTrend(phaseId: string, programId: string): RiskTrend {
  if (typeof window === "undefined" || !programId) return "stable";
  const key = `gate_risk_${programId}`;
  let parsed: any = {};
  try {
    parsed = JSON.parse(window.localStorage.getItem(key) || "{}");
  } catch {
    parsed = {};
  }
  const history = Array.isArray(parsed?.history?.[phaseId]) ? parsed.history[phaseId] : [];
  if (history.length < 2) return "stable";
  const previousReadiness = Number(history[history.length - 2]?.readiness ?? 0);
  const currentReadiness = Number(history[history.length - 1]?.readiness ?? 0);
  const delta = currentReadiness - previousReadiness;
  if (delta >= 3) return "improving";
  if (delta <= -3) return "worsening";
  return "stable";
}
