export type AtosPhase =
  | "strategy"
  | "mobilise"
  | "architecture"
  | "build"
  | "operate"
  | "govern"
  | "optimize"
  | "value";

export const PHASE_LABELS: Record<AtosPhase, string> = {
  strategy: "Strategy",
  mobilise: "Mobilise",
  architecture: "Architecture",
  build: "Build",
  operate: "Operate",
  govern: "Govern",
  optimize: "Optimize",
  value: "Value Realize",
};

const PHASE_KEYWORDS: Record<AtosPhase, string[]> = {
  strategy: [
    "strategy", "objective", "vision", "goal", "business case", "roadmap",
    "transformation", "initiative", "north star", "okr", "kpi target",
    "executive summary", "board", "investment", "priorit",
  ],
  mobilise: [
    "team", "role", "raci", "responsibility", "mobilise", "mobilization",
    "onboard", "resourcing", "staffing", "org chart", "swimlane",
    "project manager", "workstream", "kickoff", "sprint plan",
  ],
  architecture: [
    "architecture", "design", "integration", "api", "data model", "technical",
    "infrastructure", "system", "wireframe", "prototype", "figma",
    "component", "service", "microservice", "diagram", "flow",
  ],
  build: [
    "build", "develop", "test", "sprint", "user story", "acceptance criteria",
    "qa", "release", "bug", "defect", "code review", "deployment",
    "ci/cd", "pipeline", "regression", "uat",
  ],
  operate: [
    "operate", "runbook", "support", "incident", "sla", "escalation",
    "handover", "go live", "hypercare", "operations", "monitoring",
    "alert", "on-call", "ticket", "service desk",
  ],
  govern: [
    "risk", "compliance", "audit", "governance", "control", "policy",
    "regulation", "hitl", "gdpr", "iso", "sox", "security", "privacy",
    "data protection", "legal", "approval", "gate",
  ],
  optimize: [
    "optimize", "improvement", "lesson", "retrospective", "kpi", "performance",
    "benchmark", "continuous", "efficiency", "velocity", "throughput",
    "capacity", "feedback", "iteration", "enhancement",
  ],
  value: [
    "value", "roi", "benefit", "saving", "metric", "outcome", "realisation",
    "realization", "business value", "impact", "cost reduction",
    "revenue", "payback", "npv", "irr", "business case actual",
  ],
};

export function inferPhaseFromDocument(text: string, fileName: string): AtosPhase {
  const combined = `${text.slice(0, 3000)} ${fileName}`.toLowerCase();
  const scores = {} as Record<AtosPhase, number>;

  (Object.entries(PHASE_KEYWORDS) as Array<[AtosPhase, string[]]>).forEach(([phase, keywords]) => {
    scores[phase] = keywords.filter((keyword) => combined.includes(keyword)).length;
  });

  const [bestPhase, bestScore] = (Object.entries(scores) as Array<[AtosPhase, number]>)
    .sort((left, right) => right[1] - left[1])[0];

  return bestScore > 0 ? bestPhase : "strategy";
}
