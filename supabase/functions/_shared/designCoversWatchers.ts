/**
 * A SCREEN PER ENTITY SERVES WHOEVER EDITS THAT ENTITY, AND NOBODY ELSE.
 *
 * THE MEASURED FAILURE. On a surgical-cancellations programme, the "Executive
 * Oversight" area opened on a table of 49 practitioners — while the demo script
 * written for that same executive promised a dashboard, a cancellation trend and
 * a target to set. The script was RIGHT about the product. No design had ever
 * authored it: the Experience Design for that programme contained the word
 * "metric" zero times, "dashboard" zero times, "KPI" zero times.
 *
 * The capability was never missing. `metricSpecFrom` has always read wireframe
 * blocks of `kind: "metric"` and turned them into validated stat widgets. It sat
 * unused because the design designs per ENTITY and per FLOW, and never per
 * PERSON — so the one artifact that asked "what does this person need to see?"
 * was the demo script, which cannot build anything.
 *
 * This is the post-condition for the rule that fixes it. A persona whose work is
 * WATCHING and whose screens carry no measure is named — with the verbs that say
 * so, so the finding argues its own case rather than asserting it.
 */

const text = (v: unknown): string => String(v ?? "").trim();
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * WORK THAT IS WATCHING. Deliberately narrow and deliberately about the verb: a
 * step is a sentence, and the verb is the part that says whether the person acts
 * on a record or reads across many of them.
 *
 * "approve" is absent on purpose — approving is a decision on one record, and
 * the approvals queue already serves it. Including it would tag half the
 * programme as oversight and the finding would stop meaning anything.
 */
const WATCH = /\b(review|monitor|track|oversee|audit|assess|evaluate|analyse|analyze|measure|report on|reduce|trend|forecast|benchmark)\w*\b/i;

/** One area's case for needing a measure, in its own evidence. */
export interface WatcherArea {
  area: string;
  /** The steps whose verb says they are watching — the argument, not a label. */
  watching: string[];
  /** How many steps the area has in total, so the ratio is visible. */
  steps: number;
}

/** Areas whose work is watching, read off the atlas. */
export function watcherAreas(atlas: unknown): WatcherArea[] {
  const doc = isRecord(atlas) ? atlas : {};
  const byArea = new Map<string, WatcherArea>();
  for (const w of (Array.isArray(doc.workflows) ? doc.workflows : []).filter(isRecord)) {
    const area = text(w.area) || text(w.owner);
    if (!area) continue;
    const entry = byArea.get(area) ?? { area, watching: [], steps: 0 };
    for (const s of (Array.isArray(w.steps) ? w.steps : []).filter(isRecord)) {
      const action = text(s.action) || text(s.name);
      if (!action) continue;
      entry.steps += 1;
      if (WATCH.test(action) && entry.watching.length < 3) entry.watching.push(action);
    }
    byArea.set(area, entry);
  }
  // An area with ONE watching step among twenty is not an oversight area; it is
  // an area that occasionally reads. Half or more, and at least two, is the bar.
  return [...byArea.values()].filter((a) => a.watching.length >= 2 && a.watching.length * 2 >= a.steps);
}

/** Every entity a design's metric blocks measure, and the screens they sit on. */
export function measuredIn(design: unknown): { entities: Set<string>; screens: Set<string> } {
  const d = isRecord(design) ? design : {};
  const entities = new Set<string>();
  const screens = new Set<string>();
  for (const screen of (Array.isArray(d.screens) ? d.screens : []).filter(isRecord)) {
    for (const region of (Array.isArray(screen.wireframe) ? screen.wireframe : []).filter(isRecord)) {
      for (const block of (Array.isArray(region.blocks) ? region.blocks : []).filter(isRecord)) {
        if (text(block.kind).toLowerCase() !== "metric") continue;
        screens.add(text(screen.name) || text(screen.id));
        if (text(block.entity)) entities.add(text(block.entity));
      }
    }
  }
  return { entities, screens };
}

/** Whether the design authored any verb at all for somebody to act with. */
function hasLever(design: unknown): boolean {
  const d = isRecord(design) ? design : {};
  return (Array.isArray(d.screens) ? d.screens : []).filter(isRecord)
    .some((s) => Array.isArray(s.primaryActions) && s.primaryActions.length > 0);
}

/**
 * Name what the design owes the people who only watch.
 *
 * Returns gap lines, never a mutation: the Experience Design is the DESIGNER's
 * document, and a post-condition that silently wrote screens into it would be
 * inventing design rather than reporting a hole. Same reasoning as the demo
 * script's marked beats — say the thing, let a person decide.
 */
export function watcherGaps(design: unknown, atlas: unknown): string[] {
  const watchers = watcherAreas(atlas);
  if (!watchers.length) return [];
  const { entities, screens } = measuredIn(design);
  const gaps: string[] = [];
  if (!entities.size && !screens.size) {
    // The whole document carries no measure at all, which is the case that was
    // shipping: name the areas it costs, with their own words as the evidence.
    for (const a of watchers) {
      gaps.push(`${a.area} watches (${a.watching.length} of ${a.steps} steps: "${a.watching[0]}") and this design gives it no measure to open on — no wireframe block of kind "metric" anywhere. It will get a table of records instead.`);
    }
  }
  if (!hasLever(design) && watchers.length) {
    gaps.push(`No screen authors a primaryActions verb, so every screen is read-only: ${watchers.map((a) => a.area).join(", ")} can watch a number and do nothing about it.`);
  }
  return gaps;
}
