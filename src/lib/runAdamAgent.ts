/**
 * Integration status:
 * - This is the thin direct edge-function wrapper used by older entry points.
 * - The V3 shell now routes agent execution through `useAgentRun`, which owns run subscriptions, status hydration, and downstream UX.
 * - Keep this wrapper for non-shell callers and scripted usage, but prefer `useAgentRun` for interactive V3 execution.
 */
import { supabase } from "@/integrations/supabase/client";

export interface RunAgentOptions {
  agentId: string;
  phaseId: string;
  programId: string;
  triggeredBy: "manual" | "trigger" | "downstream";
}

export interface RunAgentResult {
  success: boolean;
  agentId: string;
  error?: string;
  [key: string]: unknown;
}

export async function runAdamAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const { data, error } = await supabase.functions.invoke("run-agent", {
    body: {
      agentId: options.agentId,
      phaseId: options.phaseId,
      programId: options.programId,
      triggeredBy: options.triggeredBy,
    },
  });

  if (error) {
    return {
      success: false,
      agentId: options.agentId,
      error: error.message || "Agent runtime failed.",
    };
  }

  return {
    success: true,
    agentId: options.agentId,
    ...((data && typeof data === "object") ? data : {}),
  };
}
