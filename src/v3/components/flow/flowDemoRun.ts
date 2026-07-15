/**
 * The functional demo layer — pure helpers behind the scenario runner.
 *
 * The architectural centre is the REPLAYABLE BEAT RECORD: every step a
 * stakeholder watches run is captured as (input, transition, executor,
 * outcome, human verdict). That one shape is what makes the ladder climbable:
 *  - executor "simulated" → "live-agent" is a config swap, not a rewrite;
 *  - the records ARE eval cases for Ship's eval-suite;
 *  - ✗ verdicts distil into Inbox design-fix proposals on ingest;
 *  - engagement analytics read the same trail.
 * Records travel inside the composed answer text between sentinels, so the
 * edge contract (answers = text) is untouched and the operator's transcript
 * stays human-readable.
 */

export interface DemoFixtureRecord { label: string; values: Record<string, string> }
export interface DemoFixture { entity: string; records: DemoFixtureRecord[]; note?: string }

export interface DemoBeatRecord {
  ts: string;
  flow: string;
  step: number;
  action: string;
  /** Who performed the transition this run: a simulated agent, a live agent
   * call, or the stakeholder themselves (a HITL approval). */
  executor: "simulated" | "live-agent" | "human";
  actor?: string;
  outcome?: string;
  hitl?: boolean;
  verdict?: "ok" | "not";
  note?: string;
  /** Field-level flags raised on the populated screen at this beat. */
  fieldFlags?: Array<{ entity: string; field: string; note?: string }>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** Tolerant fixture reader — the prototype pack's fixtures arrive either in
 * the new structured shape (records: [{label, values}]) or as the legacy
 * free-text description; both render, structured renders as rows. */
export function parseFixtures(raw: unknown): DemoFixture[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((fx): DemoFixture => {
    const entity = str(fx.entity).trim();
    const records: DemoFixtureRecord[] = [];
    if (Array.isArray(fx.records)) {
      for (const r of fx.records) {
        if (!isRecord(r)) continue;
        const label = str(r.label) || str(r.name);
        const values: Record<string, string> = {};
        const vals = isRecord(r.values) ? r.values : isRecord(r.fields) ? r.fields : {};
        for (const [k, v] of Object.entries(vals)) {
          if (typeof v === "string" || typeof v === "number") values[k] = String(v);
        }
        if (label || Object.keys(values).length) records.push({ label: label || entity, values });
      }
    } else if (typeof fx.records === "string" && fx.records.trim()) {
      records.push({ label: fx.records.trim().slice(0, 160), values: {} });
    }
    return { entity, records: records.slice(0, 5), note: str(fx.showsRelation) || undefined };
  }).filter((fx) => fx.entity && fx.records.length);
}

/** The fixtures whose entity a screen's wireframe blocks actually show —
 * loose name match so "Claim" finds "Claims" and "claim". */
export function fixturesForEntities(fixtures: DemoFixture[], entities: string[]): DemoFixture[] {
  const wanted = entities.map((e) => e.trim().toLowerCase().replace(/s$/, "")).filter(Boolean);
  if (!wanted.length) return [];
  return fixtures.filter((fx) => {
    const name = fx.entity.trim().toLowerCase().replace(/s$/, "");
    return wanted.some((w) => w === name || w.includes(name) || name.includes(w));
  }).slice(0, 3);
}

/** The entities a screen shows — from its declared entities plus any block-level
 * entity tags in the wireframe. */
export function screenEntities(screen: Record<string, unknown>): string[] {
  const out = new Set<string>();
  if (Array.isArray(screen.entities)) for (const e of screen.entities) if (typeof e === "string" && e.trim()) out.add(e.trim());
  if (Array.isArray(screen.wireframe)) {
    for (const region of screen.wireframe) {
      if (!isRecord(region) || !Array.isArray(region.blocks)) continue;
      for (const block of region.blocks) {
        if (isRecord(block) && typeof block.entity === "string" && block.entity.trim()) out.add(block.entity.trim());
      }
    }
  }
  return [...out];
}

/** Extract a before→after metric from a narration line — "was 2 days ... now
 * 40 seconds", "from 14 days to 4", "2 days → 40 seconds". Null when nothing
 * honest parses; the ticker never invents numbers. */
export function stepMetric(text: string): string | null {
  if (!text) return null;
  const UNIT = "(?:sec(?:ond)?s?|min(?:ute)?s?|hours?|days?|weeks?|months?|%|percent(?:age points?)?|points?)";
  const NUM = `[\\d][\\d.,]*\\s*${UNIT}`;
  const arrow = text.match(new RegExp(`(${NUM})\\s*(?:→|->)\\s*(${NUM})`, "i"));
  if (arrow) return `${arrow[1].trim()} → ${arrow[2].trim()}`;
  const wasNow = text.match(new RegExp(`(?:was|from)\\s+(${NUM})[^.]{0,60}?(?:now|to|takes?|watch it take)\\s+(${NUM})`, "i"));
  if (wasNow) return `${wasNow[1].trim()} → ${wasNow[2].trim()}`;
  return null;
}

/** The machine transition behind a flow step, by token overlap between the
 * step's action and the transition's trigger/target. Null when nothing maps —
 * the runner then falls back to the script's narration alone. */
export function transitionForStep(
  machines: Array<Record<string, unknown>>,
  action: string,
): { actor: string; on: string; to: string } | null {
  const tokens = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4));
  const want = tokens(action);
  if (!want.size) return null;
  let best: { actor: string; on: string; to: string; score: number } | null = null;
  for (const machine of machines) {
    if (!Array.isArray(machine.transitions)) continue;
    for (const t of machine.transitions) {
      if (!isRecord(t)) continue;
      const hay = tokens(`${str(t.on)} ${str(t.to)}`);
      let score = 0;
      for (const tok of want) if (hay.has(tok)) score += 1;
      if (score > (best?.score ?? 0)) best = { actor: str(t.actor), on: str(t.on), to: str(t.to), score };
    }
  }
  return best && best.score >= 2 ? { actor: best.actor, on: best.on, to: best.to } : null;
}

