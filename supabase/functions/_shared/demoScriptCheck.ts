/**
 * A DEMO SCRIPT IS READ ALOUD IN FRONT OF A CLIENT.
 *
 * Which makes it the one document where a wrong sentence is not a defect you
 * fix later — it is a presenter saying "and here you'd see the dashboard" to a
 * room looking at a screen that has no dashboard.
 *
 * THE DEFECT THIS EXISTS FOR, measured on a live programme: the script told the
 * presenter to show a "Performance Trend timeline for Hospital", a "dashboard",
 * and a "Set Target action" they could click. The build has none of those. What
 * it has is a workbench listing "Set targets and priorities for surgical teams"
 * as a STEP — read-only text describing the work, not a control that performs
 * it. The script was written from the Experience Design's intent and never
 * checked against the thing that got built, because the prototype was not one of
 * its inputs.
 *
 * So the inventory below is taken FROM THE ASSEMBLED BUILD, and a beat that
 * needs something the build does not have is marked on the beat and named in
 * gaps. The beat is not deleted: what the design intended is worth knowing, and
 * silently dropping it would hide a real gap between design and build. It is
 * labelled, so nobody reads it out by accident.
 */

/** What the built application actually offers a presenter. */
export interface DemoBrief {
  /** Every screen the build routes to, as its `data-screen` id. */
  screens: string[];
  /** The entities with screens — what a beat can legitimately name. */
  entities: string[];
  /** The controls the build draws, by their visible label. */
  actions: string[];
  /** Whether the build drew any metric widget at all. */
  hasWidgets: boolean;
}

const text = (v: unknown): string => String(v ?? "").trim();
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * UI NOUNS A BEAT CAN PROMISE AND A BUILD CAN LACK.
 *
 * Deliberately concrete: each is a thing the assembler either draws or does
 * not, so the check is a fact and never a judgement about phrasing. Words like
 * "screen", "page" or "view" are absent on purpose — every beat names one of
 * those, and flagging them would make the check cry wolf.
 */
const PROMISED: Array<{ noun: RegExp; needs: keyof DemoBrief | "board"; say: string }> = [
  { noun: /\b(dashboard|command cent(re|er))\b/i, needs: "hasWidgets", say: "a dashboard" },
  { noun: /\b(chart|graph|timeline|trend line|sparkline|histogram)\b/i, needs: "hasWidgets", say: "a chart" },
  { noun: /\b(kanban|swim ?lane)\b/i, needs: "board", say: "a board" },
];

/** Read the inventory out of an assembled build. */
export function demoBriefOf(html: string, entities: readonly string[]): DemoBrief {
  const screens = [...new Set([...html.matchAll(/data-screen="([^"]+)"/g)].map((m) => m[1]))];
  const actions = [...new Set([...html.matchAll(/class="m-btn[^"]*"[^>]*>([^<]{2,40})</g)]
    .map((m) => m[1].trim()).filter((a) => a && !a.includes("'")))];
  return {
    screens,
    entities: entities.filter((e) => screens.includes(`list-${slugOf(e)}`) || screens.includes(`detail-${slugOf(e)}`)),
    actions,
    // A stat widget only exists where a screen spec asked for one AND the
    // ontology could honour it, so this is a fact about THIS build.
    hasWidgets: /class="m-stat"/.test(html) || /data-region="widget:/.test(html),
  };
}

const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Whether the build can honour what this beat promises to show. */
function unbuilt(show: string, brief: DemoBrief): string | null {
  for (const rule of PROMISED) {
    if (!rule.noun.test(show)) continue;
    if (rule.needs === "hasWidgets" && brief.hasWidgets) continue;
    if (rule.needs === "board" && brief.screens.some((s) => s.startsWith("list-"))) continue;
    return `promises ${rule.say}, which this build does not draw`;
  }
  return null;
}

export interface DemoScriptCheck {
  doc: Record<string, unknown>;
  /** One line per beat the build cannot honour — written into the doc's gaps. */
  gaps: string[];
  /** How many beats were checked, so a silent no-op is visible. */
  checked: number;
}

/**
 * Hold every beat to the build.
 *
 * The beat is KEPT and marked (`unbuilt`), never removed: the design's intent is
 * worth knowing, and deleting it would hide the gap between what was designed
 * and what was assembled — which is the thing a delivery team most needs to see
 * before they stand up in front of a client.
 */
export function checkDemoScripts(doc: unknown, brief: DemoBrief): DemoScriptCheck {
  const out = isRecord(doc) ? { ...doc } : {};
  const gaps: string[] = [];
  let checked = 0;
  const scripts = Array.isArray(out.scripts) ? out.scripts : [];
  out.scripts = scripts.map((raw) => {
    if (!isRecord(raw)) return raw;
    const who = text(raw.stakeholder) || text(raw.role) || "a stakeholder";
    const steps = Array.isArray(raw.steps) ? raw.steps : [];
    return {
      ...raw,
      steps: steps.map((s) => {
        if (!isRecord(s)) return s;
        checked += 1;
        const miss = unbuilt(text(s.show), brief);
        if (!miss) return s;
        gaps.push(`Demo beat for ${who} — "${text(s.beat) || text(s.show).slice(0, 60)}" ${miss}. Either the build needs it or the beat does.`);
        return { ...s, unbuilt: miss };
      }),
    };
  });
  return { doc: out, gaps, checked };
}
