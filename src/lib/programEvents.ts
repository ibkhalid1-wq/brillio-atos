import type { SupabaseClient } from "@supabase/supabase-js";

export type ProgramEventType =
  | "gate_approved"
  | "gate_remediation_requested"
  | "gate_reopened"
  | "artifact_saved"
  | "artifact_edited"
  | "artifact_feedback"
  | "decision_added"
  | "decision_resolved"
  | "risk_added"
  | "risk_updated"
  | "milestone_updated"
  | "phase_unlocked"
  | "agent_run_completed"
  | "input_saved"
  | "member_added"
  | "member_removed"
  | "evidence_linked";

export async function emitProgramEvent(
  supabase: SupabaseClient,
  programId: string,
  eventType: ProgramEventType,
  payload: Record<string, unknown>,
  opts?: { phaseId?: string; agentId?: string; prevSnapshot?: Record<string, unknown> },
) {
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  await supabase.from("adam_program_events").insert({
    program_id: programId,
    event_type: eventType,
    phase_id: opts?.phaseId || null,
    actor_id: user?.id || null,
    actor_name: user?.user_metadata?.full_name || user?.email || "System",
    agent_id: opts?.agentId || null,
    payload,
    prev_snapshot: opts?.prevSnapshot || null,
  });
}
