/**
 * The Prototype Build Pack, compiled into a PROMPT: a self-contained brief a
 * coding agent (Claude Code, Cursor) can execute without this app open.
 * Pure projection of the pack + the Blueprint's direction — nothing here is
 * authored by hand, so regenerating the pack regenerates the prompt.
 */
import type { ProgramSummary } from "@/new/types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const rows = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => (typeof entry === "string" ? entry : "")).filter(Boolean) : [];

function inner(program: ProgramSummary): Record<string, unknown> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  return isRecord(raw.data) ? raw.data : raw;
}

/** Compose the build prompt, or null when there is no pack to compile. */
export function buildPrototypePrompt(program: ProgramSummary): string | null {
  const root = inner(program);
  const pack = isRecord(root.prototypePack) ? root.prototypePack : null;
  if (!pack) return null;
  const blueprint = isRecord(root.agenticBlueprint) ? root.agenticBlueprint : {};
  const scaffold = isRecord(pack.scaffold) ? pack.scaffold : {};
  const slices = rows(pack.buildSlices);
  const seeds = rows(pack.seedScenarios);
  const stubbing = isRecord(pack.stubbing) ? pack.stubbing : null;

  const lines: string[] = [];
  lines.push(`# Build brief — ${text(pack.title) || `${program.name} prototype`}`);
  lines.push("");
  lines.push("You are building a demonstration prototype. Optimise for TIME TO FIRST DEMO:");
  lines.push("the thinnest vertical slice that lets each named stakeholder watch THEIR OWN");
  lines.push("workflow run. Build the slices strictly in order — slice 1 must be demoable");
  lines.push("before slice 2 starts. Stub everything the brief says to stub.");
  if (text(blueprint.targetFramework)) {
    lines.push("");
    lines.push(`Agentic framework: ${text(blueprint.targetFramework)}.`);
  }

  const scaffoldFacts = ["runtime", "framework", "database", "hosting"]
    .map((key) => (text(scaffold[key]) ? `- ${key}: ${text(scaffold[key])}` : null))
    .filter(Boolean) as string[];
  const structure = strings(scaffold.structure);
  if (scaffoldFacts.length || structure.length) {
    lines.push("", "## Scaffold");
    lines.push(...scaffoldFacts);
    if (structure.length) {
      lines.push("", "Directory structure:", "```");
      lines.push(...structure);
      lines.push("```");
    }
  }

  if (slices.length) {
    lines.push("", "## Build slices — in this order");
    slices.forEach((slice, index) => {
      const name = text(slice.name) || text(slice.slice) || `Slice ${index + 1}`;
      lines.push("", `### ${index + 1}. ${name}`);
      const demonstrates = text(slice.demonstrates) || text(slice.goal);
      if (demonstrates) lines.push(`Demonstrates: ${demonstrates}`);
      if (text(slice.track)) lines.push(`Track: ${text(slice.track)}`);
      for (const step of strings(slice.steps ?? slice.tasks)) lines.push(`- ${step}`);
      if (text(slice.acceptance)) lines.push(`Done when: ${text(slice.acceptance)}`);
    });
  }

  if (seeds.length) {
    lines.push("", "## Seed data — verbatim, it must appear in the demo");
    lines.push("These scenarios come from real stakeholder transcripts. Use their names,");
    lines.push("their numbers, and their step order exactly — the demo must land as");
    lines.push("recognition, not fiction.");
    seeds.forEach((seed, index) => {
      const who = text(seed.stakeholder) || text(seed.persona);
      const scenario = text(seed.scenario) || text(seed.name);
      lines.push("", `${index + 1}. ${who ? `${who} — ` : ""}${scenario}`);
      for (const datum of strings(seed.data ?? seed.details)) lines.push(`   - ${datum}`);
    });
  }

  if (stubbing) {
    lines.push("", "## Stub, do not build");
    for (const [key, value] of Object.entries(stubbing)) {
      if (key.startsWith("_")) continue;
      if (typeof value === "string" && value.trim()) lines.push(`- ${key}: ${value.trim()}`);
      else for (const entry of strings(value)) lines.push(`- ${entry}`);
    }
  }

  const env = text(pack.demoEnvironment) || (isRecord(pack.demoEnvironment)
    ? Object.entries(pack.demoEnvironment).filter(([k]) => !k.startsWith("_"))
        .map(([k, v]) => `${k}: ${text(v)}`).filter((line) => line.split(": ")[1]).join(" · ")
    : "");
  if (env) lines.push("", "## Demo environment", env);

  lines.push("", "## Acceptance");
  lines.push("Each slice is done when its named stakeholder could watch their workflow run");
  lines.push("end-to-end with the seed data above. Do not gold-plate: stubs stay stubs until");
  lines.push("a slice needs them real.");

  return lines.join("\n");
}
