import React, { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import { phaseNameById } from "@/v3/utils";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";
import type { ProgramSummary } from "@/new/types";
import type { Database } from "@/integrations/supabase/types";

interface Schedule {
  id: string;
  agent_id: string;
  phase_id: string;
  cron_expression: string;
  label: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
}

interface SchedulePanelProps {
  programId: string | null;
  program: ProgramSummary | null;
}

const CRON_PRESETS = [
  { label: "Weekly digest (Mon 08:00)", value: "0 8 * * 1" },
  { label: "Daily health check (09:00)", value: "0 9 * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at 8am", value: "0 8 * * *" },
  { label: "Weekly Monday 8am", value: "0 8 * * 1" },
];

const SCHEDULABLE_AGENTS = [
  "daily-briefing", "narrative", "plan", "risk", "health-heatmap", "milestone", "stakeholder", "adoption", "scope-pcr", "weekly-digest",
];

function prettyAgent(agentId: string): string {
  return agentId.replace(/-/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

/** Compute the next UTC datetime matching a 5-part cron expression from a given base time. */
function computeNextRunAt(cronExpression: string, from: Date = new Date()): string {
  // Advance by 1 minute then scan forward up to 1 year
  const candidate = new Date(from.getTime() + 60_000);
  candidate.setUTCSeconds(0, 0);
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return candidate.toISOString();
  const [minutePart, hourPart, domPart, monthPart, dowPart] = parts;

  function matchPart(part: string, value: number): boolean {
    if (part === "*") return true;
    if (part.includes(",")) return part.split(",").some((s) => matchPart(s.trim(), value));
    if (part.includes("/")) {
      const [base, step] = part.split("/");
      const stepN = Number(step);
      if (!isFinite(stepN) || stepN <= 0) return false;
      if (base === "*") return value % stepN === 0;
    }
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      return isFinite(start) && isFinite(end) && value >= start && value <= end;
    }
    return Number(part) === value;
  }

  for (let i = 0; i < 525_600; i++) {
    if (
      matchPart(minutePart, candidate.getUTCMinutes()) &&
      matchPart(hourPart, candidate.getUTCHours()) &&
      matchPart(domPart, candidate.getUTCDate()) &&
      matchPart(monthPart, candidate.getUTCMonth() + 1) &&
      matchPart(dowPart, candidate.getUTCDay())
    ) {
      return candidate.toISOString();
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  return candidate.toISOString();
}

export default function SchedulePanel({ programId, program }: SchedulePanelProps) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm] = useState({
    agent_id: "narrative",
    phase_id: program?.activePhaseId || program?.phases[0]?.id || "strategy",
    cron_expression: CRON_PRESETS[0].value,
  });

  const phaseOptions = useMemo(() => program?.phases || [], [program]);

  useEffect(() => {
    if (!programId || !supabase || !isSupabaseConfigured) return;
    void supabase
      .from("adam_agent_schedules")
      .select("*")
      .eq("program_id", programId)
      .order("created_at", { ascending: false })
      .then(({ data }) => setSchedules((data as Schedule[]) || []));
  }, [programId]);

  async function refreshSchedules() {
    if (!programId || !supabase || !isSupabaseConfigured) return;
    const { data } = await supabase
      .from("adam_agent_schedules")
      .select("*")
      .eq("program_id", programId)
      .order("created_at", { ascending: false });
    setSchedules((data as Schedule[]) || []);
  }

  async function saveSchedule() {
    if (!programId || !supabase || !isSupabaseConfigured) return;
    const nextRunAt = computeNextRunAt(form.cron_expression);
    const label = `${prettyAgent(form.agent_id)} · ${phaseNameById(program, form.phase_id)} · ${form.cron_expression}`;
    const payload: Database["public"]["Tables"]["adam_agent_schedules"]["Insert"] = {
      program_id: programId,
      agent_id: form.agent_id,
      phase_id: form.phase_id,
      cron_expression: form.cron_expression,
      label,
      enabled: true,
      next_run_at: nextRunAt,
    };
    const { error } = await supabase.from("adam_agent_schedules").insert(payload);
    if (error) {
      setSaveError(error.message || "Failed to save schedule.");
      return;
    }
    setSaveError(null);
    await refreshSchedules();
  }

  async function toggleSchedule(schedule: Schedule) {
    if (!supabase || !isSupabaseConfigured) return;
    await supabase
      .from("adam_agent_schedules")
      .update({ enabled: !schedule.enabled })
      .eq("id", schedule.id);
    await refreshSchedules();
  }

  return (
    <div className="v3-section">
      <section className="v3-card">
        <div className="v3-card-title">Agent schedules</div>
        <div style={{ display: "grid", gap: 10 }}>
          {schedules.length ? schedules.map((schedule) => (
            <div key={schedule.id} className="v3-card-sm" style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ fontSize: 13, color: "var(--v3-text-primary)", fontWeight: 600 }}>
                  {schedule.label || `${prettyAgent(schedule.agent_id)} · ${phaseNameById(program, schedule.phase_id)}`}
                </div>
                <label className="v3-toggle" title={schedule.enabled ? "Disable schedule" : "Enable schedule"}>
                  <input type="checkbox" checked={schedule.enabled} onChange={() => void toggleSchedule(schedule)} />
                  <span className="v3-toggle-track" />
                </label>
              </div>
              <div style={{ fontSize: 12, color: "var(--v3-text-secondary)" }}>{schedule.cron_expression}</div>
              <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
                Last run: {schedule.last_run_at ? <RelativeTime date={schedule.last_run_at} /> : "Never"} · Next run: {schedule.next_run_at ? <RelativeTime date={schedule.next_run_at} /> : "Pending"} · {schedule.run_count} runs
              </div>
            </div>
          )) : (
            <div style={{ fontSize: 12, color: "var(--v3-text-muted)" }}>No schedules configured yet.</div>
          )}
        </div>
      </section>

      <section className="v3-card">
        <div className="v3-card-title">Add schedule</div>
        <div className="v3-wizard-grid">
          <div>
            <div className="v3-field-label">Agent</div>
            <select className="v3-input" aria-label="Schedule agent" value={form.agent_id} onChange={(event) => setForm((current) => ({ ...current, agent_id: event.target.value }))}>
              {SCHEDULABLE_AGENTS.map((agentId) => <option key={agentId} value={agentId}>{prettyAgent(agentId)}</option>)}
            </select>
          </div>
          <div>
            <div className="v3-field-label">Phase</div>
            <select className="v3-input" aria-label="Schedule phase" value={form.phase_id} onChange={(event) => setForm((current) => ({ ...current, phase_id: event.target.value }))}>
              {phaseOptions.map((phase) => <option key={phase.id} value={phase.id}>{phase.displayName}</option>)}
            </select>
          </div>
          <div>
            <div className="v3-field-label">Preset</div>
            <select className="v3-input" aria-label="Schedule preset" value={form.cron_expression} onChange={(event) => setForm((current) => ({ ...current, cron_expression: event.target.value }))}>
              {CRON_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
            </select>
          </div>
          <div>
            <div className="v3-field-label">Custom CRON</div>
            <input className="v3-input" aria-label="Custom cron expression" value={form.cron_expression} onChange={(event) => setForm((current) => ({ ...current, cron_expression: event.target.value }))} />
          </div>
        </div>
        {saveError ? (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--v3-red)" }}>{saveError}</div>
        ) : null}
        <div style={{ marginTop: 12 }}>
          <button type="button" className="v3-button primary" style={{ fontSize: 12 }} onClick={() => void saveSchedule()}>
            Save schedule
          </button>
        </div>
      </section>
    </div>
  );
}
