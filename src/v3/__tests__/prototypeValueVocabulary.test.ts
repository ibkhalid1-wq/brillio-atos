/**
 * "REGION: MANAGED. INDUSTRY: PRIORITY. TIER: STANDARD."
 *
 * Three fields on one screen of a reviewed CRM build, each printing a word that
 * belongs to a different field, because every category-shaped column in the
 * ontology drew from ONE pool of twelve neutral labels. The mechanism was
 * invisible and the effect was not: a stakeholder reads the value, and what they
 * read was a system that does not know what a region is.
 *
 * The fix is a per-programme VALUE VOCABULARY — one model call per ONTOLOGY
 * CHANGE, stored as `{ "Entity.attribute": ["plausible","values"] }` next to the
 * ontology it answers, consumed by the deterministic seeder as an input. This
 * file pins the four things that have to be true of that, each of which is a way
 * it could quietly fail:
 *
 *   1. ABSENT IS UNCHANGED. No artifact, an empty one, a corrupt one, or one
 *      answering only fields this ontology no longer has — the build is byte for
 *      byte what it was, and every category field is back on the shared pool.
 *   2. PRESENT IS FIELD-APPROPRIATE, AND ONLY WHERE IT SPEAKS. A covered column
 *      holds its own values; an uncovered column does not move by a single byte,
 *      which is what proves the draw was not re-sequenced underneath it.
 *   3. THE BUILD IS STILL REPRODUCIBLE. A vocabulary is data. Two builds of one
 *      ontology are identical with it, exactly as they are without it.
 *   4. A MISS STAYS VISIBLE. A vocabulary that is partial, or older than the
 *      ontology it is read against, looks identical on screen to one that is
 *      right. Both are declared in the assumptions that go to Listen.
 *
 * The generation path is exercised end to end WITHOUT A MODEL: the request is a
 * value and the completion function is an argument, so the prompt, the parse,
 * the sanitiser and the fingerprint are all under test here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateSeed } from "@shared/seedData.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import {
  generateValueVocabulary,
  ontologyVocabularyFingerprint,
  parseValueVocabulary,
  resolveVocabulary,
  vocabularyRequest,
  vocabularyTargets,
} from "@shared/valueVocabulary.ts";
import { loadPrototype } from "./helpers/renderPrototype";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8")) as Record<string, unknown>;
const ontology = snap("domain-ontology.json");
const atlas = snap("current-state-atlas.json");
const version = deriveFabric(ontology, atlas).version;

/** A small ontology of the same SHAPE as a sales record system, written here so
 *  the vocabulary can be stated exactly and the assertions can be about values
 *  rather than about a fixture nobody controls. */
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
const vocabulary = {
  kind: "value-vocabulary",
  ontology: ontologyVocabularyFingerprint(sales),
  values: { "Client.region": REGIONS, "Client.industry": INDUSTRIES, "Deal.stage": STAGES },
};

const column = (records: ReturnType<typeof generateSeed>["records"], entity: string, attribute: string): unknown[] =>
  (records[entity] ?? []).map((r) => r[attribute]);

// ── 1 · absent is exactly as it was ──────────────────────────────────────────

describe("with no vocabulary artifact, the build is what it always was", () => {
  it("an absent, empty, corrupt or irrelevant artifact all produce the identical seed", () => {
    // MUTATION: make `resolveVocabulary` return a live (empty) lookup instead of
    // null, or consume a PRNG step while resolving → RED on every line here.
    const baseline = JSON.stringify(generateSeed(ontology, version));
    const equivalents: unknown[] = [
      undefined,
      null,
      {},
      { values: {} },
      "not json at all",
      "```json\n{\n```",
      { kind: "value-vocabulary", values: { "Nonexistent Entity.nope": ["a", "b"] } },
      // Answers a real field with an unusable list — one value is not a picklist.
      { values: { "Account.region": ["Managed"] } },
    ];
    for (const v of equivalents) {
      expect(JSON.stringify(generateSeed(ontology, version, { vocabulary: v })), `vocabulary ${JSON.stringify(v)} changed the build`)
        .toBe(baseline);
    }
  });

  it("every category field in a 33-entity ontology still shares ONE small pool — the defect, stated", () => {
    // This is the reviewed build's actual failure expressed as a measurement:
    // dozens of category columns across dozens of entities, and between them a
    // couple of handfuls of distinct words. It must stay true with no artifact
    // (that is what "unchanged" means) and it is what the artifact undoes.
    const { records } = generateSeed(ontology, version);
    const categoryFields = vocabularyTargets(ontology).filter((t) => t.role === "category");
    expect(categoryFields.length, "the fixture has no category fields to measure").toBeGreaterThan(10);
    const distinct = new Set<string>();
    for (const t of categoryFields) for (const v of column(records, t.entity, t.attribute)) if (typeof v === "string") distinct.add(v);
    expect(distinct.size).toBeLessThanOrEqual(12);
  });
});

// ── 2 · present is field-appropriate, and moves nothing else ─────────────────

