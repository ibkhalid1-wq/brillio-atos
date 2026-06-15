/**
 * Integration status:
 * - This file exposes methodology/runtime hooks for a fuller ATOS rules engine.
 * - V3 currently consumes the stable phase sequence constants from here, while gate readiness and exit guidance are driven by normalized program data and agent output.
 * - Additional runtime-backed methodology enforcement should only be enabled once a concrete methodology runtime is registered in the shell.
 */
type RuntimeMap = Record<string, (...args: any[]) => any>;

let runtime: RuntimeMap = {};

export const ADAM_PHASE_SEQUENCE = [
  "strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize",
];

export const TWIN_NODE_TYPES = [
  "Strategy", "Outcome", "KPI", "Capability", "Decision", "Role", "Agent",
  "Skill", "Data", "Risk", "Governance", "Value", "Learning",
];

export const TWIN_EDGE_TYPES = [
  "achieves", "enables", "governs", "implements", "requires",
  "measures", "depends_on", "produces", "consumed_by", "risks", "mitigates",
];

export function registerAdamMethodologyRuntime(nextRuntime: RuntimeMap) {
  runtime = { ...runtime, ...(nextRuntime || {}) };
}

function invoke(name: string, args: any[]) {
  const fn = runtime[name];
  if (typeof fn !== "function") {
    throw new Error(`ATOS methodology runtime not registered for ${name}`);
  }
  return fn(...args);
}

export const evaluateExitCriteria = (...args: any[]) => invoke("evaluateExitCriteria", args);
export const getPhaseEntryGuard = (...args: any[]) => invoke("getPhaseEntryGuard", args);
export const buildStageGate = (...args: any[]) => invoke("buildStageGate", args);
export const buildStageGateMemo = (...args: any[]) => invoke("buildStageGateMemo", args);
export const normalizeDeliveryRoleType = (...args: any[]) => invoke("normalizeDeliveryRoleType", args);
export const normalizeDeliveryRoleLabelKey = (...args: any[]) => invoke("normalizeDeliveryRoleLabelKey", args);
export const normalizePersonNameKey = (...args: any[]) => invoke("normalizePersonNameKey", args);
export const buildRosterFromScratch = (...args: any[]) => invoke("buildRosterFromScratch", args);
export const reconcileImportedDeliveryRoles = (...args: any[]) => invoke("reconcileImportedDeliveryRoles", args);
export const detectCopilotContradictions = (...args: any[]) => invoke("detectCopilotContradictions", args);
export const buildTwinExecutiveSummary = (...args: any[]) => invoke("buildTwinExecutiveSummary", args);
export const syncTwinFromProjectState = (...args: any[]) => invoke("syncTwinFromProjectState", args);
export const pruneTwinOrphans = (...args: any[]) => invoke("pruneTwinOrphans", args);
export const simulateTwinNodeRemoval = (...args: any[]) => invoke("simulateTwinNodeRemoval", args);
