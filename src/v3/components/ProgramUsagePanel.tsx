import React, { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";

const COST_PER_1K = 0.003;

export default function ProgramUsagePanel({ programId }: { programId: string }) {
  const [data, setData] = useState<Array<{ agent_id: string; tokens_used: number | null }>>([]);

  useEffect(() => {
    if (!programId || !isSupabaseConfigured || !supabase) {
      setData([]);
      return;
    }

    void supabase
      .from("adam_agent_runs")
      .select("agent_id, tokens_used, created_at")
      .eq("program_id", programId)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data: rows }: { data: Array<{ agent_id: string; tokens_used: number | null }> | null }) => {
        setData((rows || []).map((row) => ({
          agent_id: row.agent_id,
          tokens_used: row.tokens_used,
        })));
      });
  }, [programId]);

  if (!data?.length) return null;

  const totalTokens = data.reduce((sum, row) => sum + (row.tokens_used || 0), 0);
  const estimatedCost = ((totalTokens / 1000) * COST_PER_1K).toFixed(4);
  const byAgent: Record<string, number> = {};

  data.forEach((row) => {
    byAgent[row.agent_id] = (byAgent[row.agent_id] || 0) + (row.tokens_used || 0);
  });

  return (
    <section className="v3-card">
      <div className="v3-card-title">API usage</div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Total tokens</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--v3-text-primary)" }}>{totalTokens.toLocaleString()}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Est. cost</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--v3-text-primary)" }}>${estimatedCost}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Runs</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--v3-text-primary)" }}>{data.length}</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {Object.entries(byAgent)
          .sort(([, left], [, right]) => right - left)
          .map(([agentId, tokens]) => (
            <div key={agentId} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: "var(--v3-text-secondary)" }}>{agentId}</span>
              <span style={{ color: "var(--v3-text-muted)", fontVariantNumeric: "tabular-nums" }}>{tokens.toLocaleString()} tok</span>
            </div>
          ))}
      </div>
    </section>
  );
}
