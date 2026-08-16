/**
 * THE FEATURE THAT HAD NO PRODUCER.
 *
 * A commit on this branch is named after "Region: Managed. Industry: Priority.
 * Tier: Standard." — the seeder's category pool answering three different fields
 * with each other's words. The CONSUMER was built and shipped: `generateSeed`
 * takes `opts.vocabulary`, the studio, the stakeholder's pilot and the refine
 * baseline all pass the stored artifact. And nothing anywhere WROTE one. Three
 * readers, zero writers: not the app, not an edge function, not the agent list,
 * not a migration. So the defect was still on every build, and the plumbing was
 * dead pipe.
 *
 * `prototypeValueVocabulary.test.ts` next door pins the consumer. This file pins
 * the PRODUCER, and it pins it as behaviour rather than as an announcement:
 *
 *   1. IT PRODUCES SOMETHING THE CONSUMERS ACTUALLY READ. The document the
 *      producer returns, filed under the key the readers read, changes what a
 *      stakeholder's own page says — checked on the rendered document, through
 *      `pilotSliceFor`, which is the code path the client's link runs.
 *   2. ONE CALL PER ONTOLOGY CHANGE, NEVER PER BUILD. The model is asked exactly
 *      once for a given ontology surface. A second run asks nothing. A rebuild
 *      asks nothing. Adding a field with no picklist asks nothing. Adding one
 *      WITH a picklist asks once more. The counter is the whole test.
 *   3. ABSENT IS STILL ABSENT, AND A BAD REPLY IS ABSENT TOO. A skip stores
 *      nothing; a reply that cannot be read stores a document that changes no
 *      value and does not lock the programme out of trying again.
 *   4. A MISS STAYS VISIBLE. Every field the vocabulary does not answer is named
 *      in the document's gaps, and every dropped key is named in its warnings.
 *
 * The model is never called: `produceValueVocabulary` takes its completion
 * function as an argument, so the request, the parse, the sanitiser, the
 * fingerprint gate and the stored document are all exercised here with a stub
 * that also counts how many times the producer decided to spend a call.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateSeed } from "@shared/seedData.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { pilotSliceFor } from "@shared/prototypePilot.ts";
import {
  ontologyVocabularyFingerprint,
  parseValueVocabulary,
  planValueVocabulary,
  produceValueVocabulary,
  resolveVocabulary,
  valueVocabularyDocument,
  vocabularyTargets,
  VOCABULARY_FIELD_KEY,
  type VocabularyRequest,
} from "@shared/valueVocabulary.ts";
import { loadPrototype } from "./helpers/renderPrototype";

const ROOT = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/** A small ontology of the same shape as a sales record system — small enough
 *  that the expected values can be stated exactly. */
const sales = {
  entities: [
    { name: "Client", attributes: ["name", "region", "industry", "tier", "owner"] },
    { name: "Deal", attributes: ["name", "stage", "amount", "closeDate", "client", "owner"] },
  ],
  relations: [{ from: "Client", to: "Deal", cardinality: "1:N" }],
} as unknown as Record<string, unknown>;
const salesVersion = deriveFabric(sales, {}).version;

const STAGES = ["Qualified", "Proposal", "Negotiation", "Closed-Won", "Closed-Lost"];
const REGIONS = ["North America", "Latin America", "EMEA", "APAC"];
const INDUSTRIES = ["Banking", "Healthcare", "Manufacturing", "Retail", "Public Sector"];

/** What a well-behaved model returns for `sales`: three of the four closed-set
 *  fields answered, `Client.tier` deliberately left out so the "a miss stays
 *  visible" claim has something real to be about. */
const MODEL_REPLY = JSON.stringify({
  "Client.region": REGIONS,
  "Client.industry": INDUSTRIES,
  "Deal.stage": STAGES,
});

/** A completion stub that records every request it was actually asked to
 *  complete. The count IS the "one call per ontology change" assertion. */
function stubModel(reply: string | ((request: VocabularyRequest) => string)) {
  const asked: VocabularyRequest[] = [];
  return {
    asked,
    complete: async (request: VocabularyRequest) => {
      asked.push(request);
      return typeof reply === "function" ? reply(request) : reply;
    },
  };
}

const innerWith = (ontology: unknown, vocabulary?: unknown): Record<string, unknown> => ({
  domainOntology: ontology,
  currentStateAtlas: {},
  ...(vocabulary === undefined ? {} : { [VOCABULARY_FIELD_KEY]: vocabulary }),
});