describe("with the artifact, values belong to their own field", () => {
  const withVocab = generateSeed(sales, salesVersion, { vocabulary });
  const without = generateSeed(sales, salesVersion);

  it("each covered column holds only its own supplied values", () => {
    // MUTATION: drop the `listed ?? POOL` branch from `valueFor`'s category or
    // status case → RED, and the columns go back to speaking each other's words.
    for (const [entity, attribute, allowed] of [
      ["Client", "region", REGIONS],
      ["Client", "industry", INDUSTRIES],
      ["Deal", "stage", STAGES],
    ] as const) {
      const seen = column(withVocab.records, entity, attribute).filter((v) => typeof v === "string");
      expect(seen.length, `${entity}.${attribute} produced no rows`).toBeGreaterThan(5);
      const foreign = [...new Set(seen as string[])].filter((v) => !allowed.includes(v));
      expect(foreign, `${entity}.${attribute} rendered values from somewhere else: ${foreign.join(", ")}`).toEqual([]);
    }
  });

  it("no field prints another field's vocabulary — the shuffle is over", () => {
    const regions = new Set(column(withVocab.records, "Client", "region") as string[]);
    const industries = new Set(column(withVocab.records, "Client", "industry") as string[]);
    expect([...regions].filter((v) => industries.has(v))).toEqual([]);
    expect([...regions].every((v) => REGIONS.includes(v))).toBe(true);
  });

  it("an UNCOVERED column does not move by a byte — the draw was not re-sequenced", () => {
    // The subtle way this feature breaks everything: spend one extra PRNG step
    // when a vocabulary exists and every later value in the entity shifts, so a
    // vocabulary for one field silently rewrites the whole build.
    // MUTATION: add a `rnd()` call to the vocabulary branch of `valueFor` → RED.
    expect(column(withVocab.records, "Client", "tier")).toEqual(column(without.records, "Client", "tier"));
    expect(column(withVocab.records, "Deal", "amount")).toEqual(column(without.records, "Deal", "amount"));
    expect(column(withVocab.records, "Deal", "closeDate")).toEqual(column(without.records, "Deal", "closeDate"));
    expect(column(withVocab.records, "Deal", "owner")).toEqual(column(without.records, "Deal", "owner"));
    expect(withVocab.records.Deal.map((r) => r.id)).toEqual(without.records.Deal.map((r) => r.id));
  });

  it("the build stays reproducible — a vocabulary is an input, not a generation step", () => {
    const a = assemblePrototype(sales, {}, undefined, { vocabulary });
    const b = assemblePrototype(sales, {}, undefined, { vocabulary });
    expect(a.html).toBe(b.html);
    expect(a.fabric.version).toBe(b.fabric.version);
    // The fabric does not move: the vocabulary is content, and content is not structure.
    expect(a.fabric.version).toBe(assemblePrototype(sales, {}).fabric.version);
  });

  it("the values reach the rendered page, read from the document a browser built", () => {
    // Not a regex over the assembler's source, and not over the served string
    // either — the records ship as a data island and the page draws them, so the
    // question "does a stage column say Closed-Won" can only be answered after
    // the page's own script has run.
    const { doc } = loadPrototype(assemblePrototype(sales, {}, undefined, { vocabulary }).html);
    const text = doc.body.textContent ?? "";
    expect(text.length).toBeGreaterThan(500);
    expect(STAGES.some((s) => text.includes(s)), "no supplied stage value reached the page").toBe(true);
    expect(REGIONS.some((r) => text.includes(r)), "no supplied region value reached the page").toBe(true);
    // And the same page built without the artifact does not carry them — the
    // difference is the artifact, not something the assembler prints anyway.
    const plain = loadPrototype(assemblePrototype(sales, {}).html).doc.body.textContent ?? "";
    expect(STAGES.some((s) => plain.includes(s))).toBe(false);
  });
});

// ── 3 · the one model call, without a model ──────────────────────────────────

