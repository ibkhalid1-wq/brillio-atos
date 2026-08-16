/**
 * The standard's facts reach the pixels (2026-08-16).
 *
 * Two ends of the same thread the packs now carry:
 *  - An ontology attribute that CARRIES ITS VALUES ("values": [...] — written
 *    by the reconciler from the standard backbone) seeds from that closed set,
 *    outranking the generic pools. On the Laila New 2 build a Lead Source read
 *    "Emerging" / "Global" / "Priority" — pool words standing in for values
 *    nobody stated — while the standard's own set sat unexpressed.
 *  - A prototype cannot be more certain than what it was built from: the same
 *    build self-assessed 0.98 atop a 0.4–0.6 chain. `withDerivedConfidence`
 *    caps it at the weakest consumed upstream and says which one that was.
 */
import { describe, expect, it } from "vitest";
import { generateSeed } from "@shared/seedData.ts";
import { withDerivedConfidence } from "@shared/prototypeRefine.ts";

const ontology = {
  entities: [
    {
      name: "Lead",
      attributes: [
        { name: "leadName", kind: "string", evidence: "CRM standardBackbone — to confirm" },
        { name: "leadSource", kind: "enum", values: ["Web", "Event", "Referral", "Outbound"], evidence: "CRM standardBackbone — to confirm" },
      ],
    },
    { name: "Account", attributes: [{ name: "accountName" }] },
  ],
  relations: [{ from: "Account", to: "Lead", cardinality: "1:N" }],
};

describe("seed values come from the attribute's own closed set", () => {
  const seed = generateSeed(ontology, "vtest");
  const leads = seed.records.Lead ?? [];

  it("every seeded value is a member of the stated set — never a pool word", () => {
    expect(leads.length).toBeGreaterThan(3);
    const allowed = new Set(["Web", "Event", "Referral", "Outbound"]);
    for (const row of leads) {
      const v = row.leadSource;
      if (v === null || v === undefined) continue;   // a planted missing-optional is fine
      expect(allowed.has(String(v)), `leadSource "${v}" is not in the stated value set`).toBe(true);
    }
  });

  it("a stored value vocabulary still outranks the attribute's own set", () => {
    const vocab = { kind: "value-vocabulary", values: { "Lead.leadSource": ["Inbound", "Partner-sourced"] } };
    const covered = generateSeed(ontology, "vtest", { vocabulary: vocab });
    const vals = new Set((covered.records.Lead ?? []).map((r) => String(r.leadSource)));
    for (const v of vals) {
      if (v === "null" || v === "undefined") continue;
      expect(["Inbound", "Partner-sourced"]).toContain(v);
    }
  });
});

describe("a build's confidence is capped by its weakest input", () => {
  it("caps and names the weakest upstream", () => {
    const inner = {
      domainOntology: { confidence: 0.5 },
      currentStateAtlas: { confidence: 0.4 },
      experienceDesign: { confidence: 0.6 },
      agenticBlueprint: { confidence: 0.7 },
    };
    const out = withDerivedConfidence({ confidence: 0.98, html: "x" }, inner);
    expect(out.confidence).toBe(0.4);
    expect(String(out.confidenceBasis)).toMatch(/currentStateAtlas \(0\.4\)/);
    expect(String(out.confidenceBasis)).toMatch(/0\.98/);
  });

  it("an honest self-assessment below the chain is left alone", () => {
    const out = withDerivedConfidence({ confidence: 0.3 }, { domainOntology: { confidence: 0.5 } });
    expect(out.confidence).toBe(0.3);
    expect(out.confidenceBasis).toBeUndefined();
  });

  it("no upstream confidences, no cap — nothing to derive from", () => {
    const out = withDerivedConfidence({ confidence: 0.98 }, {});
    expect(out.confidence).toBe(0.98);
  });
});
