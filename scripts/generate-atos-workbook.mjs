import * as XLSX from "xlsx";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(homedir(), "Downloads", "ATOS_Phases_and_Agents.xlsx");

// ── Tab 1: Phases — input fields, input artifacts, output artifacts ──────────
// Sources: src/v3/lib/phaseInputSchema.ts (input fields),
//          src/v3/lib/methodology.ts (requiredArtifacts = outputs),
//          src/v3/lib/agentMeta.ts (artifact id → human label).
// "Input artifacts" = prior-phase outputs carried through the gate + uploaded docs.

// Denormalized: one row per (phase, input, artifact). Inputs (* = required) and
// output artifacts are listed positionally; the phase repeats on every row so the
// sheet can be filtered/pivoted. Shorter column is padded with blanks.
const phases = [
  {
    phase: "1. Strategy",
    inputs: ["Business objective*", "Executive sponsor*", "Primary success metric*", "Key constraints", "Key roles", "Workstreams", "Outcome KPIs (baseline → target)"],
    artifacts: ["Transformation Charter", "Business Case", "Outcome Framework", "Strategic Roadmap", "Phase Narrative", "Delivery Plan"],
  },
  {
    phase: "2. Mobilise",
    inputs: ["Programme director*", "Team size", "Governance model", "Known risks at mobilisation", "Key roles", "Workstreams"],
    artifacts: ["Governance Model", "RACI Matrix", "Phase Narrative", "Delivery Plan", "Stakeholder Map"],
  },
  {
    phase: "3. Discover",
    inputs: ["Current state summary*", "In scope*", "Out of scope", "Key stakeholders", "Key roles", "Workstreams"],
    artifacts: ["Requirements Catalog", "Phase Narrative", "Risk Register", "Milestone Plan"],
  },
  {
    phase: "4. Design",
    inputs: ["Solution approach*", "Integration points", "Design constraints", "Key roles", "Workstreams"],
    artifacts: ["Future-State Design", "Target Operating Model", "Solution Architecture", "Phase Narrative", "Delivery Plan", "Risk Register", "Critical Path"],
  },
  {
    phase: "5. Build",
    inputs: ["Current sprint velocity", "Active blockers", "Test coverage %", "Key roles", "Workstreams"],
    artifacts: ["Test Plan", "Phase Narrative", "Delivery Plan", "Milestone Plan"],
  },
  {
    phase: "6. Operate",
    inputs: ["Go-live plan owner*", "Support model*", "KPI being tracked*", "Runbook reference", "Adoption approach", "Key roles", "Workstreams"],
    artifacts: ["Runbook", "Support Model", "Phase Narrative", "Adoption Plan"],
  },
  {
    phase: "7. Govern",
    inputs: ["Compliance owner*", "Control matrix reference*", "Reporting cadence*", "Audit evidence plan", "Escalation path", "Key roles", "Workstreams"],
    artifacts: ["Phase Narrative", "Risk Register"],
  },
  {
    phase: "8. Optimize",
    inputs: ["Benefit baseline*", "Improvement backlog reference*", "Adoption vs target", "Experiment recommendation", "Key roles", "Workstreams"],
    artifacts: ["Optimization Backlog", "Phase Narrative", "Delivery Plan"],
  },
  {
    phase: "9. Value Realize",
    inputs: ["Realised benefits*", "Lessons learned reference*", "BAU owner*", "Closure pack reference", "Key roles", "Workstreams", "KPI actuals"],
    artifacts: ["Phase Narrative", "Closure Report"],
  },
];

const phaseHeader = ["Phase", "Input (* = required)", "Artifact (output)"];
const phaseRows = [phaseHeader];
for (const p of phases) {
  const n = Math.max(p.inputs.length, p.artifacts.length);
  for (let i = 0; i < n; i++) {
    phaseRows.push([p.phase, p.inputs[i] ?? "", p.artifacts[i] ?? ""]);
  }
}
const ws1 = XLSX.utils.aoa_to_sheet(phaseRows);
ws1["!cols"] = [{ wch: 18 }, { wch: 36 }, { wch: 28 }];
ws1["!rows"] = [{ hpt: 24 }];

