import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface AutonomySettingsProps {
  programId: string | null;
}

interface AgentSetting {
  agent_id: string;
  enabled: boolean;
  trust_threshold: number;
}

const CONFIGURABLE_AGENTS = [
  { id: "narrative", label: "Narrative" },
  { id: "plan", label: "Plan" },
  { id: "risk", label: "Risks & RAID" },
  { id: "milestone", label: "Milestones" },
  { id: "budget", label: "Budget" },
  { id: "critical-path", label: "Critical path" },
  { id: "change-impact", label: "Change impact" },
  { id: "stakeholder", label: "Stakeholders" },
  { id: "adoption", label: "Adoption" },
  { id: "health-heatmap", label: "Health heatmap" },
  { id: "deck", label: "Status deck" },
  { id: "scope-pcr", label: "Scope & PCR" },
];

const ALWAYS_HUMAN_AGENTS = ["gate-review", "closure", "escalation"];

export default function AutonomySettings({ programId }: AutonomySettingsProps) {
  const [settings, setSettings] = useState<Map<string, AgentSetting>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!programId || !supabase) return;
    void supabase
      .from("adam_autonomy_settings")
      .select("agent_id, enabled, trust_threshold")
      .eq("program_id", programId)
      .then(({ data }) => {
        const map = new Map<string, AgentSetting>();
        (data || []).forEach((row) => {
          const setting = row as AgentSetting;
          map.set(setting.agent_id, setting);
        });
        setSettings(map);
        setLoaded(true);
      });
  }, [programId]);

  async function saveSetting(agentId: string, patch: Partial<AgentSetting>) {
    if (!programId || !supabase) return;
    const current = settings.get(agentId) || { agent_id: agentId, enabled: false, trust_threshold: 0.85 };
    const next = { ...current, ...patch, program_id: programId };
    await supabase
      .from("adam_autonomy_settings")
      .upsert(next, { onConflict: "program_id,agent_id" });
    setSettings((prev) => new Map(prev).set(agentId, next));
  }

  if (!programId) {
    return <div style={{ fontSize: 12, color: "var(--v3-text-muted)" }}>No active program selected.</div>;
  }

  if (!loaded) {
    return <div className="v3-skeleton" style={{ height: 220, borderRadius: 12 }} />;
  }

  return (
    <div style={{ display: "grid", gap: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 120px", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--v3-border)" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Agent</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Auto-apply</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Min confidence</span>
      </div>

      {ALWAYS_HUMAN_AGENTS.map((id) => (
        <div key={id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 120px", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--v3-border-soft)", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--v3-text-secondary)", textTransform: "capitalize" }}>{id.replace(/-/g, " ")}</span>
          <span className="v3-chip muted" style={{ fontSize: 11 }}>Always human</span>
          <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>—</span>
        </div>
      ))}

      {CONFIGURABLE_AGENTS.map(({ id, label }) => {
        const row = settings.get(id);
        const enabled = row?.enabled ?? false;
        const threshold = row?.trust_threshold ?? 0.85;
        return (
          <div key={id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 120px", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--v3-border-soft)", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--v3-text-secondary)" }}>{label}</span>
            <label className="v3-toggle" title={enabled ? "Disable auto-apply" : "Enable auto-apply"}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => void saveSetting(id, { enabled: event.target.checked })}
              />
              <span className="v3-toggle-track" />
            </label>
            <input
              type="range"
              className="v3-range"
              min={0.5}
              max={1.0}
              step={0.05}
              value={threshold}
              disabled={!enabled}
              onChange={(event) => void saveSetting(id, { trust_threshold: Number(event.target.value) })}
              title={`${Math.round(threshold * 100)}%`}
              aria-label={`${label} confidence threshold`}
            />
          </div>
        );
      })}
    </div>
  );
}