/** Deep-copy the fixture and add one attribute to Client. */
function salesPlus(attribute: string): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(sales)) as { entities: Array<{ name: string; attributes: string[] }> };
  copy.entities[0].attributes.push(attribute);
  return copy as unknown as Record<string, unknown>;
}

// ── 1 · the producer produces what the consumers read ────────────────────────

describe("the producer writes the artifact the seeder, the studio and the pilot read", () => {
  it("the produced document, stored under the key the readers read, reaches the stakeholder's page", async () => {
    // The end the defect was measured at: a rendered page. Not the assembler's
    // source and not the served string — the records ship as a data island and
    // the page's own script draws them, so this can only be read after the
    // document has run. And it goes through `pilotSliceFor`, which is the code
    // path behind the link a client opens, reading the blob key by name.
    const model = stubModel(MODEL_REPLY);
    const produced = await produceValueVocabulary(innerWith(sales), model.complete);
    expect(produced.status).toBe("generated");
    expect(produced.document).not.toBeNull();

    const slice = pilotSliceFor(innerWith(sales, produced.document));
    expect(slice.pilotGap, `the pilot refused to assemble: ${slice.pilotGap}`).toBeUndefined();
    const text = loadPrototype(slice.pilotHtml!).doc.body.textContent ?? "";
    expect(text.length).toBeGreaterThan(500);
    expect(STAGES.some((s) => text.includes(s)), "no produced stage value reached the stakeholder's page").toBe(true);
    expect(REGIONS.some((r) => text.includes(r)), "no produced region value reached the stakeholder's page").toBe(true);

    // …and the same record without the artifact does NOT carry them, so the
    // difference is the producer's output and not something the page prints
    // anyway. This is the defect, before and after, on one page.
    const bare = loadPrototype(pilotSliceFor(innerWith(sales)).pilotHtml!).doc.body.textContent ?? "";
    expect(STAGES.some((s) => bare.includes(s))).toBe(false);
    expect(REGIONS.some((r) => bare.includes(r))).toBe(false);
    expect(bare).toContain("Managed");   // the generic pool, still answering a region
  });

  it("the stored document is exactly what `resolveVocabulary` can read — no translation step", () => {
    // A producer whose output needs massaging before a consumer can read it is a
    // producer that will drift from its consumer. The document IS the artifact:
    // `values` and `ontology` are the two fields the resolver reads.
    const { document } = valueVocabularyDocumentFor(MODEL_REPLY);
    const resolved = resolveVocabulary(document, sales);
    expect(resolved, "the produced document resolved to no vocabulary at all").not.toBeNull();
    expect(resolved!.current, "the produced document does not declare this ontology's fingerprint").toBe(true);
    expect([...resolved!.values.get("Deal.stage")!]).toEqual(STAGES);
    expect(resolved!.covered.map((t) => t.key).sort()).toEqual(["Client.industry", "Client.region", "Deal.stage"]);
    expect(resolved!.missing.map((t) => t.key)).toEqual(["Client.tier"]);
    // Round-trips through the parser unchanged, which is what a stored-and-reloaded
    // artifact does on every later build.
    expect(parseValueVocabulary(document, sales).vocabulary.values).toEqual(document.values);
  });

  it("with the artifact the values are field-appropriate, and the build is still byte-identical run to run", async () => {
    const model = stubModel(MODEL_REPLY);
    const { document } = await produceValueVocabulary(innerWith(sales), model.complete);
    const { records } = generateSeed(sales, salesVersion, { vocabulary: document });
    const regions = new Set((records.Client ?? []).map((r) => r.region) as string[]);
    const stages = new Set((records.Deal ?? []).map((r) => r.stage) as string[]);
    expect(regions.size).toBeGreaterThan(1);
    expect([...regions].every((v) => REGIONS.includes(v)), `a region column said ${[...regions].join(", ")}`).toBe(true);
    expect([...stages].every((v) => STAGES.includes(v)), `a stage column said ${[...stages].join(", ")}`).toBe(true);
    // The generation happened ONCE, upstream. Three builds off the stored
    // document are the same bytes, and none of them asks a model anything.
    const builds = [0, 1, 2].map(() => assemblePrototype(sales, {}, undefined, { vocabulary: document }).html);
    expect(builds[1]).toBe(builds[0]);
    expect(builds[2]).toBe(builds[0]);
    expect(model.asked).toHaveLength(1);
  });
});

// ── 2 · one call per ONTOLOGY CHANGE, never per build ────────────────────────

