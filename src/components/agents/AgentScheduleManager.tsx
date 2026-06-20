import React, { useMemo, useState } from "react";
import { useAgentSchedules } from "@/hooks/useAgentSchedules";
import type { AgentRun } from "@/lib/adamSync";

const FREQUENCY_PRESETS = [
  { label: "Daily 8am", value: "0 8 * * *" },
  { label: "Weekdays 8am", value: "0 8 * * 1-5" },
  { label: "Weekly Monday 9am", value: "0 9 * * 1" },
];

const PHASES = ["strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize"];

function describeCron(expression: string): string {
  if (expression === "0 8 * * *") return "Every day at 8:00 AM";
  if (expression === "0 8 * * 1-5") return "Every weekday at 8:00 AM";
  if (expression === "0 9 * * 1") return "Every Monday at 9:00 AM";
  return `Custom cron: ${expression}`;
}

function formatCountdown(nextRunAt: string | null): string {
  if (!nextRunAt) return "No next run";
  const diff = new Date(nextRunAt).getTime() - Date.now();
  if (diff <= 0) return "Due now";
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `in ${days}d ${hours % 24}h`;
  if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
  return `in ${minutes}m`;
}

export interface AgentScheduleManagerProps {
  programId: string;
  runs?: AgentRun[];
  onOpenTrace?: (runId: string) => void;
}

export function AgentScheduleManager({ programId, runs = [], onOpenTrace }: AgentScheduleManagerProps) {
  const { schedules, createSchedule, toggleSchedule, deleteSchedule } = useAgentSchedules(programId);
  const [agentId, setAgentId] = useState("strategy");
  const [phaseId, setPhaseId] = useState("strategy");
  const [label, setLabel] = useState("Daily readiness check");
  const [cronExpression, setCronExpression] = useState(FREQUENCY_PRESETS[1].value);
  const [customMode, setCustomMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const lastRunByKey = useMemo(() => {
    const nextMap = new Map<string, AgentRun>();
    runs.forEach((run) => {
      const key = `${run.agent_id}:${run.phase_id}`;
      if (!nextMap.has(key)) {
        nextMap.set(key, run);
      }
    });
    return nextMap;
  }, [runs]);

  async function handleCreateSchedule(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await createSchedule({
        agentId,
        phaseId,
        cronExpression,
        label,
      });
      setLabel("Daily readiness check");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Create schedule</h3>
          <p className="mt-1 text-xs text-slate-500">Run agents automatically on a fixed cadence.</p>
        </div>
        <form onSubmit={handleCreateSchedule} className="grid gap-3 md:grid-cols-2">
          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs text-slate-500">Agent</span>
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-200"
            >
              {PHASES.map((phase) => (
                <option key={phase} value={phase}>{phase}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs text-slate-500">Phase</span>
            <select
              value={phaseId}
              onChange={(event) => setPhaseId(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-200"
            >
              {PHASES.map((phase) => (
                <option key={phase} value={phase}>{phase}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700 md:col-span-2">
            <span className="mb-1 block text-xs text-slate-500">Label</span>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-200"
            />
          </label>
          <div className="md:col-span-2">
            <div className="mb-2 flex flex-wrap gap-2">
              {FREQUENCY_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => {
                    setCustomMode(false);
                    setCronExpression(preset.value);
                  }}
                  className={`rounded-full border px-3 py-1 text-xs ${cronExpression === preset.value && !customMode ? "border-cyan-500 bg-cyan-50 text-cyan-700" : "border-slate-300 text-slate-600"}`}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCustomMode(true)}
                className={`rounded-full border px-3 py-1 text-xs ${customMode ? "border-cyan-500 bg-cyan-50 text-cyan-700" : "border-slate-300 text-slate-600"}`}
              >
                Custom cron
              </button>
            </div>
            {customMode ? (
              <input
                value={cronExpression}
                onChange={(event) => setCronExpression(event.target.value)}
                placeholder="*/15 * * * *"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-200"
              />
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {describeCron(cronExpression)}
              </div>
            )}
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={saving || !label.trim() || !cronExpression.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Create schedule"}
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Active schedules</h3>
        </div>
        <div className="divide-y divide-slate-200">
          {schedules.length === 0 && (
            <div className="px-4 py-6 text-sm text-slate-500">No agent schedules configured yet.</div>
          )}
          {schedules.map((schedule) => {
            const lastRun = lastRunByKey.get(`${schedule.agent_id}:${schedule.phase_id}`);
            return (
              <div key={schedule.id} className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{schedule.label}</span>
                    <span className={`h-2 w-2 rounded-full ${schedule.enabled ? "bg-emerald-500" : "bg-slate-300"}`} />
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {schedule.agent_id} · {schedule.phase_id} · {describeCron(schedule.cron_expression)}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Next run {formatCountdown(schedule.next_run_at)}{schedule.last_run_at ? ` · Last run ${new Date(schedule.last_run_at).toLocaleString()}` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {lastRun?.id && onOpenTrace ? (
                    <button
                      type="button"
                      onClick={() => onOpenTrace(lastRun.id)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
                    >
                      Open last trace
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void toggleSchedule(schedule.id, !schedule.enabled)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
                  >
                    {schedule.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteSchedule(schedule.id)}
                    className="rounded-md border border-rose-200 px-3 py-1.5 text-xs text-rose-600 transition hover:border-rose-300 hover:bg-rose-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
