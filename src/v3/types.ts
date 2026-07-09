import type { AppView } from "@/new/types";

// Legacy surfaces `cockpit` / `governance-v2` / `oversight-v2` were retired in
// Cycle 7. Their old deep-link paths still redirect to live surfaces in
// `pathToState` (AppShellV3) for backward compatibility, but they are no longer
// renderable surface values.
export type V3Surface = "stage" | "pipeline" | "decide" | "program" | "portfolio" | "insight-feed" | "executive" | "programme-health";
export type V3Mode = "guided" | "power";
export type V3CommandMode = "delivery" | "governance" | "oversight" | "portfolio";

export type V3ReportId = "narrative" | "deck" | "status" | "closure";

export type V3MoreView =
  | "documents"
  | "narrative"
  | "roadmap"
  | "plan"
  | "milestones"
  | "risks"
  | "budget"
  | "twin"
  | "change-impact"
  | "stakeholders"
  | "roster"
  | "health"
  | "scope-pcr"
  | "intelligence"
  | "artifact-map"
  | "program-graph"
  | "layers"
  | "accelerators"
  | "decision-audit"
  | "ontology"
  | "access"
  | "closure";

export type ProgramArchetype = "technology-implementation" | "business-transformation" | "regulatory-programme" | "agile-delivery" | "agentic-system";

export interface ArchetypeDefinition {
  id: ProgramArchetype;
  label: string;
  description: string;
  icon: string;
  methodologyVariant: "atos-standard" | "atos-lite" | "atos-regulated" | "atos-flow";
  typicalDurationMonths: { min: number; max: number };
  defaultKPIs: string[];
}
