import type { DecisionSummary, ProgramSummary, PhaseSummary } from "@/new/types";
import { formatRelative } from "@/lib/formatTime";

export type V3ToastTone = "info" | "success" | "warning" | "error";

const PHASE_LABELS: Record<string, string> = {
  strategy: "Strategy",
  mobilise: "Mobilise",
  discover: "Discover",
  design: "Design",
  agent_arch: "Architecture",
  build: "Build",
  operate: "Operate",
  govern: "Govern",
  optimize: "Optimize",
  valuerealize: "Value Realize",
  delivery: "Delivery",
  adoption: "Drive Adoption",
  titan: "Scenario Planning",
};

export function phaseName(phase: Pick<PhaseSummary, "id" | "displayName">): string {
  return PHASE_LABELS[phase.id] || phase.displayName || phase.id;
}

export function phaseNameById(program: ProgramSummary | null, phaseId: string): string {
  if (!program) return PHASE_LABELS[phaseId] || phaseId;
  const phase = program.phases.find((entry) => entry.id === phaseId);
  if (!phase) return PHASE_LABELS[phaseId] || phaseId;
  return phaseName(phase);
}

export function phaseTone(pct: number): "green" | "amber" | "red" | "gray" {
  if (pct >= 75) return "green";
  if (pct >= 45) return "amber";
  if (pct > 0) return "red";
  return "gray";
}

export function timeAgo(iso: string | null | undefined): string {
  return formatRelative(iso) || "just now";
}

export function isDecisionOpen(decision: DecisionSummary): boolean {
  return !decision.status || decision.status === "open";
}

export function confidenceTone(value: number | null | undefined): "green" | "amber" | "red" | "muted" {
  if (value === null || value === undefined) return "muted";
  if (value >= 0.8) return "green";
  if (value >= 0.6) return "amber";
  return "red";
}

export function confidenceLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Confidence unknown";
  return `${Math.round(value * 100)}% confidence`;
}

export function pushV3Toast(
  message: string,
  options: { tone?: V3ToastTone; icon?: string; duration?: number; action?: { label: string; onClick: () => void } } = {},
): void {
  if (typeof window === "undefined" || !message) return;
  window.dispatchEvent(new CustomEvent("atlas-v3-toast", {
    detail: {
      message,
      tone: options.tone || "info",
      icon: options.icon,
      duration: options.duration,
      action: options.action,
    },
  }));
}
