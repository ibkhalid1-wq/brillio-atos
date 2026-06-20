/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  TEMPORARY — ATOS formal-artifact smoke test button.                       ║
 * ║  Verifies Cycle C end-to-end: fires one formal-artifact agent through the  ║
 * ║  live `run-agent` edge function (auto-authed via the app session), then    ║
 * ║  re-reads the programme and checks the artifact slot was satisfied.        ║
 * ║                                                                            ║
 * ║  TO REMOVE: delete this file and the <SmokeTestButton/> mount in           ║
 * ║  AppShellV3.tsx (search "SMOKE TEST — TEMPORARY").                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";

interface FormalSpec { phase: string; fieldKey: string; title: string; }

// Mirror of FORMAL_ARTIFACT_AGENTS in supabase/functions/run-agent/index.ts
const FORMAL_ARTIFACT_AGENTS: Record<string, FormalSpec> = {
  "charter":                { phase: "strategy", fieldKey: "transformationCharter", title: "Transformation Charter" },
  "business-case":          { phase: "strategy", fieldKey: "businessCaseDoc",       title: "Business Case" },
  "outcome-framework":      { phase: "strategy", fieldKey: "outcomeFramework",       title: "Outcome Framework" },
  "strategic-roadmap":      { phase: "strategy", fieldKey: "strategicRoadmap",       title: "Strategic Roadmap" },
  "governance-model":       { phase: "mobilise", fieldKey: "governanceModel",        title: "Governance Model" },
  "raci-matrix":            { phase: "mobilise", fieldKey: "raciMatrix",             title: "RACI Matrix" },
  "requirements-catalog":   { phase: "discover", fieldKey: "requirementsCatalog",    title: "Requirements Catalog" },
  "future-state-design":    { phase: "design",   fieldKey: "futureStateDesign",      title: "Future State Design" },
  "target-operating-model": { phase: "design",   fieldKey: "targetOperatingModel",   title: "Target Operating Model" },
  "solution-architecture":  { phase: "design",   fieldKey: "solutionArchitecture",   title: "Solution Architecture" },
  "test-plan":              { phase: "build",    fieldKey: "testPlan",               title: "Test Plan" },
  "runbook":                { phase: "operate",  fieldKey: "runbook",                title: "Runbook" },
  "support-model":          { phase: "operate",  fieldKey: "supportModel",           title: "Support Model" },
  "optimization-backlog":   { phase: "optimize", fieldKey: "optimizationBacklog",    title: "Optimization Backlog" },
};

const PROVIDER_RE = /overload|rate.?limit|upstream|unavailable|timed?\s*out|timeout|503|529|capacity|provider|anthropic|model_error|api error/i;
const AUTH_RE = /jwt|unauthor|forbidden|not allowed|permission|sign|token|401|403/i;

type Tone = "idle" | "running" | "success" | "outage" | "auth" | "error";

function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function innerOf(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    if (d.data && typeof d.data === "object" && !Array.isArray(d.data)) return d.data as Record<string, unknown>;
    return d;
  }
  return {};
}

interface SmokeTestButtonProps {
  programId: string | null;
  activePhaseId: string | null;
}

