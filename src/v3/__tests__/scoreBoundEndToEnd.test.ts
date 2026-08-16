/**
 * THE BOUND, ALL THE WAY THROUGH (2026-08-16).
 *
 * An "Intent Score" of 197 was rendered on a figure the business reads out of
 * 100. Fixing it took three links, and each was pinned on its own: the pack
 * states min/max, the reconciler writes them onto the attribute, the seed draws
 * inside them. Three green tests can still leave a broken chain — the same
 * session's own defect proved it, when the reconciler skipped a drafted
 * attribute and silently discarded every fact the packs stated.
 *
 * So this case joins them: the REAL reconciler (extracted from the deployed
 * edge source, driven with the real packs) hands its output to the REAL seed
 * generator, and the assertion is on the values a stakeholder would read.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { generateSeed } from "@shared/seedData.ts";

const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");
const section = EDGE.slice(EDGE.indexOf("const VOCAB_FIBO"), EDGE.indexOf("/** True when a Listen conversation is on record"));
const sandbox = new Function(ts.transpileModule(
  `const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);\n${section}\n`
  + `return { reconcileVotedOntology, resolveProvisionalPacks, ontologyVocabularySteering, crmDomainPack, ontologyNameKey, ontologyStandardKey, packRelationFactsOf, packAttributesByClassOf };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } },
).outputText)() as Record<string, (...args: never[]) => never>;

const MANDATE = "Replace Salesforce as the CRM running the customer relationship management lifecycle across Sales, Marketing and GTM: campaigns, leads, opportunities and accounts.";

/** The grounding facts exactly as run-agent assembles them for a CRM mandate. */
function ontologyFromDrafts() {
  const sb = sandbox as unknown as {
    resolveProvisionalPacks: (s: string) => Array<Record<string, never>>;
    ontologyVocabularySteering: (i: string) => string;
    crmDomainPack: (m: string) => Record<string, never>;
    ontologyNameKey: (n: unknown) => string;
    ontologyStandardKey: (u: unknown) => string;
    packAttributesByClassOf: (p: unknown) => Map<string, unknown>;
    packRelationFactsOf: (p: unknown) => Map<string, unknown>;
    reconcileVotedOntology: (d: unknown, o: unknown) => Record<string, unknown>;
  };
  const packs = [...sb.resolveProvisionalPacks(sb.ontologyVocabularySteering("Technology & Software")), sb.crmDomainPack(MANDATE)];
  const allowedUris = new Set<string>(); const packClasses = new Map<string, string>(); const uriToClass = new Map<string, string>();
  const coreClasses = new Set<string>(); const packEntityByClass = new Map<string, unknown>(); const packAreaHintsByClass = new Map<string, unknown>();
  for (const pack of packs) {
    for (const e of (pack as unknown as { entities: Array<Record<string, never>> }).entities) {
      const ent = e as unknown as { name: string; uri: string; aliases: string[]; core?: boolean; definition?: string; areaHints?: string[] };
      for (const alias of [ent.name, ...ent.aliases]) {
        const k = sb.ontologyNameKey(alias);
        if (k && !packClasses.has(k)) packClasses.set(k, ent.name);
      }
      if (ent.uri) { allowedUris.add(sb.ontologyStandardKey(ent.uri)); uriToClass.set(sb.ontologyStandardKey(ent.uri), ent.name); }
      if (ent.core) coreClasses.add(ent.name);
      if (!packEntityByClass.has(ent.name)) packEntityByClass.set(ent.name, { name: ent.name, uri: ent.uri, definition: ent.definition ?? "", vocabulary: (pack as unknown as { vocabulary: string }).vocabulary });
      if (ent.areaHints?.length && !packAreaHintsByClass.has(ent.name)) packAreaHintsByClass.set(ent.name, ent.areaHints);
    }
  }
  const packAssociations = new Set(packs.flatMap((p) => (p as unknown as { relations: Array<{ from: string; verb: string; to: string }> }).relations.map((r) => `${r.from} ${r.verb} ${r.to}`)));
  // A draft that does exactly what the prompt asks: copies the backbone's
  // attribute NAMES and none of its facts. This is what live drafts return.
  const draft = () => ({
    entities: ["Lead", "Opportunity", "Account", "Campaign", "Contact", "Contract"].map((name) => ({
      name, definition: `${name}.`, area: "Sales",
      attributes: name === "Lead" ? [{ name: "leadName" }, { name: "leadSource" }, { name: "intentScore" }] : [],
      systemOfRecord: null, aliases: [], evidence: "from the sponsor mandate — to confirm",
    })),
    relations: [{ from: "Campaign", relation: "produces", to: "Lead", cardinality: "unknown" }],
    events: [], standardAlignment: [], gaps: [],
  });
  return sb.reconcileVotedOntology(Array.from({ length: 5 }, draft), {
    threshold: 3, total: 5, mandate: MANDATE, sponsor: "the sponsor", programName: "test",
    allowedUris, packClasses, uriToClass, packAssociations, coreClasses, packEntityByClass, packAreaHintsByClass,
    programAreas: ["Sales", "Marketing"],
    packRelationFacts: sb.packRelationFactsOf(packs),
    packAttributesByClass: sb.packAttributesByClassOf(packs),
  });
}

describe("pack → reconciler → seed: the bound survives every link", () => {
  const ontology = ontologyFromDrafts();

  it("the reconciler writes the standard's bound onto the DRAFTED attribute", () => {
    const lead = (ontology.entities as Array<Record<string, unknown>>).find((e) => e.name === "Lead")!;
    const score = (lead.attributes as Array<Record<string, unknown>>).find((a) => a.name === "intentScore")!;
    expect(score.min).toBe(0);
    expect(score.max).toBe(100);
  });

  it("and every seeded score falls inside it — the figure a stakeholder reads", () => {
    const rows = generateSeed(ontology as Record<string, unknown>, "end-to-end").records.Lead ?? [];
    const scores = rows.map((r) => r.intentScore).filter((v): v is number => typeof v === "number");
    expect(scores.length, "no scores were seeded").toBeGreaterThan(5);
    expect(Math.max(...scores), "a score above the stated bound reached the page").toBeLessThanOrEqual(100);
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(0);
    expect(new Set(scores).size, "bounding flattened the column").toBeGreaterThan(3);
  });

  it("the enum values survive the same trip — the fix this shares its mechanism with", () => {
    const lead = (ontology.entities as Array<Record<string, unknown>>).find((e) => e.name === "Lead")!;
    const source = (lead.attributes as Array<Record<string, unknown>>).find((a) => a.name === "leadSource")!;
    expect(source.values).toContain("Referral");
    const rows = generateSeed(ontology as Record<string, unknown>, "end-to-end").records.Lead ?? [];
    for (const r of rows) {
      if (typeof r.leadSource === "string") expect(source.values as string[]).toContain(r.leadSource);
    }
  });
});