describe("the model is asked once per ontology change and not once more", () => {
  it("a second run against the same ontology asks nothing and stores nothing", async () => {
    // MUTATION: make the final `run: false` in `planValueVocabulary` a `run: true`
    // → RED here, and every rebuild starts paying for a model call.
    const model = stubModel(MODEL_REPLY);
    const first = await produceValueVocabulary(innerWith(sales), model.complete);
    expect(model.asked).toHaveLength(1);

    const second = await produceValueVocabulary(innerWith(sales, first.document), model.complete);
    expect(model.asked, "the producer asked again for an ontology it had already answered").toHaveLength(1);
    expect(second.status).toBe("skipped");
    expect(second.document, "a skip must store nothing — a rewrite is a diff nobody made").toBeNull();
    expect(second.reason.length).toBeGreaterThan(20);
  });

  it("a changed ontology asks again — but only when the QUESTION changed", async () => {
    const model = stubModel(MODEL_REPLY);
    const first = await produceValueVocabulary(innerWith(sales), model.complete);
    expect(model.asked).toHaveLength(1);

    // A monetary attribute has no picklist: the ontology moved, the question did not.
    const moneyAdded = salesPlus("annualSpend");
    const unmoved = await produceValueVocabulary(innerWith(moneyAdded, first.document), model.complete);
    expect(unmoved.status, `a field with no closed set triggered a call: ${unmoved.reason}`).toBe("skipped");
    expect(model.asked).toHaveLength(1);

    // A category attribute is a new question, and it gets asked.
    const categoryAdded = salesPlus("segment");
    const moved = await produceValueVocabulary(innerWith(categoryAdded, first.document), model.complete);
    expect(moved.status).toBe("generated");
    expect(model.asked).toHaveLength(2);
    expect(model.asked[1].targets.map((t) => t.key)).toContain("Client.segment");
    // And the new document declares the NEW surface, so the next run settles again.
    expect(moved.document!.ontology).toBe(ontologyVocabularyFingerprint(categoryAdded));
    await produceValueVocabulary(innerWith(categoryAdded, moved.document), model.complete);
    expect(model.asked).toHaveLength(2);
  });

  it("an operator can force a regeneration; the automatic path cannot", async () => {
    const model = stubModel(MODEL_REPLY);
    const first = await produceValueVocabulary(innerWith(sales), model.complete);
    await produceValueVocabulary(innerWith(sales, first.document), model.complete);
    expect(model.asked).toHaveLength(1);
    const forced = await produceValueVocabulary(innerWith(sales, first.document), model.complete, { force: true });
    expect(forced.status).toBe("generated");
    expect(model.asked).toHaveLength(2);
  });

  it("the request asks about exactly the closed-set fields, and about nothing else", async () => {
    const model = stubModel(MODEL_REPLY);
    await produceValueVocabulary(innerWith(sales), model.complete);
    const [request] = model.asked;
    expect(request.targets.map((t) => t.key).sort()).toEqual(["Client.industry", "Client.region", "Client.tier", "Deal.stage"]);
    expect(request.user).toContain("stage");
    expect(request.user).not.toContain("closeDate");   // a date has no picklist
    expect(request.user).not.toContain("amount");      // nor does an amount
    expect(request.fingerprint).toBe(ontologyVocabularyFingerprint(sales));
  });
});

// ── 3 · absent stays absent, and a bad reply cannot corrupt a build ──────────

