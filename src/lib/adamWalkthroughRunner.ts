import { WALKTHROUGH_STEPS, type WalkthroughStep } from "./adamWalkthroughScript.ts";

export type StepStatus = "pending" | "running" | "pass" | "fail" | "skipped";

export interface StepResult {
  step: WalkthroughStep;
  status: StepStatus;
  verifyPassed: boolean;
  durationMs: number;
  error?: string;
}

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function canonicalArtifactType(artifactType = "") {
  if (artifactType === "Stakeholder Attestation") return "stakeholderAttestation";
  return artifactType;
}

export function createInitialWalkthroughProgramState() {
  return {
    id: `walkthrough-${Date.now()}`,
    name: "",
    createdAt: new Date().toISOString(),
    status: "active",
    customContradictionRules: [],
    twinGraph: { nodes: [], edges: [] },
    strategy: { artifacts: [] },
    mobilise: { artifacts: [] },
    discover: { artifacts: [] },
    design: { artifacts: [] },
    build: { artifacts: [], acceptanceCriteria: [], testPlan: {}, deploymentChecklist: {} },
    govern: { artifacts: [] },
    operate: { artifacts: [] },
    optimize: { optimizationLog: [], experimentsRun: 0, performanceBaseline: null },
    valuerealize: { artifacts: [], kpis: [] },
  };
}

function setNestedValue(state: any, path: string, value: any) {
  const nextState = cloneState(state);
  const keys = path.split(".");
  let cursor = nextState;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!cursor[key] || typeof cursor[key] !== "object") {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
  return nextState;
}

function ensureArtifactsBucket(programState: any, phase: string) {
  if (!programState[phase]) {
    programState[phase] = {};
  }
  if (!Array.isArray(programState[phase].artifacts)) {
    programState[phase].artifacts = [];
  }
}

export function executeWalkthroughStep(programState: any, step: WalkthroughStep): { programState: any; result: StepResult } {
  const startedAt = Date.now();
  let nextState = cloneState(programState);
  let status: StepStatus = "pass";
  let verifyPassed = true;
  let error = "";

  try {
    if (step.type === "input" && step.field && step.value !== undefined) {
      if (step.field === "name") {
        nextState.name = step.value;
      } else {
        nextState = setNestedValue(nextState, step.field, step.value);
      }
    }

    if (step.type === "artifact" && step.artifactType) {
      ensureArtifactsBucket(nextState, step.phase);
      nextState[step.phase].artifacts.push({
        id: `art-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: canonicalArtifactType(step.artifactType),
        title: step.artifactType,
        content: step.artifactContent || "",
        status: "approved",
        createdAt: new Date().toISOString(),
        generatedByCopilot: true,
      });
    }

    if (step.verifyFn) {
      verifyPassed = !!step.verifyFn(nextState);
      if (!verifyPassed) {
        status = "fail";
        error = `Verification failed: ${step.expectedOutcome}`;
      }
    }
  } catch (issue) {
    status = "fail";
    verifyPassed = false;
    error = issue instanceof Error ? issue.message : String(issue);
  }

  return {
    programState: nextState,
    result: {
      step,
      status,
      verifyPassed,
      durationMs: Date.now() - startedAt,
      error: error || undefined,
    },
  };
}

export function createPendingWalkthroughResults() {
  return WALKTHROUGH_STEPS.map((step) => ({
    step,
    status: "pending" as StepStatus,
    verifyPassed: false,
    durationMs: 0,
  }));
}

export function buildWalkthroughSummary(results: StepResult[]) {
  const total = results.length;
  const passed = results.filter((result) => result.status === "pass").length;
  const failed = results.filter((result) => result.status === "fail").length;
  const artifacts = results.filter((result) => result.step.type === "artifact" && result.status === "pass").length;
  return {
    total,
    passed,
    failed,
    artifacts,
    verdict: failed === 0 && passed === total ? "FULL WALKTHROUGH PASS" : `WALKTHROUGH BLOCKED — ${failed} step(s) failed`,
  };
}

export function runWalkthrough() {
  let state = createInitialWalkthroughProgramState();
  const results: StepResult[] = [];

  WALKTHROUGH_STEPS.forEach((step) => {
    const executed = executeWalkthroughStep(state, step);
    state = executed.programState;
    results.push(executed.result);
  });

  return {
    programState: state,
    results,
    summary: buildWalkthroughSummary(results),
  };
}