export default function SmokeTestButton({ programId, activePhaseId }: SmokeTestButtonProps) {
  const [agentId, setAgentId] = useState<string>("governance-model");
  const [tone, setTone] = useState<Tone>("idle");
  const [msg, setMsg] = useState<string>("");
  const [open, setOpen] = useState(false);

  const spec = FORMAL_ARTIFACT_AGENTS[agentId];

  async function run() {
    if (!programId) { setTone("error"); setMsg("No active programme selected."); return; }
    if (!isSupabaseConfigured || !supabase) { setTone("error"); setMsg("Supabase not configured."); return; }
    setTone("running"); setMsg(`Firing ${agentId} (phase: ${spec.phase})…`);

    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
    const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

    // Pull the live session token from the app — no copy/paste needed.
    const { data: sess } = await supabase.auth.getSession();
    const jwt = sess.session?.access_token;
    if (!jwt) { setTone("auth"); setMsg("Not logged in (no session token). Sign in and retry."); return; }

    const headers = { Authorization: `Bearer ${jwt}`, apikey: ANON, "Content-Type": "application/json" };

    // Snapshot the slot before, to prove the run changed it.
    const before = await readSlot(SUPABASE_URL, headers, programId, spec);

    const t0 = Date.now();
    let status = 0; let body = ""; let parsed: Record<string, unknown> | null = null;
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/run-agent`, {
        method: "POST",
        headers,
        body: JSON.stringify({ agentId, programId, phaseId: spec.phase, triggeredBy: "smoke-test" }),
      });
      status = resp.status;
      body = await resp.text();
      try { parsed = JSON.parse(body) as Record<string, unknown>; } catch { parsed = null; }
    } catch (e) {
      setTone("error"); setMsg(`Network error: ${e instanceof Error ? e.message : String(e)}`); return;
    }
    const ms = Date.now() - t0;
    const errText = (parsed && (parsed.error || parsed.message)) ? String(parsed.error || parsed.message) : body;

    // ── Classify ──
    if (status === 401 || status === 403 || (status >= 400 && AUTH_RE.test(errText) && !PROVIDER_RE.test(errText))) {
      setTone("auth"); setMsg(`🔒 AUTH (${status}): ${errText.slice(0, 160)} — refresh your session.`); return;
    }
    if (status < 200 || status >= 300) {
      if (PROVIDER_RE.test(errText)) {
        setTone("outage");
        setMsg(`⚠️ PROVIDER/OUTAGE (${status}, ${ms}ms): ${errText.slice(0, 160)} — wiring is fine; retry when the model recovers.`);
      } else {
        setTone("error"); setMsg(`❌ ERROR (${status}, ${ms}ms): ${errText.slice(0, 200)}`);
      }
      return;
    }

    // 2xx — verify the slot.
    const after = await readSlot(SUPABASE_URL, headers, programId, spec);
    if (after.error) { setTone("error"); setMsg(`Agent returned 200 but read-back failed: ${after.error}`); return; }
    if (after.artifactPresent && after.titleMatches) {
      const changed = !before.artifactPresent || !before.titleMatches;
      setTone("success");
      setMsg(`✅ SUCCESS (${ms}ms) — "${after.entryTitle}" landed.${changed ? " Slot flipped missing → satisfied." : " (Already satisfied before.)"} mirror=${after.mirrorPresent}`);
    } else {
      setTone("error");
      setMsg(`❌ WIRING (${ms}ms) — agent returned 200 but slot phaseArtifacts["${spec.phase}"]["${agentId}"] not satisfied (present=${after.artifactPresent}, title="${after.entryTitle ?? ""}").`);
    }
  }

  const toneColor: Record<Tone, string> = {
    idle: "#888", running: "#d97706", success: "#16a34a", outage: "#d97706", auth: "#dc2626", error: "#dc2626",
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: "fixed", bottom: 16, left: 16, zIndex: 9999,
          padding: "6px 12px", fontSize: 12, fontWeight: 700, fontFamily: "monospace",
          background: "#111", color: "#fbbf24", border: "1px dashed #fbbf24",
          borderRadius: 8, cursor: "pointer", opacity: 0.9,
        }}
        title="Temporary: ATOS formal-artifact smoke test"
      >
        ⚗ smoke test
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed", bottom: 16, left: 16, zIndex: 9999, width: 380,
        padding: 14, fontSize: 12, fontFamily: "monospace",
        background: "#111", color: "#eee", border: "1px dashed #fbbf24",
        borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <strong style={{ color: "#fbbf24" }}>⚗ Formal-artifact smoke test</strong>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 16 }}>×</button>
      </div>

      <div style={{ marginBottom: 8, color: "#aaa" }}>
        programme: <span style={{ color: programId ? "#7dd3fc" : "#dc2626" }}>{programId ?? "none selected"}</span>
        {activePhaseId ? <> · active phase: <span style={{ color: "#7dd3fc" }}>{activePhaseId}</span></> : null}
      </div>

      <label style={{ display: "block", marginBottom: 8 }}>
        agent:&nbsp;
        <select
          value={agentId}
          onChange={(e) => { setAgentId(e.target.value); setTone("idle"); setMsg(""); }}
          style={{ background: "#222", color: "#eee", border: "1px solid #444", borderRadius: 4, padding: "2px 4px", fontFamily: "monospace" }}
        >
          {Object.entries(FORMAL_ARTIFACT_AGENTS).map(([id, s]) => (
            <option key={id} value={id}>{id} → {s.phase}</option>
          ))}
        </select>
      </label>

      <div style={{ marginBottom: 8, color: "#888" }}>
        will fire <b style={{ color: "#eee" }}>{agentId}</b> in phase <b style={{ color: "#eee" }}>{spec.phase}</b>, expecting "{spec.title}".
      </div>

      <button
        onClick={run}
        disabled={tone === "running" || !programId}
        style={{
          width: "100%", padding: "8px 0", fontSize: 13, fontWeight: 700, fontFamily: "monospace",
          background: tone === "running" ? "#444" : "#fbbf24", color: tone === "running" ? "#aaa" : "#111",
          border: "none", borderRadius: 6, cursor: tone === "running" || !programId ? "not-allowed" : "pointer",
        }}
      >
        {tone === "running" ? "running…" : "Run smoke test"}
      </button>

      {msg && (
        <div style={{ marginTop: 10, padding: 8, background: "#1a1a1a", borderRadius: 6, color: toneColor[tone], lineHeight: 1.5, wordBreak: "break-word" }}>
          {msg}
        </div>
      )}
    </div>
  );
}

async function readSlot(
  url: string,
  headers: Record<string, string>,
  programId: string,
  spec: FormalSpec,
): Promise<{ artifactPresent: boolean; titleMatches: boolean; entryTitle: string | null; mirrorPresent: boolean; error?: string }> {
  try {
    const r = await fetch(`${url}/rest/v1/adam_programs?id=eq.${programId}&select=data`, { headers });
    if (!r.ok) return { artifactPresent: false, titleMatches: false, entryTitle: null, mirrorPresent: false, error: `read ${r.status}` };
    const rows = await r.json() as Array<{ data: unknown }>;
    const inner = innerOf(rows?.[0]?.data);
    const pa = inner.phaseArtifacts as Record<string, Record<string, { title?: string }>> | undefined;
    const agentId = Object.keys(FORMAL_ARTIFACT_AGENTS).find((k) => FORMAL_ARTIFACT_AGENTS[k] === spec);
    const entry = agentId ? pa?.[spec.phase]?.[agentId] : undefined;
    const entryTitle = entry?.title ?? null;
    const titleMatches = !!entryTitle && (
      norm(entryTitle) === norm(spec.title) ||
      norm(entryTitle).includes(norm(spec.title)) ||
      norm(spec.title).includes(norm(entryTitle))
    );
    const mirror = inner[spec.fieldKey];
    return {
      artifactPresent: !!entry,
      titleMatches,
      entryTitle,
      mirrorPresent: mirror !== undefined && mirror !== null,
    };
  } catch (e) {
    return { artifactPresent: false, titleMatches: false, entryTitle: null, mirrorPresent: false, error: e instanceof Error ? e.message : String(e) };
  }
}