describe("nothing to answer, and answers that cannot be read", () => {
  it("no ontology and no closed-set field are both skips with a reason, and no call", async () => {
    const model = stubModel(MODEL_REPLY);
    const noOntology = await produceValueVocabulary({}, model.complete);
    expect(noOntology.status).toBe("skipped");
    expect(noOntology.reason).toMatch(/domain ontology/i);

    const noPicklists = { entities: [{ name: "Note", attributes: ["title", "body", "createdAt"] }] } as unknown as Record<string, unknown>;
    const nothingToAsk = await produceValueVocabulary(innerWith(noPicklists), model.complete);
    expect(nothingToAsk.status).toBe("skipped");
    expect(nothingToAsk.reason).toMatch(/nothing to ask for/i);

    // MUTATION: call `complete` before the plan is consulted → RED. This is the
    // line between "one call per ontology change" and "a call per run".
    expect(model.asked, "the producer spent a model call it had no question for").toHaveLength(0);
  });

  it("a reply the model could not give leaves the build byte-identical, and does not lock the programme out of retrying", async () => {
    // MUTATION: drop the `!usable` branch in `planValueVocabulary` → the retry
    // assertion goes RED, and one refusal freezes the programme on the generic
    // pool with no way back short of an ontology change.
    const refusal = stubModel("I'm afraid I can't help with that.");
    const produced = await produceValueVocabulary(innerWith(sales), refusal.complete);
    expect(produced.status).toBe("generated");
    expect(produced.document!.values).toEqual({});
    expect(produced.warnings.length, "an unreadable reply was stored without a word about it").toBeGreaterThan(0);

    // Stored, it changes nothing: the seeder's absent branch, byte for byte.
    expect(JSON.stringify(generateSeed(sales, salesVersion, { vocabulary: produced.document })))
      .toBe(JSON.stringify(generateSeed(sales, salesVersion)));
    expect(assemblePrototype(sales, {}, undefined, { vocabulary: produced.document }).html)
      .toBe(assemblePrototype(sales, {}).html);

    // And the next run tries again, because an artifact that answers nothing is
    // not an answer.
    const retry = stubModel(MODEL_REPLY);
    const second = await produceValueVocabulary(innerWith(sales, produced.document), retry.complete);
    expect(retry.asked, "a refusal was mistaken for a produced vocabulary").toHaveLength(1);
    expect(second.status).toBe("generated");
    expect(Object.keys(second.document!.values as Record<string, string[]>).sort())
      .toEqual(["Client.industry", "Client.region", "Deal.stage"]);
  });

  it("a reply full of junk is sanitised before it is ever stored", async () => {
    const junk = stubModel(JSON.stringify({
      "Deal.stage": ["Qualified", "qualified", "Proposal", 7, "", "Closed-Won"],
      "Client.region": ["EMEA"],                                  // one value prints one word down the column
      "Client.industry": ["Banking", "x".repeat(80), "Retail"],   // prose in a label field
      "Deal.amount": ["Big", "Small"],                            // a field with no picklist
      "Ghost.field": ["a", "b"],                                  // not in this ontology
    }));
    const { document, warnings } = await produceValueVocabulary(innerWith(sales), junk.complete);
    const values = document!.values as Record<string, string[]>;
    expect(values["Deal.stage"]).toEqual(["Qualified", "Proposal", "Closed-Won"]);
    expect(values["Client.industry"]).toEqual(["Banking", "Retail"]);
    expect(values["Client.region"]).toBeUndefined();
    expect(values["Deal.amount"]).toBeUndefined();
    expect(values["Ghost.field"]).toBeUndefined();
    for (const key of ["Client.region", "Deal.amount", "Ghost.field"]) {
      expect(warnings.some((w) => w.includes(key)), `nothing explains dropping ${key}`).toBe(true);
    }
  });
});

// ── 4 · a miss stays visible ────────────────────────────────────────────────

describe("what the vocabulary did not answer is on the document, not only in the seed", () => {
  it("every unanswered closed-set field is named in the document's gaps", async () => {
    // MUTATION: return `gaps: []` from `valueVocabularyDocument` → RED. A
    // half-answered vocabulary renders like a finished one; the gaps are the
    // only place the difference is written down at the artifact.
    const model = stubModel(MODEL_REPLY);
    const { document } = await produceValueVocabulary(innerWith(sales), model.complete);
    const gaps = (document!.gaps as string[]).join(" ");
    const answered = Object.keys(document!.values as Record<string, string[]>);
    for (const target of vocabularyTargets(sales)) {
      if (answered.includes(target.key)) {
        expect(gaps, `${target.key} was answered and still reported as a gap`).not.toContain(target.key);
      } else {
        expect(gaps, `${target.key} was left on the generic pool with nothing said about it`).toContain(target.key);
      }
    }
    expect(document!.summary).toBe("3 of 4 closed-set fields carry programme values");
    expect(document!.confidence).toBe(0.75);
  });

  it("a fully answered vocabulary reports no gaps — the claim is measured, not decorative", async () => {
    const full = stubModel(JSON.stringify({
      "Client.region": REGIONS,
      "Client.industry": INDUSTRIES,
      "Client.tier": ["Platinum", "Gold", "Silver"],
      "Deal.stage": STAGES,
    }));
    const { document } = await produceValueVocabulary(innerWith(sales), full.complete);
    expect(document!.gaps).toEqual([]);
    expect(document!.confidence).toBe(1);
  });
});

// ── 5 · the producer is REACHABLE — it is an agent the edge will run ─────────