// ── Tab 2: Autonomous Agents — triggers, continuous agents, cadence ──────────
// Sources: AppShellV3.tsx (proactive triggers), InsightFeedView.tsx (daily auto),
//          SchedulePanel.tsx (SCHEDULABLE_AGENTS + CRON_PRESETS, adam_agent_schedules),
//          agentMeta.ts (co-pilot continuous), useAIStatus.ts (90s status poll).

const agentHeader = [
  "Agent",
  "Type",
  "What triggers it",
  "Cadence / frequency",
];
const agentRows = [
  agentHeader,
  // — Continuously running —
  [
    "Programme Co-pilot",
    "Continuous",
    "Always on — continuously monitors your work and surfaces improvement suggestions in context",
    "Constant (reacts to every edit / view change; ~8s per suggestion pass)",
  ],
  [
    "AI provider status check",
    "Continuous (system)",
    "Background heartbeat to confirm the AI provider is reachable (not an agent generation)",
    "Every 90 seconds",
  ],
  // — Auto / time-based —
  [
    "Daily Briefing",
    "Automatic (time-based)",
    "Auto-fires on first program view of the day (per-program 24h guard in localStorage)",
    "Once per 24 hours",
  ],
  // — Proactive (event-driven) —
  [
    "Onboarding Briefer",
    "Proactive (event-driven)",
    "Entering a brand-new phase that has no inputs and no artifacts yet (AI connected, no run in flight, gate not approved)",
    "Once per phase per program; fires ~4s after phase entry",
  ],
  [
    "Gate Readiness Coach",
    "Proactive (event-driven)",
    "Active phase readiness is low but work has started (score > 5% and < max(40, gate threshold − 20)); gate not approved/in-review",
    "At most once per program+phase (persisted across reloads)",
  ],
  // — Scheduled (user-configurable cron, stored in adam_agent_schedules) —
  [
    "Daily Briefing (scheduled)",
    "Scheduled (cron)",
    "User-configured schedule via Schedule panel",
    "User choice — e.g. Daily 09:00 (0 9 * * *), Daily 08:00 (0 8 * * *)",
  ],
  [
    "Phase Narrative",
    "Scheduled (cron)",
    "User-configured schedule",
    "User choice (e.g. weekly / daily)",
  ],
  [
    "Delivery Plan",
    "Scheduled (cron)",
    "User-configured schedule",
    "User choice",
  ],
  [
    "Risk Register",
    "Scheduled (cron)",
    "User-configured schedule",
    "User choice (e.g. Daily health check 09:00)",
  ],
  [
    "Health Heatmap",
    "Scheduled (cron)",
    "User-configured schedule",
    "User choice (e.g. Every 6 hours: 0 */6 * * *)",
  ],
  [
    "Milestone Plan",
    "Scheduled (cron)",
    "User-configured schedule",
    "User choice",
  ],
  [
    "Stakeholder Map",
    "Scheduled (cron)",
    "User-configured schedule",
    "User choice",
  ],
  [
    "Adoption Plan",
    "Scheduled (cron)",
    "User-configured schedule",
    "User choice",
  ],
  [
    "Scope PCR (change request)",
    "Scheduled (cron)",
    "User-configured schedule",
    "User choice",
  ],
  [
    "Weekly Digest",
    "Scheduled (cron)",
    "User-configured schedule",
    "User choice — e.g. Weekly Mon 08:00 (0 8 * * 1)",
  ],
];

const ws2 = XLSX.utils.aoa_to_sheet(agentRows);
ws2["!cols"] = [{ wch: 28 }, { wch: 24 }, { wch: 78 }, { wch: 52 }];
ws2["!rows"] = [{ hpt: 28 }];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws1, "Phases");
XLSX.utils.book_append_sheet(wb, ws2, "Autonomous Agents");
XLSX.writeFile(wb, OUT);
console.log("Wrote", OUT);
