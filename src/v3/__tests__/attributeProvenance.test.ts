/**
 * WHERE DID THIS FIELD COME FROM?
 *
 * Tracing `Account.segment` reached the ENTITY's evidence — "Laila Prototype — CRM
 * Domain Ontology (dev demo extract); Brillio Agentic CRM — Domain Ontology
 * (Workflow Design); schema.org/Organization" — and stopped there. `attributes`
 * was an array of bare STRINGS in the generated ontology, so `segment` had no
 * provenance of its own.
 *
 * That made two very different things indistinguishable: a field a stakeholder
 * named in an interview, and a field the model listed while summarising a demo
 * extract. Both opened a `#dataType` question, both were asked of a person, and
 * nothing on any screen could tell them apart. Fifty-three questions on one system
 * with no way to know which were about real fields.
 *
 * The generator may now state evidence per attribute. THE ANSWER THAT MATTERS IS
 * NULL: a field whose origin the record does not state must READ as unstated,
 * never as an ordinary question, and never be quietly given its entity's evidence
 * — that is the borrowed provenance this exists to end.
 */
import { describe, it, expect } from "vitest";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { attributeEvidence } from "@/v3/lib/ledger/derivedTypes";
import { buildUnknownQueue } from "@/v3/lib/ledger/projections";

const ontology = (attributes: unknown[]) => ({
  entities: [{
    name: "Account", area: "Sales", systemOfRecord: "CRM", attributes,
    evidence: "Laila Prototype — CRM Domain Ontology (dev demo extract)",
  }],
  relations: [],
});
const store = (attributes: unknown[]) =>
  migrate({ ontology: ontology(attributes), atlas: {}, overrides: [] } as unknown as Snapshot);

describe("an attribute can state its own source", () => {
  it("REGRESSION: the stated evidence is recorded against the FIELD", () => {
    const s = store([{ name: "segment", evidence: "Dana Patel, RevOps — 'we segment by tier'" }]);
    expect(attributeEvidence(s, "el:attr:account.segment"))
      .toBe("Dana Patel, RevOps — 'we segment by tier'");
  });

  it("REGRESSION: a bare string yields NULL — never the entity's evidence", () => {
    // The borrowed provenance this exists to end. `Account` has evidence; `segment`
    // does not, and inheriting it would make an unsourced field look sourced.
    const s = store(["segment"]);
    expect(attributeEvidence(s, "el:attr:account.segment")).toBeNull();
  });

  it("every artifact ever written still reads — a bare string is a valid attribute", () => {
    const s = store(["segment", "tier"]);
    const ids = s.elements().map((e) => e.id);
    expect(ids).toContain("el:attr:account.segment");
    expect(ids).toContain("el:attr:account.tier");
  });

  it("both shapes in one list, each read on its own terms", () => {
    const s = store(["tier", { name: "segment", evidence: "the CRM export" }]);
    expect(attributeEvidence(s, "el:attr:account.segment")).toBe("the CRM export");
    expect(attributeEvidence(s, "el:attr:account.tier")).toBeNull();
  });

  it("an empty or blank evidence string is NOT a source", () => {
    for (const evidence of ["", "   ", null, undefined]) {
      const s = store([{ name: "segment", evidence }]);
      expect(attributeEvidence(s, "el:attr:account.segment"), String(evidence)).toBeNull();
    }
  });
});

describe("recording a source asks nothing", () => {
  it("REGRESSION: evidence is a WEAK claim — it never becomes a question", () => {
    // A provenance note that opened a question would have added one per field,
    // which is the opposite of the point.
    const withEv = store([{ name: "segment", evidence: "Dana Patel, RevOps" }]);
    const without = store(["segment"]);
    const open = (s: ReturnType<typeof store>) =>
      buildUnknownQueue(s).items.filter((i) => i.status === "open").length;
    expect(open(withEv)).toBe(open(without));
    expect(buildUnknownQueue(withEv).items.some((i) => i.about.endsWith("#evidence")
      && i.status === "open"), "the source note opened a question").toBe(false);
  });

  it("the field's own questions are unchanged by having a source", () => {
    const s = store([{ name: "segment", evidence: "Dana Patel, RevOps" }]);
    const open = buildUnknownQueue(s).items.filter((i) => i.status === "open").map((i) => i.about);
    expect(open, "the type question is still asked").toContain("el:attr:account.segment#dataType");
  });
});

describe("the surfaces say when nothing is on record", () => {
  const src = (f: string) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, `../components/flow/${f}`), "utf8") as string;

  it("the question panel names the source, or names its absence", () => {
    const inbox = src("OperatorInbox.tsx");
    expect(inbox).toContain("attributeEvidence");
    expect(inbox).toContain("no source on record");
  });

  it("the typing grid does too", () => {
    const grid = src("TypingGrid.tsx");
    expect(grid).toContain("attributeEvidence");
    expect(grid).toContain("no source on record");
  });

  it("the generator is asked for it, and told why a bare string is not enough", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const agent = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8") as string;
    expect(agent).toContain('"evidence": "verbatim quote or the document that names it');
    expect(agent, "the prompt must say what a missing source costs").toMatch(/cannot be told apart/);
  });
});