describe("the producer is wired into the edge function, not merely written", () => {
  const EDGE = read("supabase/functions/run-agent/index.ts");

  it("`value-vocabulary` is an agent id the function accepts", () => {
    // The property is a property OF THE SOURCE: `run-agent` rejects any agentId
    // outside this set with a 400 before doing anything, so an id absent from
    // the set is an agent that cannot be run — which is exactly the state this
    // whole file exists to end. MUTATION: delete the id from the set → RED.
    const set = EDGE.match(/const VALID_AGENT_IDS = new Set\(\[[\s\S]*?\n\]\);/);
    expect(set, "VALID_AGENT_IDS is no longer a set literal — this guard must be rewritten").not.toBeNull();
    expect(set![0]).toContain('"value-vocabulary"');
  });

  it("the run reaches the shared producer, and the follow-on is the ontology's own completion", () => {
    // Not "the file mentions the module": the two call sites that make the
    // feature live — the transport calling `produceValueVocabulary`, and the
    // ontology's completion consulting `planValueVocabulary` before it schedules
    // anything. Either one missing is the dead-plumbing state.
    expect(EDGE).toContain('from "../_shared/valueVocabulary.ts"');
    expect(EDGE).toContain("produceValueVocabulary(");
    expect(EDGE).toContain("planValueVocabulary(");
    expect(EDGE).toContain("runValueVocabularyFollowOn(");
    // The write goes to the key the readers read, by the shared constant rather
    // than by a second spelling of the string.
    expect(EDGE).toContain("VOCABULARY_FIELD_KEY");
    expect(VOCABULARY_FIELD_KEY).toBe("prototypeValueVocabulary");
  });

  it("the vocabulary is filed in the movement that owns the ontology it answers", () => {
    // One home, and it must be the ontology's: the artifact is only meaningful
    // beside the fields it supplies values for. If the ontology moves movement
    // and this does not, the two documents part company in the record.
    const ontologyPhase = EDGE.match(/"domain-ontology": \{\s*\n\s*phase: "([a-z-]+)"/);
    const vocabularyPhase = EDGE.match(/const VALUE_VOCABULARY_PHASE = "([a-z-]+)"/);
    expect(ontologyPhase, "could not read the domain-ontology agent's phase").not.toBeNull();
    expect(vocabularyPhase, "could not read VALUE_VOCABULARY_PHASE").not.toBeNull();
    expect(vocabularyPhase![1]).toBe(ontologyPhase![1]);
  });

  it("the studio and the stakeholder's pilot read the key the producer writes", () => {
    // The consumers were already there; what was missing was a writer. Pin that
    // all three now name the same field.
    expect(read("src/v3/components/flow/studio/PrototypeStudio.tsx")).toContain(VOCABULARY_FIELD_KEY);
    expect(read("supabase/functions/_shared/prototypePilot.ts")).toContain(VOCABULARY_FIELD_KEY);
  });
});

/** Build the document the producer would store for a given reply, without the
 *  plan in the way — used where the assertion is about the DOCUMENT's shape. */
function valueVocabularyDocumentFor(reply: string): { document: Record<string, unknown> } {
  return { document: valueVocabularyDocument(parseValueVocabulary(reply, sales), sales) };
}

// ── 6 · the fingerprint gate, stated on its own ─────────────────────────────

describe("the plan says why, every time", () => {
  it("never returns an empty reason, whatever the record looks like", async () => {
    const model = stubModel(MODEL_REPLY);
    const { document } = await produceValueVocabulary(innerWith(sales), model.complete);
    const cases: Array<[string, Record<string, unknown>]> = [
      ["an empty record", {}],
      ["an ontology with no closed sets", innerWith({ entities: [{ name: "Note", attributes: ["body"] }] })],
      ["a fresh ontology", innerWith(sales)],
      ["an answered ontology", innerWith(sales, document)],
      ["a stale vocabulary", innerWith(salesPlus("segment"), document)],
      ["an unreadable vocabulary", innerWith(sales, { kind: "value-vocabulary", ontology: "x", values: {} })],
    ];
    for (const [label, inner] of cases) {
      const plan = planValueVocabulary(inner);
      expect(plan.reason.length, `${label} produced a plan with no reason`).toBeGreaterThan(20);
      expect(plan.run ? plan.request : plan.request === null, `${label}: run and request disagree`).toBeTruthy();
    }
    // And the stale case is a RUN, not a silent read of last month's values.
    expect(planValueVocabulary(innerWith(salesPlus("segment"), document)).run).toBe(true);
    expect(planValueVocabulary(innerWith(sales, document)).run).toBe(false);
  });
});
