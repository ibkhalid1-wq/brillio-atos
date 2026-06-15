/**
 * Integration status:
 * - This file is a runtime-registration shim for a richer artifact engine.
 * - The current V3 shell persists artifacts through normalized program state and Supabase edge functions.
 * - Until an artifact runtime is registered in the app shell, these helpers remain intentionally dormant rather than partially wired.
 */
type RuntimeMap = Record<string, (...args: any[]) => any>;

let runtime: RuntimeMap = {};

export function registerAdamArtifactsRuntime(nextRuntime: RuntimeMap) {
  runtime = { ...runtime, ...(nextRuntime || {}) };
}

function invoke(name: string, args: any[]) {
  const fn = runtime[name];
  if (typeof fn !== "function") {
    throw new Error(`ATOS artifact runtime not registered for ${name}`);
  }
  return fn(...args);
}

export const refreshPhaseArtifactsFromInputs = (...args: any[]) => invoke("refreshPhaseArtifactsFromInputs", args);
export const regenerateAffectedDownstreamArtifacts = (...args: any[]) => invoke("regenerateAffectedDownstreamArtifacts", args);
export const generatePhaseSequence = (...args: any[]) => invoke("generatePhaseSequence", args);
export const buildArtifactDraftFromInputs = (...args: any[]) => invoke("buildArtifactDraftFromInputs", args);
export const reviewProposal = (...args: any[]) => invoke("reviewProposal", args);
export const submitArtifactForApproval = (...args: any[]) => invoke("submitArtifactForApproval", args);
export const approveArtifact = (...args: any[]) => invoke("approveArtifact", args);
export const rejectArtifact = (...args: any[]) => invoke("rejectArtifact", args);
export const pushArtifactUndo = (...args: any[]) => invoke("pushArtifactUndo", args);
export const undoArtifactEdit = (...args: any[]) => invoke("undoArtifactEdit", args);
