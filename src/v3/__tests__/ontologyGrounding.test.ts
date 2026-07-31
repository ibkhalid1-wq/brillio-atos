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
  `return { reconcileVotedOntology, resolveProvisionalPacks, ontologyVocabularySteering, clientVocabularyPack, crmDomainPack, ontologyNameKey, ontologyStandardKey, ONTOLOGY_VOTE_N, ONTOLOGY_VOTE_THRESHOLD, ONTOLOGY_MENU_VERBS };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } },
).outputText;
type ResolvedPack = { vocabulary: string; entities: Array<{ name: string; uri: string; definition?: string; aliases: string[]; core?: boolean; areaHints?: string[] }>; relations: Array<{ from: string; verb: string; to: string }> };
const sandbox = new Function(js)() as {
  reconcileVotedOntology: (drafts: Array<Record<string, unknown>>, opts: Record<string, unknown>) => Record<string, unknown>;
  resolveProvisionalPacks: (steering: string) => ResolvedPack[];
  ontologyVocabularySteering: (industry: unknown, segment?: unknown) => string;
  clientVocabularyPack: (inner: Record<string, unknown>) => ResolvedPack | null;
  crmDomainPack: (mandate: string) => ResolvedPack | null;
  ontologyNameKey: (name: unknown) => string;
  ontologyStandardKey: (uri: unknown) => string;
  ONTOLOGY_VOTE_N: number;
  ONTOLOGY_VOTE_THRESHOLD: number;
  ONTOLOGY_MENU_VERBS: string[];
};
const packsFor = (industry: string, segment?: string) =>
  sandbox.resolveProvisionalPacks(sandbox.ontologyVocabularySteering(industry, segment));
const coresOf = (pack: ResolvedPack) => pack.entities.filter((e) => e.core).map((e) => e.name);
// Every distinct pack (variants included) reachable from the steering table.
const ALL_INDUSTRIES: Array<[string, string?]> = [
  ["Financial Services"], ["Banking"], ["Banking", "Capital Markets"], ["Insurance"],
  ["Healthcare"], ["Life Sciences & Pharma", "Clinical"], ["Life Sciences & Pharma", "Manufacturing & Supply"],
  ["Retail & Consumer Goods"], ["Manufacturing"], ["Automotive"], ["Energy & Utilities"],
  ["Telecommunications"], ["Media & Entertainment"], ["Technology & Software"],
  ["Transportation & Logistics"], ["Public Sector & Government"], ["Education"],
  ["Travel & Hospitality"], ["Professional Services"], ["Other"],
];
const ALL_PACKS = [...new Map(
  ALL_INDUSTRIES.flatMap(([i, s]) => packsFor(i, s)).map((p) => [`${p.vocabulary}|${coresOf(p).join(",")}`, p]),
).values()];

const MANDATE = "Accelerate clinical trial recruitment through an AI-powered CRM that improves patient identification, engagement, and enrollment, reducing time-to-enrollment by 30% and increasing enrollment conversion by 20%.";

// Grounding facts, built exactly as the runner builds them.
function groundingFor(resolved: ResolvedPack[], mandate: string, sponsor = "the sponsor", programAreas?: string[]) {
  const allowedUris = new Set<string>();
  const packClasses = new Map<string, string>();
  const uriToClass = new Map<string, string>();
  for (const pack of resolved) {
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
  const packAssociations = new Set(resolved.flatMap((pack) => pack.relations.map((r) => `${r.from} ${r.verb} ${r.to}`)));
  const coreClasses = new Set<string>();
  for (const entity of resolved[0].entities) if (entity.core) coreClasses.add(entity.name);
  const packEntityByClass = new Map<string, { name: string; uri: string; definition: string; vocabulary: string }>();
  const packAreaHintsByClass = new Map<string, string[]>();
  for (const pack of resolved) {
    for (const entity of pack.entities) {
      if (!packEntityByClass.has(entity.name)) packEntityByClass.set(entity.name, { name: entity.name, uri: entity.uri, definition: String(entity.definition ?? ""), vocabulary: pack.vocabulary });
      if (entity.areaHints?.length && !packAreaHintsByClass.has(entity.name)) packAreaHintsByClass.set(entity.name, entity.areaHints);
    }
  }
  return { threshold: 3, total: 5, mandate, sponsor, programName: "test", allowedUris, packClasses, uriToClass, packAssociations, coreClasses, packEntityByClass, packAreaHintsByClass, programAreas };
}
// The REAL clinical steering (FHIR with the research module + schema.org fallback).
const packs = packsFor("Life Sciences & Pharma", "Clinical");
const OPTS = groundingFor(packs, MANDATE, "david burns");
const allowedUris = OPTS.allowedUris;

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

describe("client vocabulary — extend, never edit, sanitised on read", () => {
  const wrap = (cv: unknown) => ({ phaseInputs: { listen: { clientVocabulary: JSON.stringify(cv) } } });
  it("sanitises: off-menu verbs, fabricated URIs, dangling relations, and the core cap", () => {
    const pack = sandbox.clientVocabularyPack(wrap({
      vocabulary: "Acme Canonical Model",
      entities: [
        { name: "Site Visit", definition: "A monitoring visit", aliases: ["visit audit"], core: true, uri: "https://acme.example/SiteVisit" },
        { name: "CRO", definition: "Contract research organisation", aliases: ["cro"], core: true },
        { name: "A", core: true }, { name: "B", core: true }, { name: "C", core: true }, { name: "D", core: true },
      ],
      relations: [
        { from: "CRO", verb: "conducts", to: "Site Visit" },
        { from: "CRO", verb: "collaborates with", to: "Site Visit" }, // off-menu — dropped
        { from: "CRO", verb: "manages", to: "Ghost" },                // dangling — dropped
      ],
    }));
    expect(pack).not.toBeNull();
    expect(pack!.vocabulary).toBe("Acme Canonical Model");
    expect(pack!.entities.find((e) => e.name === "Site Visit")?.uri).toBe(""); // off-whitelist namespace blanked
    expect(pack!.entities.filter((e) => e.core)).toHaveLength(5);              // six requested, capped
    expect(pack!.relations).toEqual([{ from: "CRO", verb: "conducts", to: "Site Visit" }]);
  });

  it("absent, empty or malformed vocabulary resolves to null", () => {
    expect(sandbox.clientVocabularyPack({})).toBeNull();
    expect(sandbox.clientVocabularyPack({ phaseInputs: { listen: { clientVocabulary: "" } } })).toBeNull();
    expect(sandbox.clientVocabularyPack({ phaseInputs: { listen: { clientVocabulary: "{not json" } } })).toBeNull();
  });

  it("client cores are asserted and the closure connects them, exactly like a standard pack", () => {
    const clientPack = sandbox.clientVocabularyPack(wrap({
      vocabulary: "Acme Model",
      entities: [
        { name: "Site Visit", definition: "A monitoring visit", aliases: [], core: true },
        { name: "CRO", definition: "Contract research organisation", aliases: [], core: true },
      ],
      relations: [{ from: "CRO", verb: "conducts", to: "Site Visit" }],
    }));
    const resolved = [...packsFor("Life Sciences & Pharma", "Clinical"), clientPack!];
    const opts = groundingFor(resolved, MANDATE, "david burns");
    for (const e of clientPack!.entities) if (e.core) opts.coreClasses.add(e.name); // mirrors the runner
    const doc = sandbox.reconcileVotedOntology(Array.from({ length: 5 }, () => draft(BASE, CHAIN)), opts);
    expect(names(doc)).toContain("Site Visit");
    expect(names(doc)).toContain("CRO");
    expect(rels(doc)).toContain("CRO conducts Site Visit");
  });
});

describe("candidates — the demoted standard classes behind the gaps, as structured ghosts", () => {
  it("an extended-demoted pack class becomes a candidate with its would-be relations to ASSERTED entities", () => {
    const withConsent = draft([...BASE, ["Consent", "http://hl7.org/fhir/Consent"]], CHAIN);
    const doc = sandbox.reconcileVotedOntology(Array.from({ length: 5 }, () => JSON.parse(JSON.stringify(withConsent))), { ...OPTS });
    const cands = doc.candidates as Array<{ name: string; definition: string; vocabulary: string; reason: string; relations: Array<{ from: string; relation: string; to: string }> }>;
    const consent = cands.find((c) => c.name === "Consent");
    expect(consent).toBeTruthy();
    expect(consent!.reason).toBe("extended");
    expect(consent!.definition).toContain("consent");
    expect(consent!.relations).toContainEqual({ from: "Consent", relation: "applies to", to: "Patient" });
  });

  it("an ungrounded invention never earns a candidate, even at 5/5", () => {
    const bad = draft([...BASE, ["Telemetry Log", "http://hl7.org/fhir/CarePlan"]], CHAIN);
    const doc = sandbox.reconcileVotedOntology(Array.from({ length: 5 }, () => JSON.parse(JSON.stringify(bad))), { ...OPTS });
    expect((doc.candidates as Array<{ name: string }>).map((c) => c.name)).not.toContain("Telemetry Log");
  });

  it("candidates are deterministic, capped, and never duplicate an asserted entity", () => {
    const drafts = Array.from({ length: 5 }, () => draft(BASE, CHAIN));
    const a = sandbox.reconcileVotedOntology(drafts.map((d) => JSON.parse(JSON.stringify(d))), { ...OPTS });
    const b = sandbox.reconcileVotedOntology(drafts.map((d) => JSON.parse(JSON.stringify(d))), { ...OPTS });
    expect(a.candidates).toEqual(b.candidates);
    const cands = a.candidates as Array<{ name: string }>;
    expect(cands.length).toBeLessThanOrEqual(8);
    for (const c of cands) expect(names(a)).not.toContain(c.name);
  });
});

describe("disconnected entities are asked about, never silent", () => {
  it("a mandate-named CRM object with no pack relations derives a sponsor ask", () => {
    const opts = groundingFor(packs, MANDATE + " Track each marketing campaign.", "david burns");
    const withCampaign = draft([...BASE, ["Campaign"]], CHAIN);
    const doc = sandbox.reconcileVotedOntology(Array.from({ length: 5 }, () => JSON.parse(JSON.stringify(withCampaign))), opts);
    expect(names(doc)).toContain("Campaign");
    expect((doc.gaps as string[]).some((g) => g.includes('"Campaign" stands alone'))).toBe(true);
  });
});

describe("CRM robustness — a CRM-focused mandate in every industry, sector and segment", () => {
  // The demo pattern: every vertical's flagship use case is CRM-shaped
  // (acquire, engage, retain a party; convert a funnel). These invariants must
  // hold no matter which pack is primary: the party and the funnel objects
  // assert (mandate floor), the funnel chain survives the acid test, alignment
  // never leaves the packs, the output is deterministic, and nothing floats
  // silently — an entity is either connected or asked about.
  const CRM_CASES: Array<{ industry: string; segment?: string; party: string }> = [
    { industry: "Financial Services", party: "Client" },
    { industry: "Banking", segment: "Retail Banking", party: "Client" },
    { industry: "Banking", segment: "Capital Markets", party: "Client" },
    { industry: "Banking", segment: "Payments", party: "Client" },
    { industry: "Insurance", party: "Policyholder" },
    { industry: "Healthcare", party: "Patient" },
    { industry: "Life Sciences & Pharma", segment: "Clinical", party: "Patient" },
    { industry: "Life Sciences & Pharma", segment: "Commercial", party: "Customer" },
    { industry: "Retail & Consumer Goods", party: "Customer" },
    { industry: "Manufacturing", party: "Customer" },
    { industry: "Automotive", segment: "Dealer & Commerce", party: "Customer" },
    { industry: "Energy & Utilities", segment: "Energy Retail", party: "Customer" },
    { industry: "Telecommunications", party: "Subscriber" },
    { industry: "Media & Entertainment", party: "Subscriber" },
    { industry: "Technology & Software", party: "Customer" },
    { industry: "Transportation & Logistics", party: "Customer" },
    { industry: "Public Sector & Government", segment: "Citizen Services", party: "Citizen" },
    { industry: "Education", party: "Student" },
    { industry: "Travel & Hospitality", party: "Guest" },
    { industry: "Professional Services", party: "Client" },
    { industry: "Other", party: "Customer" },
  ];
  for (const c of CRM_CASES) {
    it(`${c.industry}${c.segment ? " · " + c.segment : ""} (${c.party})`, () => {
      const resolved = packsFor(c.industry, c.segment);
      const mandate = `Improve ${c.party.toLowerCase()} acquisition, engagement, and retention through a CRM that converts each lead into an opportunity, increasing conversion by 20%.`;
      const opts = groundingFor(resolved, mandate);
      const crmDraft = () => draft([[c.party], ["Lead"], ["Opportunity"]], [["Lead", "leads to", "Opportunity"]]);
      const drafts = Array.from({ length: 5 }, crmDraft);
      const doc = sandbox.reconcileVotedOntology(drafts.map((d) => JSON.parse(JSON.stringify(d))), opts);
      const doc2 = sandbox.reconcileVotedOntology(drafts.map((d) => JSON.parse(JSON.stringify(d))), opts);
      expect(doc).toEqual(doc2); // deterministic
      // party + funnel objects assert via the mandate floor, whatever the pack
      for (const n of [c.party, "Lead", "Opportunity"]) expect(names(doc), n).toContain(n);
      // the funnel chain survives the acid test
      expect(rels(doc)).toContain("Lead leads to Opportunity");
      // alignment never leaves the packs
      for (const row of doc.standardAlignment as Array<{ standard: string }>) {
        expect(opts.allowedUris.has(sandbox.ontologyStandardKey(row.standard)), row.standard).toBe(true);
      }
      // nothing floats silently: every asserted entity is in a relation or asked about
      const related = new Set((doc.relations as Array<{ from: string; to: string }>).flatMap((r) => [r.from, r.to]));
      const gapText = (doc.gaps as string[]).join(" ");
      for (const n of names(doc)) {
        expect(related.has(n) || gapText.includes(`"${n}"`), `${n} floats silently`).toBe(true);
      }
    });
  }
});

describe("care-operations depth — the generic FHIR pack", () => {
  const hcPacks = packsFor("Healthcare");
  it("carries ServiceRequest so a referral mandate can align and connect", () => {
    const sr = hcPacks[0].entities.find((e) => e.name === "ServiceRequest");
    expect(sr?.aliases).toContain("referral");
    const assocs = hcPacks[0].relations.map((r) => `${r.from} ${r.verb} ${r.to}`);
    expect(assocs).toContain("ServiceRequest applies to Patient");
    expect(assocs).toContain("Practitioner produces ServiceRequest");
  });
  it("carries NO research classes — a hospital-ops sponsor is never asked about ResearchStudy", () => {
    const names = hcPacks[0].entities.map((e) => e.name);
    expect(names).not.toContain("ResearchStudy");
    expect(names).not.toContain("ResearchSubject");
  });
  it("the clinical variant still carries the research module with its relations", () => {
    const cl = packsFor("Life Sciences & Pharma", "Clinical")[0];
    expect(coresOf(cl)).toContain("ResearchStudy");
    expect(cl.relations.map((r) => `${r.from} ${r.verb} ${r.to}`)).toContain("Patient participates in ResearchStudy");
  });
});

describe("industry pack depth", () => {
  it("Manufacturing runs on ISA-95 as primary with production cores; GS1 rides second", () => {
    const m = packsFor("Manufacturing");
    expect(m[0].vocabulary).toBe("ISA-95");
    expect(coresOf(m[0])).toEqual(["Equipment", "Material Lot", "Production Request"]);
    expect(m.map((p) => p.vocabulary)).toContain("GS1");
  });
  it("FIBO carries capital-markets classes", () => {
    const names = packsFor("Banking", "Capital Markets")[0].entities.map((e) => e.name);
    for (const c of ["Financial Instrument", "Trade", "Portfolio"]) expect(names).toContain(c);
  });
  it("EBUCore carries publication classes with real URIs", () => {
    const media = packsFor("Media & Entertainment")[0];
    expect(media.entities.find((e) => e.name === "PublicationEvent")?.uri).toContain("ebucore#PublicationEvent");
    expect(media.entities.find((e) => e.name === "PublicationChannel")?.uri).toContain("ebucore#PublicationChannel");
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
    for (const pack of ALL_PACKS) {
      for (const entity of pack.entities) {
        if (entity.uri) expect(prefixes.some((p) => entity.uri.startsWith(p)), `${pack.vocabulary} ${entity.name}: ${entity.uri}`).toBe(true);
      }
    }
  });

  it("every pack association verb is on the closed menu", () => {
    for (const pack of ALL_PACKS) {
      for (const r of pack.relations) {
        expect(sandbox.ONTOLOGY_MENU_VERBS, `${pack.vocabulary}: ${r.from} ${r.verb} ${r.to}`).toContain(r.verb);
      }
    }
  });

  it("the voted path gates on Listen evidence, never on runMode", () => {
    // The app's Regenerate infers a refresh runMode once a prior doc exists —
    // that must NOT bypass the voted reconciler while the doc is provisional.
    expect(EDGE).toMatch(/agentId === "domain-ontology"\s*\n\s*&& !ontologyListenEvidenceOnRecord/);
    expect(EDGE).not.toMatch(/agentId === "domain-ontology"\s*\n\s*&& formalRunMode === "initial_generation"/);
  });

  it("the generation context ships the standard backbone as facts", () => {
    expect(EDGE).toContain("standardBackbone: backbonePacks.map");
    expect(EDGE).toContain("const clientBackbonePack = clientVocabularyPack(inner)");
    expect(EDGE).toContain('The input context carries "standardBackbone"');
  });
});

/**
 * The commerce backbone — schema.org as PRIMARY vs schema.org as FALLBACK.
 *
 * A nine-area CRM programme came back with two entities (Customer,
 * Organization) and nothing else. Not a model failure: schema.org shipped two
 * core classes, and extended classes are demoted to gaps by policy however many
 * drafts vote for them — so two was the ceiling, not the outcome. These tests
 * pin the wider core for schema-primary steering AND the containment that keeps
 * every specialist industry exactly as it was.
 */
describe("commerce backbone (schema.org primary)", () => {
  const COMMERCE = ["Person", "Organization", "Product", "Service", "Order", "Invoice", "Offer"];
  // Every industry whose steering names no specialist vocabulary first.
  const SCHEMA_PRIMARY: Array<[string, string?]> = [
    ["Technology & Software"], ["Professional Services"], ["Education"],
    ["Travel & Hospitality"], ["Other"], ["Life Sciences & Pharma", "Commercial"],
  ];

  it.each(SCHEMA_PRIMARY)("%s %s carries the commercial backbone as core", (industry, segment) => {
    const primary = packsFor(industry, segment)[0];
    expect(primary.vocabulary).toBe("schema.org");
    expect(coresOf(primary).sort()).toEqual([...COMMERCE].sort());
  });

  it("an industry with no dedicated vocabulary still gets the backbone", () => {
    // The steering table's fallthrough branch, not an "other" table entry.
    expect(coresOf(packsFor("Underwater Basket Weaving")[0]).sort()).toEqual([...COMMERCE].sort());
  });

  // ── Containment: the fallback pack must NOT widen. ──
  const SPECIALIST: Array<[string, string?]> = [
    ["Healthcare"], ["Banking"], ["Insurance"], ["Retail & Consumer Goods"],
    ["Energy & Utilities"], ["Telecommunications"], ["Manufacturing"],
    ["Media & Entertainment"], ["Public Sector & Government"],
  ];
  it.each(SPECIALIST)("%s %s keeps schema.org as a two-core fallback", (industry, segment) => {
    const resolved = packsFor(industry, segment);
    expect(resolved[0].vocabulary).not.toBe("schema.org");
    const fallback = resolved.find((p) => p.vocabulary === "schema.org");
    expect(fallback && coresOf(fallback).sort()).toEqual(["Organization", "Person"]);
  });

  it("commerce and schema differ ONLY in core flags — same classes, URIs, relations", () => {
    const primary = packsFor("Technology & Software")[0];
    const fallback = packsFor("Healthcare").find((p) => p.vocabulary === "schema.org")!;
    expect(primary.entities.map((e) => `${e.name}|${e.uri}`)).toEqual(fallback.entities.map((e) => `${e.name}|${e.uri}`));
    expect(primary.relations).toEqual(fallback.relations);
  });

  // ── The reported symptom, end to end. ──
  const CRM_MANDATE = "Replace the spreadsheet sales process with a CRM that gives revenue leadership one view of the pipeline.";
  const AREAS = ["Sales", "Marketing", "Delivery", "Finance", "Partner Alliances", "Product Management"];
  /** Two drafts' worth of agreement on the two obvious nouns — the exact input
   * that used to yield a two-entity ontology. */
  const thinDrafts = () => Array.from({ length: 5 }, () => ({
    entities: [
      { name: "Customer", definition: "A buyer.", area: "Sales", attributes: [], systemOfRecord: null, aliases: [], evidence: "from the sponsor mandate — to confirm" },
      { name: "Organization", definition: "A company.", area: "Sales", attributes: [], systemOfRecord: null, aliases: [], evidence: "from the sponsor mandate — to confirm" },
    ],
    relations: [], events: [],
    standardAlignment: [{ entity: "Customer", standard: "https://schema.org/Person", vocabulary: "schema.org", relation: "skos:closeMatch", confidence: 0.8 }],
    gaps: [],
  }));

  it("lifts the two-entity ceiling: the backbone is asserted from the pack", () => {
    const opts = groundingFor(packsFor("Technology & Software"), CRM_MANDATE, "the sponsor", AREAS);
    const got = names(sandbox.reconcileVotedOntology(thinDrafts(), opts));
    // Drafts that agreed on two nouns; the pack supplies the rest. ("Customer"
    // reconciles to its pack class Person — this mandate never says the word,
    // so the verbatim-naming rule does not hold the draft's label.)
    expect([...got].sort()).toEqual([...COMMERCE].sort());
  });

  it("places synthesised cores onto the kit's declared areas, not General", () => {
    const opts = groundingFor(packsFor("Technology & Software"), CRM_MANDATE, "the sponsor", AREAS);
    const doc = sandbox.reconcileVotedOntology(thinDrafts(), opts);
    const areaOf = (n: string) => (doc.entities as Array<{ name: string; area: string }>).find((e) => e.name === n)?.area;
    expect(areaOf("Invoice")).toBe("Finance");
    expect(areaOf("Order")).toBe("Sales");
    expect(areaOf("Service")).toBe("Delivery");
    // More than one area covered is the whole point — the Listen triangle's
    // kit and atlas guidance both key off these.
    const areas = new Set((doc.entities as Array<{ area: string }>).map((e) => e.area));
    expect(areas.size).toBeGreaterThan(1);
  });

  it("falls back to General when the programme declared no areas", () => {
    const opts = groundingFor(packsFor("Technology & Software"), CRM_MANDATE);
    const doc = sandbox.reconcileVotedOntology(thinDrafts(), opts);
    const invoice = (doc.entities as Array<{ name: string; area: string }>).find((e) => e.name === "Invoice");
    expect(invoice?.area).toBe("General");
  });

  it("a clinical programme gains no commerce entities", () => {
    const got = names(sandbox.reconcileVotedOntology([draft(BASE, CHAIN), draft(BASE, CHAIN), draft(BASE, CHAIN)], OPTS));
    for (const cls of ["Order", "Invoice", "Offer", "Product"]) expect(got).not.toContain(cls);
  });
});

/**
 * The CRM pack — selection on a FUNCTIONAL axis, not the industry one.
 *
 * "Why is there no Lead?" had a precise answer: no pack in the manifest listed
 * one, the mandate never said the word, and the grounding gate admits only
 * pack- or mandate-grounded nouns. The drafts proposed Lead and it was
 * discarded, every run. These tests pin the second selection axis, the
 * two-signal threshold that keeps it from firing on programmes that merely
 * mention a CRM, and the union-not-replace core policy.
 */
describe("CRM functional-domain pack", () => {
  // The REAL Laila - Provisional mandate, read from the live charter.
  const LAILA = "This programme is established to develop an agentic CRM system that will replace the current Salesforce CRM and manage the entire customer life cycle across all major business functions at Brillio. It is authorised by the executive sponsor to drive transformation across Marketing, Sales, GTM, Sales Operations, Delivery, Legal, Alliances, and Talent Acquisition.";
  const CRM_CORE = ["Lead", "Opportunity", "Account", "Contact", "Campaign", "Contract"];

  it("fires on a mandate to BUILD a CRM", () => {
    expect(coresOf(sandbox.crmDomainPack(LAILA)!).sort()).toEqual([...CRM_CORE].sort());
  });

  it("does NOT fire on a clinical mandate that merely mentions a CRM", () => {
    // One signal ("CRM"). This is the case the threshold exists for — the
    // pinned clinical fixture must stay a FHIR programme.
    expect(sandbox.crmDomainPack(MANDATE)).toBeNull();
  });

  it.each([
    ["an order-management rewrite", "Replace the legacy order management system with a modern platform."],
    ["a claims mandate", "Reduce claims cycle time across the insurance back office."],
    ["one passing mention", "Integrate the warehouse system with our CRM."],
    ["empty", ""],
  ])("does not fire on %s", (_label, mandate) => {
    expect(sandbox.crmDomainPack(mandate)).toBeNull();
  });

  it("needs two DISTINCT signals, not one repeated", () => {
    expect(sandbox.crmDomainPack("CRM. CRM. CRM. CRM.")).toBeNull();
    expect(sandbox.crmDomainPack("Replace the CRM and rebuild sales operations.")).not.toBeNull();
  });

  it("every relation uses a verb from the menu", () => {
    for (const r of sandbox.crmDomainPack(LAILA)!.relations) {
      expect(sandbox.ONTOLOGY_MENU_VERBS).toContain(r.verb);
    }
  });

  it("relation endpoints all resolve to classes the pack defines", () => {
    const pack = sandbox.crmDomainPack(LAILA)!;
    const names = new Set(pack.entities.map((e) => e.name));
    for (const r of pack.relations) {
      expect(names.has(r.from), `${r.from} undefined`).toBe(true);
      expect(names.has(r.to), `${r.to} undefined`).toBe(true);
    }
  });

  it("claims no alias the schema.org pack already owns — first-wins would shadow it", () => {
    const schemaAliases = new Set(
      packsFor("Healthcare").find((p) => p.vocabulary === "schema.org")!
        .entities.flatMap((e) => [e.name, ...e.aliases]).map((a) => sandbox.ontologyNameKey(a)),
    );
    for (const e of sandbox.crmDomainPack(LAILA)!.entities) {
      for (const alias of [e.name, ...e.aliases]) {
        expect(schemaAliases.has(sandbox.ontologyNameKey(alias)), `"${alias}" collides`).toBe(false);
      }
    }
  });

  // ── Union, not replace: the industry primary keeps its cores. ──
  /** Build the runner's opts with the CRM pack appended, exactly as the edge
   * function threads it — industry pack still packs[0]. */
  function withCrm(industry: string, mandate: string, areas?: string[], segment?: string) {
    const resolved = [...packsFor(industry, segment), sandbox.crmDomainPack(mandate)!].filter(Boolean);
    const opts = groundingFor(resolved, mandate, "the sponsor", areas);
    for (const e of sandbox.crmDomainPack(mandate)!.entities) if (e.core) opts.coreClasses.add(e.name);
    return opts;
  }
  const emptyDrafts = () => Array.from({ length: 5 }, () => ({
    entities: [{ name: "Customer", definition: "A buyer.", area: "Sales", attributes: [], systemOfRecord: null, aliases: [], evidence: "from the sponsor mandate — to confirm" }],
    relations: [], events: [], standardAlignment: [], gaps: [],
  }));

  it("asserts the CRM backbone for a schema.org-steered programme", () => {
    const got = names(sandbox.reconcileVotedOntology(emptyDrafts(), withCrm("Technology & Software", LAILA)));
    for (const cls of CRM_CORE) expect(got).toContain(cls);
  });

  it("a healthcare CRM keeps Patient AND gains Lead", () => {
    const mandate = `Give care navigators one view of the patient. ${LAILA}`;
    const got = names(sandbox.reconcileVotedOntology(emptyDrafts(), withCrm("Healthcare", mandate)));
    expect(got).toContain("Patient");      // FHIR primary cores survive…
    expect(got).toContain("Practitioner");
    expect(got).toContain("Lead");          // …and the functional axis adds its own
    expect(got).toContain("Opportunity");
  });

  it("places the CRM backbone across the programme's real areas", () => {
    // Laila's declared Discovery Kit domains.
    const AREAS = ["Marketing", "Sales", "GTM", "Sales Operations", "Delivery", "Legal", "Alliances", "Talent Acquisition"];
    const doc = sandbox.reconcileVotedOntology(emptyDrafts(), withCrm("Technology & Software", LAILA, AREAS));
    const areaOf = (n: string) => (doc.entities as Array<{ name: string; area: string }>).find((e) => e.name === n)?.area;
    expect(areaOf("Lead")).toBe("Marketing");
    expect(areaOf("Campaign")).toBe("Marketing");
    expect(areaOf("Contract")).toBe("Legal");
    expect(new Set((doc.entities as Array<{ area: string }>).map((e) => e.area)).size).toBeGreaterThanOrEqual(3);
  });
});

/**
 * AREA COVERAGE promotion — the FHIR edition of the two-entity ceiling.
 *
 * The surgery-cancellations programme surfaced it live: healthcare steers
 * FHIR-primary, whose core is {Patient, Practitioner, Organization}, and the
 * extended-demotion policy capped the asserted ontology at those 3 while the
 * Discovery Kit declared 8 domains. The live view read "3 entities · 8 to
 * confirm" — the 8 being exactly the FHIR pack's extended classes the drafts
 * proposed and the reconciler culled. The atlas checklist then keyed off the
 * ontology's 3 areas and left three kit domains workflow-less.
 *
 * The carve-out: a kit domain with no asserted entity promotes the demoted
 * extended class the drafts filed under it. Standard-grounded only — the acid
 * test is intact — and deterministic, so the asserted set is a pure function
 * of (mandate, steering, kit).
 */
describe("area coverage promotion (specialist packs)", () => {
  const SURGERY_KIT = [
    "Anesthesiology", "Executive Oversight", "IT & Systems", "Patient Access",
    "Pre-Operative Care", "Quality & Risk", "Scheduling", "Surgical Operations",
  ];
  const MANDATE_SURG = "Reduce surgical cancellations across the hospital by intervening before the day of surgery.";
  const hcPacks = packsFor("Healthcare");

  /** All five drafts agree: the 3 FHIR cores plus 4 extended classes, each
   * filed under a kit domain — what the real drafts evidently did. */
  const surgeryDraft = (): Draft => ({
    entities: [
      { name: "Patient", definition: "A person scheduled for surgery.", area: "Patient Access", attributes: [], systemOfRecord: null, aliases: [], evidence: "std" },
      { name: "Practitioner", definition: "A surgeon or clinician.", area: "Surgical Operations", attributes: [], systemOfRecord: null, aliases: [], evidence: "std" },
      { name: "Organization", definition: "The hospital.", area: "Executive Oversight", attributes: [], systemOfRecord: null, aliases: [], evidence: "std" },
      { name: "Appointment", definition: "A booked theatre slot.", area: "Scheduling", attributes: [], systemOfRecord: null, aliases: [], evidence: "std" },
      { name: "Observation", definition: "A recorded clinical measurement.", area: "Quality & Risk", attributes: [], systemOfRecord: null, aliases: [], evidence: "std" },
      { name: "Communication", definition: "A message to a patient or team.", area: "IT & Systems", attributes: [], systemOfRecord: null, aliases: [], evidence: "std" },
      { name: "Encounter", definition: "A pre-operative visit.", area: "Pre-Operative Care", attributes: [], systemOfRecord: null, aliases: [], evidence: "std" },
    ],
    relations: [], events: [],
    standardAlignment: [
      { entity: "Patient", standard: "http://hl7.org/fhir/Patient", vocabulary: "HL7 FHIR", relation: "skos:closeMatch", confidence: 0.9 },
      { entity: "Appointment", standard: "http://hl7.org/fhir/Appointment", vocabulary: "HL7 FHIR", relation: "skos:closeMatch", confidence: 0.9 },
    ],
    gaps: [],
  });
  const surgeryOpts = () => groundingFor(hcPacks, MANDATE_SURG, "the sponsor", SURGERY_KIT);
  const drafts5 = () => Array.from({ length: 5 }, () => surgeryDraft());

  it("promotes a demoted extended class for each kit domain the drafts covered", () => {
    const got = names(sandbox.reconcileVotedOntology(drafts5(), surgeryOpts()));
    for (const promoted of ["Appointment", "Observation", "Communication", "Encounter"]) {
      expect(got).toContain(promoted);
    }
  });

  it("the promoted entity carries the kit domain as its area", () => {
    const doc = sandbox.reconcileVotedOntology(drafts5(), surgeryOpts());
    const areaOf = (n: string) => (doc.entities as Array<{ name: string; area: string }>).find((e) => e.name === n)?.area;
    expect(areaOf("Appointment")).toBe("Scheduling");
    expect(areaOf("Communication")).toBe("IT & Systems");
  });

  it("a promoted class stops being a confirm gap", () => {
    const doc = sandbox.reconcileVotedOntology(drafts5(), surgeryOpts());
    const gapText = (doc.gaps as string[]).join(" ");
    expect(gapText).not.toContain('models "Appointment"');
  });

  it("a kit domain with no candidate becomes a NAMED gap, never an invention", () => {
    const doc = sandbox.reconcileVotedOntology(drafts5(), surgeryOpts());
    expect((doc.gaps as string[]).some((g) => g.includes('no standard concept covers "Anesthesiology"'))).toBe(true);
    // …and no entity was fabricated for it.
    const areas = (doc.entities as Array<{ area: string }>).map((e) => e.area);
    expect(areas).not.toContain("Anesthesiology");
  });

  it("promotion is deterministic — the same input twice gives the same document", () => {
    const a = sandbox.reconcileVotedOntology(drafts5(), surgeryOpts());
    const b = sandbox.reconcileVotedOntology(drafts5(), surgeryOpts());
    expect(a).toEqual(b);
  });

  it("without kit domains the old policy holds: extended classes stay demoted", () => {
    const opts = groundingFor(hcPacks, MANDATE_SURG, "the sponsor");
    const got = names(sandbox.reconcileVotedOntology(drafts5(), opts));
    for (const ext of ["Appointment", "Observation", "Communication", "Encounter"]) {
      expect(got).not.toContain(ext);
    }
  });

  it("a synthesised core with no areaHints files under the kit domain sharing its name", () => {
    // No drafts mention Patient at all — the core guarantee synthesises it,
    // and the token fallback places it in "Patient Access" instead of General.
    const empty = Array.from({ length: 5 }, () => ({ entities: [], relations: [], events: [], standardAlignment: [], gaps: [] }));
    const doc = sandbox.reconcileVotedOntology(empty as never, surgeryOpts());
    const patient = (doc.entities as Array<{ name: string; area: string }>).find((e) => e.name === "Patient");
    expect(patient?.area).toBe("Patient Access");
  });

  it("an ungrounded noun is still culled — promotion never readmits it", () => {
    const withInvented = () => {
      const d = surgeryDraft();
      (d.entities as Array<Record<string, unknown>>).push({ name: "Turnaround Velocity Index", definition: "x", area: "Anesthesiology", attributes: [], systemOfRecord: null, aliases: [], evidence: "x" });
      return d;
    };
    const got = names(sandbox.reconcileVotedOntology(Array.from({ length: 5 }, withInvented), surgeryOpts()));
    expect(got).not.toContain("Turnaround Velocity Index");
  });
});