/** Whether an actor name reads as an AGENT (vs a human persona). */
export function isAgentActor(actor: string): boolean {
  return /\bagent\b|\bbot\b|\bautomat/i.test(actor);
}

const SENTINEL_OPEN = "[[DEMO-RUN-RECORDS]]";
const SENTINEL_CLOSE = "[[/DEMO-RUN-RECORDS]]";

/** Fold a run's beat records into the composed answer: a readable summary for
 * the operator, plus the structured trail between sentinels for machines
 * (design-fix proposals now, eval cases at Ship). */
export function foldBeatRecords(records: DemoBeatRecord[]): string {
  if (!records.length) return "";
  const lines = records.map((r) => {
    const verdict = r.verdict === "ok" ? "✓" : r.verdict === "not" ? "✗" : "·";
    const who = r.executor === "human" ? "you approved" : `${r.actor || "agent"} (${r.executor})`;
    const flags = (r.fieldFlags ?? []).map((f) => `${f.entity}.${f.field}${f.note ? ` — ${f.note}` : ""}`).join("; ");
    return `${verdict} ${r.flow} · step ${r.step + 1}: ${r.action} — ${who}${r.outcome ? ` → ${r.outcome}` : ""}${r.note ? ` · "${r.note}"` : ""}${flags ? ` · fields flagged: ${flags}` : ""}`;
  });
  return [`Scenario run, beat by beat:`, ...lines, `${SENTINEL_OPEN}${JSON.stringify(records)}${SENTINEL_CLOSE}`].join("\n");
}

/** Recover the structured trail from an ingested response. Empty when the
 * response predates the runner or the block was edited away. */
export function parseBeatRecords(text: string): DemoBeatRecord[] {
  const start = text.indexOf(SENTINEL_OPEN);
  const end = text.indexOf(SENTINEL_CLOSE);
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start + SENTINEL_OPEN.length, end));
    return Array.isArray(parsed) ? parsed.filter(isRecord) as unknown as DemoBeatRecord[] : [];
  } catch { return []; }
}

/** Strip the machine sentinel block for surfaces that show the response to a
 * human (the readable summary above it stays). */
export function stripBeatSentinel(text: string): string {
  const start = text.indexOf(SENTINEL_OPEN);
  const end = text.indexOf(SENTINEL_CLOSE);
  if (start < 0 || end <= start) return text;
  return (text.slice(0, start) + text.slice(end + SENTINEL_CLOSE.length)).replace(/\n{3,}/g, "\n\n").trim();
}
