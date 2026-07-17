/**
 * Ontology grounding — the acid test, pinned.
 *
 * The provisional ontology is reconciled from N drafts by majority vote, with
 * grounding ENFORCED in code: entities must be mandate- or pack-grounded,
 * alignment URIs must be pack classes, relations must be pack associations or
 * the mandate's stage chain. These tests EXTRACT the reconciler (a pure
 * function) from the edge source, evaluate it, and drive it with canned draft
 * fixtures — so the guarantees stay true as prompts and models drift.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");

// ── Extract the steering tables + voted-ensemble section (pure code, no Deno
// APIs) and eval it. Starting at the VOCAB constants means the tests exercise
// the REAL steering table text — a steering edit that breaks pack resolution
// fails here, not in a live batch. ──
const start = EDGE.indexOf("const VOCAB_FIBO");
const end = EDGE.indexOf("/** True when a Listen conversation is on record");
const section = EDGE.slice(start, end);
const js = ts.transpileModule(
  `const isRecord = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);\n${section}\n` +
  `return { reconcileVotedOntology, resolveProvisionalPacks, ontologyVocabularySteering, ontologyNameKey, ontologyStandardKey, ONTOLOGY_VOTE_N, ONTOLOGY_VOTE_THRESHOLD, ONTOLOGY_MENU_VERBS };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } },
).outputText;
type ResolvedPack = { vocabulary: string; entities: Array<{ name: string; uri: string; aliases: string[]; core?: boolean }>; relations: Array<{ from: string; verb: string; to: string }> };
const sandbox = new Function(js)() as {
  reconcileVotedOntology: (drafts: Array<Record<string, unknown>>, opts: Record<string, unknown>) => Record<string, unknown>;
  resolveProvisionalPacks: (steering: string) => ResolvedPack[];
  ontologyVocabularySteering: (industry: unknown, segment?: unknown) => string;
  ontologyNameKey: (name: unknown) => string;
  ontologyStandardKey: (uri: unknown) => string;
  ONTOLOGY_VOTE_N: number;
  ONTOLOGY_VOTE_THRESHOLD: number;
  ONTOLOGY_MENU_VERBS: string[];
};
const packsFor = (industry: string, segment?: string) =>
  sandbox.resolveProvisionalPacks(sandbox.ontologyVocabularySteering(industry, segment));
const coresOf = (pack: ResolvedPack) => pack.entities.filter((e) => e.core).map((e) => e.name);

const MANDATE = "Accelerate clinical trial recruitment through an AI-powered CRM that improves patient identification, engagement, and enrollment, reducing time-to-enrollment by 30% and increasing enrollment conversion by 20%.";

// Grounding facts, built exactly as the runner builds them — the REAL clinical
// steering (FHIR with the research module + schema.org fallback).
const packs = packsFor("Life Sciences & Pharma", "Clinical");
const allowedUris = new Set<string>();
const packClasses = new Map<string, string>();
const uriToClass = new Map<string, string>();
for (const pack of packs) {
  for (const entity of pack.entities) {
    for (const alias of [entity.name, ...entity.aliases]) {
      const k = sandbox.ontologyNameKey(alias);
      if (k && !packClasses.has(k)) packClasses.set(k, entity.name);
    }
    if (entity.uri) {
      allowedUris.add(sandbox.ontologyStandardKey(entity.uri));
      uriToClass.set(sandbox.ontologyStandardKey(entity.uri), entity.name);
    }
  }
}
const packAssociations = new Set(packs.flatMap((pack) => pack.relations.map((r) => `${r.from} ${r.verb} ${r.to}`)));
const coreClasses = new Set<string>();
for (const entity of packs[0].entities as Array<{ name: string; core?: boolean }>) if (entity.core) coreClasses.add(entity.name);
const packEntityByClass = new Map<string, { name: string; uri: string; definition: string; vocabulary: string }>();
for (const pack of packs) {
  for (const entity of pack.entities as Array<{ name: string; uri: string; definition?: string }>) {
    if (!packEntityByClass.has(entity.name)) packEntityByClass.set(entity.name, { name: entity.name, uri: entity.uri, definition: String(entity.definition ?? ""), vocabulary: pack.vocabulary });
  }
}
const OPTS = { threshold: 3, total: 5, mandate: MANDATE, sponsor: "david burns", programName: "test", allowedUris, packClasses, uriToClass, packAssociations, coreClasses, packEntityByClass };

type Draft = Record<string, unknown>;
function draft(entities: Array<[name: string, uri?: string]>, relations: Array<[string, string, string]> = []): Draft {
  return {
    entities: entities.map(([name]) => ({ name, definition: `${name}.`, area: "Clinical", attributes: [], systemOfRecord: null, aliases: [], evidence: "from the sponsor mandate — to confirm" })),
    relations: relations.map(([from, relation, to]) => ({ from, relation, to, cardinality: "unknown" })),
    events: [],
    standardAlignment: entities.filter(([, uri]) => uri).map(([name, uri]) => ({ entity: name, standard: uri, vocabulary: "HL7 FHIR", relation: "skos:closeMatch", confidence: 0.8 })),
    gaps: [],
  };
}
const names = (doc: Record<string, unknown>) => (doc.entities as Array<{ name: string }>).map((e) => e.name);
const rels = (doc: Record<string, unknown>) => (doc.relations as Array<{ from: string; relation: string; to: string }>).map((r) => `${r.from} ${r.relation} ${r.to}`);

const BASE: Array<[string, string?]> = [
  ["Patient", "http://hl7.org/fhir/Patient"],
  ["Organization", "http://hl7.org/fhir/Organization"],
  ["Patient Identification"],
  ["Patient Engagement"],
  ["Enrollment"],
];
const CHAIN: Array<[string, string, string]> = [
  ["Patient Identification", "leads to", "Patient Engagement"],
  ["Patient Engagement", "leads to", "Enrollment"],
];

describe("voted ontology reconciliation — determinism", () => {
  it("the same drafts always reconcile to the same document", () => {
    const drafts = Array.from({ length: 5 }, () => draft(BASE, CHAIN));
    const a = sandbox.reconcileVotedOntology(drafts.map((d) => JSON.parse(JSON.stringify(d))), { ...OPTS });
    const b = sandbox.reconcileVotedOntology(drafts.map((d) => JSON.parse(JSON.stringify(d))), { ...OPTS });
    expect(a).toEqual(b);
  });

  it("N and the threshold stay at the measured configuration (5 / 3)", () => {
    // N=3/threshold-2 was tried and measurably wobbled — see the constant's
    // comment. Changing this requires re-measuring, not just editing.
    expect(sandbox.ONTOLOGY_VOTE_N).toBe(5);
    expect(sandbox.ONTOLOGY_VOTE_THRESHOLD).toBe(3);
  });
});

describe("voting rules", () => {
  it("a below-majority backbone concept is excluded and demoted to a gap", () => {
    const withCoverage = draft([...BASE, ["Coverage", "http://hl7.org/fhir/Coverage"]], CHAIN);
    const without = draft(BASE, CHAIN);
    const doc = sandbox.reconcileVotedOntology([withCoverage, JSON.parse(JSON.stringify(withCoverage)), without, JSON.parse(JSON.stringify(without)), JSON.parse(JSON.stringify(without))], { ...OPTS });
    expect(names(doc)).not.toContain("Coverage");
    expect((doc.gaps as string[]).join(" ")).toContain("Coverage");
  });

  it("a mandate-named concept is floored in even from a single draft", () => {
    const withTrial = draft([...BASE, ["Clinical Trial", "http://hl7.org/fhir/ResearchStudy"]], CHAIN);
    const without = draft(BASE, CHAIN);
    const doc = sandbox.reconcileVotedOntology([withTrial, without, JSON.parse(JSON.stringify(without)), JSON.parse(JSON.stringify(without)), JSON.parse(JSON.stringify(without))], { ...OPTS });
    expect(names(doc)).toContain("Clinical Trial");
  });
});

describe("the acid test is enforced in code", () => {
  it("an entity that is neither mandate- nor pack-grounded cannot be asserted, even at 5/5", () => {
    const bad = draft([...BASE, ["Telemetry Log", "http://hl7.org/fhir/CarePlan"]], CHAIN); // CarePlan is real FHIR but NOT in the pack
    const doc = sandbox.reconcileVotedOntology(Array.from({ length: 5 }, () => JSON.parse(JSON.stringify(bad))), { ...OPTS });
    expect(names(doc)).not.toContain("Telemetry Log");
    expect((doc.gaps as string[]).join(" ")).toContain("Telemetry Log");
  });

  it("alignment URIs are pack classes only — an off-pack URI is stripped", () => {
    const doc = sandbox.reconcileVotedOntology(Array.from({ length: 5 }, () => draft(BASE, CHAIN)), { ...OPTS });
    for (const row of doc.standardAlignment as Array<{ standard: string }>) {
      expect(allowedUris.has(sandbox.ontologyStandardKey(row.standard))).toBe(true);
    }
  });

  it("a relation the packs do not define is dropped, even at 5/5", () => {
    const bad = draft(BASE, [...CHAIN, ["Patient", "manages", "Organization"]]);
    const doc = sandbox.reconcileVotedOntology(Array.from({ length: 5 }, () => JSON.parse(JSON.stringify(bad))), { ...OPTS });
    expect(rels(doc)).not.toContain("Patient manages Organization");
  });

  it("pack associations and the mandate stage chain survive", () => {
    const good = draft(BASE, [...CHAIN, ["Patient", "participates in", "Organization"]]);
    // "Patient participates in Organization" is NOT a pack association — dropped;
    // the distributed-stage chain links are mandate-worded — kept.
    const doc = sandbox.reconcileVotedOntology(Array.from({ length: 5 }, () => JSON.parse(JSON.stringify(good))), { ...OPTS });
    expect(rels(doc)).toContain("Patient Identification leads to Patient Engagement");
    expect(rels(doc)).toContain("Patient Engagement leads to Enrollment");
    expect(rels(doc)).not.toContain("Patient participates in Organization");
  });
});

describe("bucket merge — mixed alignment presence never duplicates a concept", () => {
  it("drafts that aligned Patient and drafts that did not still vote as ONE Patient", () => {
    const aligned = draft(BASE, CHAIN); // Patient carries its FHIR URI
    const unaligned = draft(BASE.map(([n]) => [n] as [string]), CHAIN); // no alignment rows at all
    const doc = sandbox.reconcileVotedOntology(
      [aligned, JSON.parse(JSON.stringify(aligned)), JSON.parse(JSON.stringify(aligned)), unaligned, JSON.parse(JSON.stringify(unaligned))],
      { ...OPTS },
    );
    expect(names(doc).filter((n) => n === "Patient")).toHaveLength(1);
  });
});

describe("TM Forum SID pack — telecom depth", () => {
  const sidPacks = packsFor("Telecommunications");
  it("SID resolves as the PRIMARY pack for the telecom steering", () => {
    expect(sidPacks[0].vocabulary).toBe("TM Forum SID");
  });
  it("SID cores carry the telecom backbone", () => {
    expect(coresOf(sidPacks[0])).toEqual(["Customer", "Product", "Service", "Agreement"]);
  });
});

describe("pack resolution follows the steering's declared primary", () => {
  it("a segment whose steering declares schema.org primary gets schema.org cores, not the specialist pack's", () => {
    // These three segments used to inherit the specialist pack as primary from
    // the resolver's fixed check order — asserting Meter/Asset (energy retail),
    // OrganizationalUnit (citizen services) or Product (LS commercial) cores
    // into mandates the steering scoped to plain commerce/services.
    expect(packsFor("Energy & Utilities", "Energy Retail")[0].vocabulary).toBe("schema.org");
    expect(packsFor("Public Sector & Government", "Citizen Services")[0].vocabulary).toBe("schema.org");
    expect(packsFor("Life Sciences & Pharma", "Commercial")[0].vocabulary).toBe("schema.org");
  });
  it("the specialist pack still rides second for its scoped entities", () => {
    expect(packsFor("Energy & Utilities", "Energy Retail").map((p) => p.vocabulary)).toContain("IEC CIM");
    expect(packsFor("Public Sector & Government", "Citizen Services").map((p) => p.vocabulary)).toContain("W3C ORG");
  });
  it("declared-primary segments are untouched", () => {
    expect(packsFor("Energy & Utilities", "Grid Operations")[0].vocabulary).toBe("IEC CIM");
    expect(packsFor("Public Sector & Government", "Organisation & Governance")[0].vocabulary).toBe("W3C ORG");
    expect(packsFor("Healthcare")[0].vocabulary).toBe("HL7 FHIR");
    expect(packsFor("Banking")[0].vocabulary).toBe("FIBO");
  });
});

describe("steering-selected cores — the same vocabulary carries different backbones", () => {
  it("Healthcare gets FHIR's generic care cores, never the research module", () => {
    expect(coresOf(packsFor("Healthcare")[0])).toEqual(["Patient", "Practitioner", "Organization"]);
  });
  it("Life Sciences clinical asserts the research module as core", () => {
    expect(coresOf(packsFor("Life Sciences & Pharma", "Clinical")[0]))
      .toEqual(["Patient", "Practitioner", "Organization", "ResearchStudy", "ResearchSubject"]);
  });
  it("Insurance cores are policy-centric — Account (a banking class) is not one", () => {
    const cores = coresOf(packsFor("Insurance")[0]);
    for (const c of ["Client", "Financial Institution", "Policy", "Claim", "Insured Party"]) expect(cores).toContain(c);
    expect(cores).not.toContain("Account");
  });
  it("Banking keeps the account backbone and does not assert insurance classes", () => {
    expect(coresOf(packsFor("Banking")[0])).toEqual(["Client", "Account", "Financial Institution"]);
  });
});

describe("the schema pack carries every class the steering table promises", () => {
  it("automotive dealer, education, travel and citizen-service classes are alignable facts", () => {
    const schemaNames = new Set(packsFor("Other")[0].entities.map((e) => e.name));
    for (const promised of ["Vehicle", "Course", "EducationalOrganization", "LearningResource", "Flight", "LodgingBusiness", "Reservation", "GovernmentService", "GovernmentOrganization"]) {
      expect(schemaNames.has(promised), promised).toBe(true);
    }
  });
});

describe("core/extended policy — the asserted set is (mandate, steering), not a vote", () => {
  it("an EXTENDED pack class demotes to a gap even at 5/5 consensus", () => {
    const withConsent = draft([...BASE, ["Consent", "http://hl7.org/fhir/Consent"]], CHAIN);
    const doc = sandbox.reconcileVotedOntology(Array.from({ length: 5 }, () => JSON.parse(JSON.stringify(withConsent))), { ...OPTS });
    expect(names(doc)).not.toContain("Consent");
    expect((doc.gaps as string[]).join(" ")).toContain("Consent");
  });

  it("CORE classes are guaranteed — synthesised from the pack when no draft produced them", () => {
    const doc = sandbox.reconcileVotedOntology(Array.from({ length: 5 }, () => draft(BASE, CHAIN)), { ...OPTS });
    for (const core of ["Practitioner", "ResearchStudy", "ResearchSubject"]) expect(names(doc)).toContain(core);
    const practitioner = (doc.entities as Array<{ name: string; evidence: string }>).find((e) => e.name === "Practitioner");
    expect(practitioner?.evidence).toContain("implied by");
    // …and the closure connects them: no synthesised core floats unlinked.
    expect(rels(doc)).toContain("Practitioner is part of Organization");
  });

  it("two batches with DIFFERENT draft noise assert the identical entity set", () => {
    const noisyA = [draft([...BASE, ["Coverage", "http://hl7.org/fhir/Coverage"]], CHAIN), ...Array.from({ length: 4 }, () => draft(BASE, CHAIN))];
    const noisyB = Array.from({ length: 5 }, () => draft([...BASE, ["Encounter", "http://hl7.org/fhir/Encounter"], ["Consent", "http://hl7.org/fhir/Consent"]], CHAIN));
    const a = sandbox.reconcileVotedOntology(noisyA, { ...OPTS });
    const b = sandbox.reconcileVotedOntology(noisyB, { ...OPTS });
    expect(names(a)).toEqual(names(b));
  });
});

describe("prompt ↔ reconciler lockstep", () => {
  it("the closed verb menu matches the prompt's CLOSED MENU sentence", () => {
    const sentence = EDGE.match(/RELATION VERBS are a CLOSED MENU: ([^.]+)\./);
    expect(sentence).toBeTruthy();
    const promptVerbs = sentence![1].split(",").map((v) => v.trim()).sort();
    expect([...sandbox.ONTOLOGY_MENU_VERBS].sort()).toEqual(promptVerbs);
  });

  it("every pack URI is namespace-valid against ONTOLOGY_VOCAB_PREFIXES", () => {
    const prefixBlock = EDGE.match(/ONTOLOGY_VOCAB_PREFIXES = \[([\s\S]*?)\];/);
    const prefixes = [...prefixBlock![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    for (const pack of packs) {
      for (const entity of pack.entities) {
        if (entity.uri) expect(prefixes.some((p) => entity.uri.startsWith(p)), `${entity.name}: ${entity.uri}`).toBe(true);
      }
    }
  });

  it("the generation context ships the standard backbone as facts", () => {
    expect(EDGE).toContain("standardBackbone: resolveProvisionalPacks(steering)");
    expect(EDGE).toContain('The input context carries "standardBackbone"');
  });
});
