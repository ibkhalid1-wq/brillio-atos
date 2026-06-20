export type ConfidenceLevel = "high" | "medium" | "low";

export interface AgentConfidence {
  level: ConfidenceLevel;
  score: number;
  signals: string[];
  inputCompleteness: number;
}

export function evaluateAgentConfidence(inputs: {
  agentId: string;
  inputCompleteness: number;
  outputLength: number;
  hadFallback: boolean;
  missingFieldCount: number;
  phaseProgress: number;
}): AgentConfidence {
  let score = 1.0;
  const signals: string[] = [];

  if (inputs.inputCompleteness < 50) { score -= 0.3; signals.push("Inputs were incomplete"); }
  else if (inputs.inputCompleteness < 75) { score -= 0.15; signals.push("Inputs were incomplete"); }
  if (inputs.hadFallback) { score -= 0.2; signals.push("LLM used fallback generation"); }
  if (inputs.missingFieldCount > 0) {
    const deduction = Math.min(0.4, inputs.missingFieldCount * 0.1);
    score -= deduction;
    signals.push(`${inputs.missingFieldCount} required field${inputs.missingFieldCount > 1 ? "s" : ""} missing`);
  }
  if (inputs.outputLength < 200) { score -= 0.1; signals.push("Output appears truncated"); }
  if (inputs.phaseProgress > 70) signals.push("High phase completion — good data foundation");

  score = Math.max(0, Math.min(1, score));
  const level: ConfidenceLevel = score >= 0.75 ? "high" : score >= 0.45 ? "medium" : "low";

  return { level, score, signals, inputCompleteness: inputs.inputCompleteness };
}

export function confidenceLevelColor(level: ConfidenceLevel): string {
  return level === "high" ? "var(--v3-green)" : level === "medium" ? "var(--v3-amber)" : "var(--v3-red)";
}
