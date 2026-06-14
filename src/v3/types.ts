import type { AppView } from "@/new/types";

export type V3Surface = "stage" | "pipeline" | "decide" | "program" | "portfolio" | "cockpit" | "governance-v2" | "oversight-v2" | "insight-feed" | "executive" | "programme-health";
export type V3Mode = "guided" | "power";
export type V3CommandMode = "delivery" | "governance" | "oversight" | "portfolio";

export type V3ReportId = "narrative" | "deck" | "status" | "closure";

export type V3MoreView =
  | "documents"
  | "narrative"
  | "plan"
  | "milestones"
  | "risks"
  | "budget"
  | "critical-path"
  | "change-impact"
  | "stakeholders"
  | "adoption"
  | "health"
  | "retro"
  | "scope-pcr"
  | "intelligence"
  | "twin"
  | "accelerators"
  | "schedules"
  | "benchmark"
  | "decision-audit"
  | "pattern-library"
  | "agent-activity"
  | "artifact-history"
  | "closure";

export interface V3Nudge {
  id: string;
  message: string;
  actionLabel?: string;
  actionView?: AppView;
}

export type ProgramArchetype = "technology-implementation" | "business-transformation" | "regulatory-programme" | "agile-delivery";

export interface ArchetypeDefinition {
  id: ProgramArchetype;
  label: string;
  description: string;
  icon: string;
  methodologyVariant: "atos-standard" | "atos-lite" | "atos-regulated";
  typicalDurationMonths: { min: number; max: number };
  defaultKPIs: string[];
}
