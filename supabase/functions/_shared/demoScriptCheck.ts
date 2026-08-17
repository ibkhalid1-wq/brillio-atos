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
  /** Whether the build drew a metric WIDGET the design asked for — stat tiles,
   *  bar breakdowns, funnels. These are the only bars in the product. */
  hasWidgets: boolean;
  /** Whether the build draws a TIME SERIES — the `trend` widget kind. Separate
   *  from `hasWidgets` because a bar breakdown is a snapshot: promising "the
   *  trend" over a funnel is the same lie in a smaller hat. */
  hasTrend: boolean;
  /** Whether a workbench carries the derived measures band ("Where this stands":
   *  counts, averages, a status split). Not the same thing as a widget, and the
   *  distinction matters: the band satisfies "a dashboard" and cannot satisfy "a
   *  chart", because it draws badges rather than bars. */
  hasMeasures: boolean;
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
const PROMISED: Array<{ noun: RegExp; needs: "measures" | "widgets" | "trend" | "board"; say: string }> = [
  // A summary on the screen. The derived band IS one, so this passes wherever a
  // workbench carries it.
  { noun: /\b(dashboard|command cent(re|er))\b/i, needs: "measures", say: "a dashboard" },
  // Bars. Only a spec widget draws them; the band draws badges.
  { noun: /\b(chart|graph|histogram|bar chart)\b/i, needs: "widgets", say: "a chart" },
  // A TIME SERIES. This WAS a gap on every build — the widget kinds were stat,
  // breakdown and funnel, all snapshots of now, so the one question an oversight
  // role asks ("is this getting better or worse") had no answer anywhere. The
  // `trend` kind closed it, and the rule moved with it: a script may promise a
  // trend where the DESIGN asked for one, and only there.
  { noun: /\b(timeline|trend ?line|sparkline|over time|month[- ]on[- ]month|run rate)\b/i, needs: "trend", say: "a trend over time" },
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
    // The DESIGN's widgets, keyed on the region the spec renderer fills — not on
    // `.m-stat`, which the derived measures band also emits. Keying it on the
    // class made every build look widgeted the moment that band shipped, and the
    // dashboard check silently stopped firing.
    hasWidgets: /data-region="widget:/.test(html),
    hasMeasures: /data-region="measures:/.test(html),
    hasTrend: /class="m-spark"/.test(html),
  };
}

const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Whether the build can honour what this beat promises to show. */
function unbuilt(show: string, brief: DemoBrief): string | null {
  for (const rule of PROMISED) {
    if (!rule.noun.test(show)) continue;
    if (rule.needs === "measures" && (brief.hasMeasures || brief.hasWidgets)) continue;
    if (rule.needs === "widgets" && brief.hasWidgets) continue;
    if (rule.needs === "trend" && brief.hasTrend) continue;
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
