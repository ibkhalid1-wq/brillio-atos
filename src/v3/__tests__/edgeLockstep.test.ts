/**
 * Client ↔ edge lockstep — the contracts that must never drift.
 *
 * The edge function mirrors several client-side derivations byte-for-byte
 * (staleness fingerprints) or key-for-key (industry vocabulary steering,
 * value-chain segments). These tests parse BOTH source files and compare, so
 * a change on one side fails CI until the other side moves with it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { INDUSTRY_OPTIONS, INDUSTRY_SEGMENTS, ATOS_FLOW } from "@/v3/lib/methodology";
import {
  KIT_AGENDA_CACHE_VERSION, KIT_AGENDA_CACHE_FIELD, KIT_AGENDA_CACHE_NOTE, readKitAgendaCache,
} from "@/v3/lib/ledger/kitAgendaCache";

const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");

describe("industry vocabulary steering covers the client's industry list", () => {
  const block = EDGE.match(/INDUSTRY_VOCABULARY_STEERING[^=]*=\s*\{([\s\S]*?)\n\};/);
  const edgeKeys = block ? [...block[1].matchAll(/\n\s*"([^"]+)":/g)].map((m) => m[1]) : [];

  it("every client industry option has a steering line on the edge", () => {
    expect(block).toBeTruthy();
    const missing = INDUSTRY_OPTIONS.map((opt) => opt.toLowerCase()).filter((key) => !edgeKeys.includes(key));
    expect(missing).toEqual([]);
  });

  it("the edge has no steering keys the client no longer offers", () => {
    const client = new Set(INDUSTRY_OPTIONS.map((opt) => opt.toLowerCase()));
    expect(edgeKeys.filter((key) => !client.has(key))).toEqual([]);
  });
});

describe("value-chain segment tables match key-for-key", () => {
  const block = EDGE.match(/INDUSTRY_SEGMENT_STEERING[^=]*=\s*\{([\s\S]*?)\n\};/);

  it("edge segment industries and segments mirror INDUSTRY_SEGMENTS exactly", () => {
    expect(block).toBeTruthy();
    const edgeMap: Record<string, string[]> = {};
    for (const match of block![1].matchAll(/\n {2}"([^"]+)": \{([\s\S]*?)\n {2}\}/g)) {
      edgeMap[match[1]] = [...match[2].matchAll(/\n {4}"([^"]+)":/g)].map((m) => m[1]).sort();
    }
    const clientMap = Object.fromEntries(
      Object.entries(INDUSTRY_SEGMENTS).map(([industry, segments]) => [
        industry.toLowerCase(),
        segments.map((segment) => segment.toLowerCase()).sort(),
      ]),
    );
    expect(edgeMap).toEqual(clientMap);
  });
});

describe("staleness fingerprint algorithm is mirrored byte-compatibly", () => {
  it("the edge hashes the same shape with the same djb2 xor variant", () => {
    // The client derivation (flowShellData.movementInputsFingerprint): key-sorted
    // [key, value] pairs, `_`-prefixed keys excluded, djb2 ((h*33)^c)>>>0, hex.
    expect(EDGE).toMatch(/filter\(\(key\) => !key\.startsWith\("_"\)\)\.sort\(\)/);
    expect(EDGE).toMatch(/hash \* 33\) \^ .*charCodeAt/);
    expect(EDGE).toMatch(/toString\(16\)/);
  });
});

describe("conflicts route to the Inbox (propose-then-confirm)", () => {
  it("atlas-detected contradictions are stripped from the doc and queued as a decision", () => {
    // The stored Atlas never keeps a contradictions section…
    expect(EDGE).toMatch(/delete \(formalResult as Record<string, unknown>\)\.contradictions/);
    // …and what it found queues as a contradictionEntries decision, deduped
    // against any open filing.
    const routing = EDGE.slice(EDGE.indexOf("atlasContradictions.length && isFlowProgramme"));
    expect(routing.slice(0, 1500)).toContain("queueFlowDecision");
    expect(routing.slice(0, 1500)).toContain("contradictionEntries");
  });

  it("the contradiction watcher proposes — one open filing at a time", () => {
    const block = EDGE.slice(EDGE.indexOf('agentId === "contradiction-watcher"') - 500);
    expect(block.slice(0, 2500)).toContain("queueFlowDecision");
    expect(block.slice(0, 2500)).toContain("contradictionEntries");
  });
});

describe("studio document order matches the edge output contracts", () => {
  // Both sides parsed from source: the studio registry names the sections it
  // renders (docOrder); each edge agent's system prompt embeds the JSON
  // template it must emit. Every rendered section must exist in the contract,
  // or the studio typesets keys the generator never produces.
  const STUDIOS = readFileSync(resolve(__dirname, "../components/flow/studio/studios.tsx"), "utf8");
  const entries = [...STUDIOS.matchAll(/"([a-z-]+)": \{ fieldKey: flowFieldKey\("[a-z-]+"\), docOrder: \[([^\]]+)\]/g)]
    .map((match) => [match[1], [...match[2].matchAll(/"([^"]+)"/g)].map((m) => m[1])] as const);

  it("the registry parse found every studio with a document order", () => {
    expect(entries.length).toBeGreaterThanOrEqual(12);
  });

  it.each(entries.map(([id, keys]) => ({ id, keys })))(
    "the $id contract emits every section its studio renders",
    ({ id, keys }) => {
      const start = EDGE.search(new RegExp(`\\n {2}"${id}": \\{\\n {4}phase:`));
      expect(start, `edge agent block for ${id}`).toBeGreaterThan(-1);
      const rest = EDGE.slice(start + 4);
      const next = rest.search(/\n {2}"[a-z-]+": \{\n {4}phase:/);
      const block = next > -1 ? rest.slice(0, next) : rest.slice(0, 12000);
      const missing = keys.filter((key) => !block.includes(`"${key}"`));
      expect(missing).toEqual([]);
    },
  );
});

describe("the Discovery Kit guarantees coverage-roster inclusion", () => {
  it("unions every rostered person into the kit's interviews, deterministically", () => {
    // A prompt promise is not a guarantee — the edge must fold the coverage
    // roster into interviews after generation so no known stakeholder is dropped.
    const block = EDGE.slice(EDGE.indexOf('request.agentId === "discovery-kit"'));
    expect(block.slice(0, 2400)).toContain("interviewRoster");
    expect(block.slice(0, 2400)).toContain("present.has(norm(name))");
    expect(block.slice(0, 2400)).toContain("interviews: [...interviews, ...added]");
  });

  it("the kit prompt names the roster as a seed source", () => {
    expect(EDGE).toContain('knownStakeholder');
    expect(EDGE).toMatch(/Every named person on that roster MUST get an interview/);
  });
});

describe("evidence pipeline guards stay wired (2026-07-14 regression pins)", () => {
  // The shrunken-ontology incident had three compounding causes; each now has
  // a source-level pin so a refactor can't quietly remove the guard.
  it("synthesis agents receive the full conversation record", () => {
    const block = EDGE.match(/CONVERSATION_RECORD_AGENTS = new Set<string>\(\[([\s\S]*?)\]\)/);
    expect(block).toBeTruthy();
    for (const id of ["charter", "discovery-kit", "domain-ontology", "current-state-atlas"]) {
      expect(block![1]).toContain(`"${id}"`);
    }
    expect(EDGE).toContain("conversationRecord: buildConversationRecord(inner)");
  });

  it("evidence-scaled documents keep the tall output ceiling", () => {
    const block = EDGE.match(/LARGE_OUTPUT_AGENTS = new Set<string>\(\[([\s\S]*?)\]\)/);
    expect(block).toBeTruthy();
    for (const id of [
      "discovery-kit", "demo-scripts", "domain-ontology", "current-state-atlas",
      "architecture-strategy", "agentic-blueprint", "experience-design", "prototype-pack", "prototype-build", "hardening-plan", "eval-suite",
    ]) {
      expect(block![1]).toContain(`"${id}"`);
    }
  });

  it("the shrink guard covers the coverage-bearing artifacts", () => {
    expect(EDGE).toContain('"domain-ontology": ["entities", "relations"]');
    expect(EDGE).toContain('"current-state-atlas": ["workflows"]');
    expect(EDGE).toContain('"discovery-kit": ["interviews"]');
    expect(EDGE).toContain('"agentic-blueprint": ["agents"]');
  });

  it("every generation stamps its input-coverage receipt", () => {
    expect(EDGE).toContain("inputCoverage: {");
    expect(EDGE).toContain("conversationRecordChars:");
    expect(EDGE).toContain("outputRepaired");
  });
});

// ── O-19 · the kit generator is the LAST producer of question text ──────────
//
// Question TEXT has one producer (`renderQuestion.ts` over the ledger). The kit
// generator predates it and emits agenda strings. It cannot render from loci —
// the kit is a FRAME artifact and every ledger element comes from the LISTEN
// ontology/atlas, so at generation time there are no loci to render. What it CAN
// do is stop the strings masquerading as a source: demote them into the same
// versioned cache the client writes, so both producers leave ONE shape.
//
// The Deno boundary prevents a shared import, so the edge mirrors the shape and
// this pins it (the edgeLockstep idiom). The behavioural half EXTRACTS the edge's
// own `demoteKitAgendas` and reads its output back through the CLIENT's
// `readKitAgendaCache` — proving the two sides agree in fact, not just in text.
describe("kit agenda cache — client ↔ edge lockstep (O-19)", () => {
  const start = EDGE.indexOf("const KIT_AGENDA_CACHE_VERSION");
  const end = EDGE.indexOf("/**\n * Mark every artifact that CONSUMES this one as stale.");
  const section = EDGE.slice(start, end);

  it("the edge mirrors the client's cache field and version", () => {
    expect(start, "edge KIT_AGENDA_CACHE_VERSION not found").toBeGreaterThan(-1);
    expect(section).toContain(`const KIT_AGENDA_CACHE_VERSION = ${KIT_AGENDA_CACHE_VERSION};`);
    expect(section).toContain(`const KIT_AGENDA_CACHE_FIELD = "${KIT_AGENDA_CACHE_FIELD}";`);
  });

  it("the edge NEVER stamps the provenance note — it has no loci to back it", () => {
    // The note claims the ledger produced these strings; the loci are the
    // evidence. Written apart, the generator's own text would carry a provenance
    // claim nothing can check. The miss must stay visible as `loci: []`.
    expect(section).not.toContain(KIT_AGENDA_CACHE_NOTE);
    expect(section).toContain("loci: []");
  });

  it("the demotion is wired into the kit path AFTER both synthesis fallbacks", () => {
    // Demoting before the roster/persona stubs are appended would let them
    // re-introduce inline `agenda[].questions` and the paths would diverge again.
    const call = EDGE.indexOf("demoteKitAgendas(formalResult");
    const personaAdds = EDGE.indexOf("if (personaAdds.length) {");
    const rosterAdds = EDGE.indexOf("if (added.length) {");
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(personaAdds);
    expect(call).toBeGreaterThan(rosterAdds);
  });

  it("the edge's demotion output reads back through the CLIENT's accessor", () => {
    const js = ts.transpileModule(
      `const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);\n${section}\n` +
      `return { demoteKitAgendas };`,
      { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } },
    ).outputText;
    const { demoteKitAgendas } = new Function(js)() as {
      demoteKitAgendas: (kit: Record<string, unknown>, at: string) => Record<string, unknown>;
    };
    const kit = {
      interviews: [{
        stakeholder: "Dana Ruiz",
        agenda: [
          { minutes: 20, topic: "How quoting runs today", questions: ["Walk me through a quote.", "Where does it stall?"] },
          { minutes: 25, topic: "Artifacts", questions: ["What can you share?"] },
        ],
      }],
    };
    const out = demoteKitAgendas(kit, "2026-08-10T00:00:00Z");
    const interview = (out.interviews as unknown[])[0] as Record<string, unknown>;

    // The client reads it as a CACHE — not as legacy inline strings.
    const cache = readKitAgendaCache(interview);
    expect(cache.origin).toBe("cache");
    expect(cache.version).toBe(KIT_AGENDA_CACHE_VERSION);
    expect(cache.questions).toEqual(["Walk me through a quote.", "Where does it stall?", "What can you share?"]);
    // No loci — and therefore the miss stays visible rather than papered over.
    expect(cache.loci).toEqual([]);
    expect((interview[KIT_AGENDA_CACHE_FIELD] as Record<string, unknown>).note).toBeUndefined();

    // The agenda blocks survive — a 45-minute shape is the conversation's
    // design — but they stop carrying text that reads like a source.
    const blocks = interview.agenda as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.topic)).toEqual(["How quoting runs today", "Artifacts"]);
    expect(blocks.every((b) => b.questions === undefined)).toBe(true);

    // Idempotent: a regenerated kit never gets a fresh timestamp on strings
    // nobody touched.
    const again = demoteKitAgendas(out, "2026-08-11T00:00:00Z");
    expect(readKitAgendaCache((again.interviews as unknown[])[0]).at).toBe("2026-08-10T00:00:00Z");
  });
});

// ── O-20 · a declared input must be CONSUMED, not just declared ─────────────
//
// `systemsOfRecord` (methodology.ts, Frame) declares
// `usedByArtifacts: ["domain-ontology", "current-state-atlas"]`. The sponsor's
// names already reach the model: for every formal agent, groundingFacts merges
// the FRAME inputs with the target phase's own. So the declaration was true
// about the plumbing and false about the prompts — neither consumed it. These
// pin that both now do, and that consuming it never licenses a fabrication.
describe("declared systemsOfRecord is consumed by the artifacts that claim it (O-20)", () => {
  const frame = ATOS_FLOW.phases.find((p) => p.id === "frame");
  const field = frame?.inputFields?.find((f) => f.id === "systemsOfRecord");
  const promptFor = (agentId: string): string => {
    const from = EDGE.indexOf(`  "${agentId}": {\n    phase:`);
    return from < 0 ? "" : EDGE.slice(from, EDGE.indexOf("\n  },\n", from));
  };

  it("the frame field still declares its two consumers", () => {
    expect(field, "systemsOfRecord field not found on Frame").toBeTruthy();
    expect(field!.usedByArtifacts).toEqual(["domain-ontology", "current-state-atlas"]);
  });

  it("the FRAME inputs really do reach a LISTEN artifact's groundingFacts", () => {
    // The plumbing half of the claim — without this merge the prompts below
    // would be asking the model to read a fact it never receives.
    expect(EDGE).toContain(
      "...buildGroundingFacts(Object.keys(phaseInputs).length ? { ...frameInputs, ...phaseInputs } : frameInputs),",
    );
  });

  it("every declared consumer's prompt actually reads the field", () => {
    for (const agentId of field!.usedByArtifacts!) {
      const prompt = promptFor(agentId);
      expect(prompt, `no prompt block for ${agentId}`).not.toBe("");
      expect(prompt, `${agentId} never names the systemsOfRecord grounding fact`)
        .toContain("DECLARED SYSTEMS OF RECORD");
      expect(prompt).toContain('"systemsOfRecord" fact');
      // Named systems are used VERBATIM — a renamed system reads downstream as
      // a second, unknown one and opens a duplicate ask.
      expect(prompt).toContain("VERBATIM");
    }
  });

  it("consuming the list never licenses inventing a system or a use for one", () => {
    const ontology = promptFor("domain-ontology");
    // Being on the list is not evidence that any entity lives there.
    expect(ontology).toContain("leave systemOfRecord null and raise a gap");
    expect(ontology).toContain("Never invent a system");

    const atlas = promptFor("current-state-atlas");
    // The sponsor named the system, not its use and not its faults.
    expect(atlas).toContain("leave complaints EMPTY until a stakeholder voices one");
    // Knowing the business runs on a system is not knowing which step touches it.
    expect(atlas).toContain("steps[].system stays null unless the evidence places that system at that step");
  });
});

// ── the ambiguity `resolution` field must not accept a restated question ────────────
/**
 * THE DEFECT THIS PINS. `resolution` was specified as "proposed resolution or
 * 'unresolved'", and the generator wrote a restated QUESTION into it — on the real Laila
 * snapshot, both collisions read "To confirm if 'Account' always refers to…".
 *
 * The reader's predicate is `!resolution || /unresolved/i`, so a sentence that merely
 * *describes* the collision does not match "unresolved" and is therefore counted as a
 * RESOLUTION. The ambiguity is marked settled, nobody is ever asked, and the approval gate
 * that should have held opens. A field that accepts the question as its own answer is the
 * fabrication shape this codebase exists to prevent — the miss did not stay visible.
 *
 * Fixing the READER would mean guessing at English intent ("To confirm…", "Need to
 * check…"), which silently reclassifies stored data. So the fix is at the SOURCE: the
 * schema now demands the literal 'unresolved' or an ADOPTED meaning, and says plainly that
 * a restated question is the collision, not its resolution.
 */
describe("ambiguities: 'resolution' cannot be the question restated", () => {
  const RUN_AGENT = readFileSync(
    resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");

  it("the schema demands the literal 'unresolved' or an adopted meaning", () => {
    const line = RUN_AGENT.split("\n").find((l) => l.includes('"ambiguities": [ {'));
    expect(line, "the ambiguities schema line is gone — find where it moved").toBeTruthy();
    expect(line!).toMatch(/exact string 'unresolved'/);
    expect(line!).toMatch(/adopt/i);
  });

  it("…and says explicitly that a restated question is NOT one", () => {
    const line = RUN_AGENT.split("\n").find((l) => l.includes('"ambiguities": [ {'))!;
    expect(line).toMatch(/NEVER a restated question/);
    // the loose old wording must be gone, or the model has both contracts to choose from
    expect(line).not.toMatch(/"proposed resolution or 'unresolved'"/);
  });

  it("the prose explains WHY, so the rule survives a reword", () => {
    // A schema rule with no reason attached gets 'simplified' by the next editor.
    expect(RUN_AGENT).toMatch(/silently closes it/);
    expect(RUN_AGENT).toMatch(/only resolved when one meaning is ADOPTED/i);
  });
});