describe("the generator: one call per ontology change, testable without a model", () => {
  it("asks about exactly the fields whose values are a closed set", () => {
    const req = vocabularyRequest(sales);
    expect(req.targets.map((t) => t.key).sort()).toEqual(["Client.industry", "Client.region", "Client.tier", "Deal.stage"]);
    // Never about a name, an amount or a date — those have no picklist.
    expect(req.user).not.toContain("closeDate");
    expect(req.user).toContain("stage");
    expect(req.user).toContain("Client");
  });

  it("the fingerprint moves when the QUESTION moves, and not otherwise", () => {
    // This is what makes "one call per ontology change, not per build" checkable
    // rather than a habit somebody remembers.
    const same = JSON.parse(JSON.stringify(sales)) as typeof sales;
    expect(ontologyVocabularyFingerprint(same)).toBe(ontologyVocabularyFingerprint(sales));
    const moneyAdded = JSON.parse(JSON.stringify(sales)) as { entities: Array<{ name: string; attributes: string[] }> };
    moneyAdded.entities[0].attributes.push("annualSpend");   // monetary — no picklist, no new question
    expect(ontologyVocabularyFingerprint(moneyAdded as unknown as Record<string, unknown>)).toBe(ontologyVocabularyFingerprint(sales));
    const categoryAdded = JSON.parse(JSON.stringify(sales)) as { entities: Array<{ name: string; attributes: string[] }> };
    categoryAdded.entities[0].attributes.push("segment");    // a new closed set → a new question
    expect(ontologyVocabularyFingerprint(categoryAdded as unknown as Record<string, unknown>)).not.toBe(ontologyVocabularyFingerprint(sales));
  });

  it("sanitises the reply: unknown keys, junk values and one-item lists are dropped, with reasons", async () => {
    const reply = JSON.stringify({
      "Deal.stage": ["Qualified", "qualified", "Proposal", 7, "", "Closed-Won"],
      "Client.region": ["EMEA"],                                   // a one-item picklist prints one word down the column
      "Client.industry": ["Banking", "x".repeat(80), "Retail"],    // prose in a label field
      "Deal.amount": ["Big", "Small"],                             // a field with no picklist
      "Ghost.field": ["a", "b"],                                   // not in this ontology at all
    });
    const out = await generateValueVocabulary(sales, async () => reply);
    expect(out.vocabulary.values["Deal.stage"]).toEqual(["Qualified", "Proposal", "Closed-Won"]);
    expect(out.vocabulary.values["Client.industry"]).toEqual(["Banking", "Retail"]);
    expect(out.vocabulary.values["Client.region"]).toBeUndefined();
    expect(out.vocabulary.values["Deal.amount"]).toBeUndefined();
    expect(out.vocabulary.values["Ghost.field"]).toBeUndefined();
    expect(out.vocabulary.ontology).toBe(ontologyVocabularyFingerprint(sales));
    // Nothing is dropped in silence.
    for (const key of ["Client.region", "Deal.amount", "Ghost.field"]) {
      expect(out.warnings.some((w) => w.includes(key)), `no warning explains dropping ${key}`).toBe(true);
    }
  });

  it("reads a fenced reply, and refuses a reply it cannot read", async () => {
    const fenced = await generateValueVocabulary(sales, async () => "```json\n{\"Deal.stage\":[\"Open\",\"Won\"]}\n```");
    expect(fenced.vocabulary.values["Deal.stage"]).toEqual(["Open", "Won"]);
    const broken = parseValueVocabulary("I'm afraid I can't do that", sales);
    expect(Object.keys(broken.vocabulary.values)).toEqual([]);
    expect(broken.warnings.length).toBeGreaterThan(0);
    expect(resolveVocabulary("I'm afraid I can't do that", sales)).toBeNull();
  });

  it("the vocabulary module itself calls no model — the transport is the caller's", () => {
    // The generation path takes its completion function as an argument. If this
    // module ever imports a client directly, a build could make a network call
    // and determinism would be gone; so the absence is pinned, not assumed.
    const src = readFileSync(resolve(__dirname, "../../../supabase/functions/_shared/valueVocabulary.ts"), "utf8");
    expect(/from "\.\/claudeClient/.test(src)).toBe(false);
    expect(/fetch\(/.test(src)).toBe(false);
  });
});

// ── 4 · a miss stays visible ─────────────────────────────────────────────────

describe("a vocabulary that is partial or stale says so", () => {
  it("fields left on the generic pool are named as a Listen question", () => {
    // MUTATION: delete the `vocabulary.missing.length` assumption → RED. A demo
    // showing "Tier: Standard" beside "Region: EMEA" looks finished; the only
    // thing that says otherwise is this line.
    const partial = { kind: "value-vocabulary", ontology: ontologyVocabularyFingerprint(sales), values: { "Deal.stage": STAGES } };
    const { assumptions } = generateSeed(sales, salesVersion, { vocabulary: partial });
    const declared = assumptions.filter((a) => a.kind === "value-vocabulary");
    expect(declared.length).toBeGreaterThan(0);
    const said = declared.map((a) => `${a.subject} ${a.assumed} ${a.listenQuestion}`).join(" ");
    expect(said).toContain("Client.region");
    expect(declared.every((a) => a.listenQuestion.length > 10)).toBe(true);
  });

  it("a vocabulary generated for an earlier ontology is declared stale, not read as current", () => {
    const stale = { kind: "value-vocabulary", ontology: "not-this-ontology", values: { "Deal.stage": STAGES } };
    const { assumptions } = generateSeed(sales, salesVersion, { vocabulary: stale });
    expect(assumptions.some((a) => a.kind === "value-vocabulary" && /ontology has changed/i.test(a.listenQuestion))).toBe(true);
    const current = { ...stale, ontology: ontologyVocabularyFingerprint(sales) };
    expect(generateSeed(sales, salesVersion, { vocabulary: current }).assumptions
      .some((a) => a.kind === "value-vocabulary" && /ontology has changed/i.test(a.listenQuestion))).toBe(false);
  });

  it("no artifact means no vocabulary assumption — the feature off is the feature silent", () => {
    expect(generateSeed(sales, salesVersion).assumptions.some((a) => a.kind === "value-vocabulary")).toBe(false);
  });
});
