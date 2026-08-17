/**
 * AN AGENT THE HANDLER WILL NOT ACCEPT IS NOT AN AGENT.
 *
 * `run-agent` keeps two lists. `VALID_AGENT_IDS` is the door: an id not in it
 * is rejected with 400 "Unknown agentId" before any spec is consulted.
 * `FORMAL_ARTIFACT_AGENTS` is the room: the prompt, the phase, the field key,
 * the upstreams. The source comment beside the door says the two are "kept in
 * lockstep" — and that was a promise, not a mechanism.
 *
 * MEASURED, on a live programme. `review-capture` was written, deployed,
 * post-conditioned, wired to two operator surfaces and covered by eleven
 * passing tests — and had never once been invokable, because it was added to
 * the room and not to the door. Every test asserted that its spec EXISTED and
 * that its answer was checked; none asserted that the door would open. It was
 * caught by pressing the button on a real transcript and reading a 400.
 *
 * So this file is the mechanism. It is deliberately about REACHABILITY and
 * nothing else: not whether an agent is good, only whether calling it is
 * possible at all.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");

/** The literal string members of `VALID_AGENT_IDS`. Spreads (…SEQUENCE) are
 *  deliberately not resolved: those ids come from shared sequences that have
 *  their own tests, and guessing at them here would invent coverage. */
function doorIds(): Set<string> {
  const start = EDGE.indexOf("const VALID_AGENT_IDS = new Set([");
  const end = EDGE.indexOf("]);", start);
  expect(start, "VALID_AGENT_IDS not found — this test is reading the wrong file").toBeGreaterThan(-1);
  const body = EDGE.slice(start, end);
  return new Set([...body.matchAll(/^\s*"([a-z0-9-]+)",/gm)].map((m) => m[1]));
}

/**
 * The keys of `FORMAL_ARTIFACT_AGENTS`.
 *
 * The brace must END THE LINE, and that is not fussiness. Several agent PROMPTS
 * embed a JSON response schema as a template literal, and its keys sit at the
 * same two-space indent — so the obvious pattern also matched `"theme": {`,
 * `"scaffold": {`, `"governance": {` and five more from inside prompt text, and
 * reported eight perfectly healthy agents as unreachable. A real spec entry is
 * a multi-line object; the embedded schema is written inline. That difference
 * separates them exactly: 35 loose matches, 27 real ones.
 */
function roomIds(): Set<string> {
  const start = EDGE.indexOf("const FORMAL_ARTIFACT_AGENTS");
  expect(start, "FORMAL_ARTIFACT_AGENTS not found").toBeGreaterThan(-1);
  // Brace-matched rather than searched for `\n};`, so a nested object cannot
  // truncate the body and quietly shrink what this test covers.
  const open = EDGE.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < EDGE.length; i += 1) {
    if (EDGE[i] === "{") depth += 1;
    else if (EDGE[i] === "}") { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  const body = EDGE.slice(start, end);
  return new Set([...body.matchAll(/^ {2}"([a-z0-9-]+)": \{[ \t]*$/gm)].map((m) => m[1]));
}

describe("every registered agent can actually be called", () => {
  const door = doorIds();
  const room = roomIds();

  it("both lists were read — a regex that matched nothing would pass vacuously", () => {
    expect(door.size).toBeGreaterThan(30);
    expect(room.size).toBeGreaterThan(20);
  });

  it("prompt-embedded JSON schemas are NOT mistaken for agents", () => {
    // The near-miss that made the first version of this file cry wolf. These
    // are response-schema keys inside agent prompts, at the same indent as a
    // real spec, and they must never be demanded of the door.
    for (const notAnAgent of ["theme", "scaffold", "people", "process", "technology", "governance"]) {
      expect(room.has(notAnAgent), `${notAnAgent} is prompt text, not an agent`).toBe(false);
    }
  });

  it("NO agent is registered behind a door that will not open", () => {
    // THE DEFECT, generalised. This is the whole file.
    const unreachable = [...room].filter((id) => !door.has(id));
    expect(unreachable, `registered in FORMAL_ARTIFACT_AGENTS but missing from VALID_AGENT_IDS — the handler will 400 on these: ${unreachable.join(", ")}`).toEqual([]);
  });

  it("review-capture specifically, since that is the one that shipped broken", () => {
    expect(room.has("review-capture"), "no longer registered").toBe(true);
    expect(door.has("review-capture"), "unreachable again").toBe(true);
  });

  it("the newest agents are all reachable", () => {
    // Named rather than derived: these are the ones this session touched, and a
    // derived list would go quiet the moment the derivation broke.
    for (const id of ["review-capture", "demo-scripts", "experience-design", "prototype-build", "domain-ontology"]) {
      expect(door.has(id), `${id} cannot be invoked`).toBe(true);
    }
  });
});
