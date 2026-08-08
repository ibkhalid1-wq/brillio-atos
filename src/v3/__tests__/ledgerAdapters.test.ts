/**
 * Import adapters — small fixtures constructed from the public specs (no network,
 * no credentials). Salesforce picklists and FHIR bindings close valueSet unknowns,
 * and durability (Tier 2) is set at the source (critique C4's committed consumer).
 */
import { describe, it, expect } from "vitest";
import { createLedgerStore } from "@/v3/lib/ledger/store";
import { salesforceToClaims, fhirToClaims, type SfCustomObject, type FhirStructureDefinition } from "@/v3/lib/ledger/adapters";

// Salesforce Metadata CustomObject shape (fields + picklistValues), as `sf metadata retrieve` emits.
const SF_OPPORTUNITY: SfCustomObject = {
  fullName: "Opportunity",
  fields: [
    { fullName: "StageName", type: "Picklist", picklistValues: [
      { fullName: "Prospecting" }, { fullName: "Qualification" }, { fullName: "Proposal" }, { fullName: "Closed Won" }, { fullName: "Closed Lost" }] },
    { fullName: "Amount", type: "Currency" },
    { fullName: "CloseDate", type: "Date" },
  ],
};

// FHIR StructureDefinition snapshot shape (element.path/min/max/type/binding), as HL7 publishes.
const FHIR_ENCOUNTER: FhirStructureDefinition = {
  resourceType: "StructureDefinition", name: "Encounter", kind: "resource",
  snapshot: { element: [
    { path: "Encounter" },
    { path: "Encounter.status", min: 1, max: "1", type: [{ code: "code" }], binding: { strength: "required", valueSet: "http://hl7.org/fhir/ValueSet/encounter-status" } },
    { path: "Encounter.subject", min: 1, max: "1", type: [{ code: "Reference" }] },
  ] },
};

describe("Salesforce Metadata adapter (as-is configuration)", () => {
  const s = createLedgerStore();
  salesforceToClaims(SF_OPPORTUNITY, s);
  it("closes the stage value set from the picklist — the F-F unknown, answered from the export", () => {
    const vs = s.liveClaimsAbout("el:attr:opportunity.stagename#valueSet");
    expect(vs.length).toBe(1);
    expect(vs[0].status).toBe("closed");
    expect(vs[0].value).toEqual({ kind: "ref-list", to: ["Prospecting", "Qualification", "Proposal", "Closed Won", "Closed Lost"] });
  });
  it("tags every imported claim world=as-is, source=code-derived, layer=configuration (C4)", () => {
    for (const c of s.claims()) { expect(c.world).toBe("as-is"); expect(c.source).toBe("code-derived"); expect(c.layer).toBe("configuration"); }
  });
});

describe("FHIR StructureDefinition adapter (to-be external-standard)", () => {
  const s = createLedgerStore();
  fhirToClaims(FHIR_ENCOUNTER, s);
  it("imports the binding as an external-standard value set and min≥1 as required", () => {
    const vs = s.liveClaimsAbout("el:attr:encounter.status#valueSet");
    expect(vs[0].source).toBe("external-standard");
    expect(vs[0].value).toEqual({ kind: "ref", to: "http://hl7.org/fhir/ValueSet/encounter-status" });
    const opt = s.liveClaimsAbout("el:attr:encounter.subject#optionality");
    expect(opt[0].value).toEqual({ kind: "scalar", value: true }); // min 1 → required
  });
  it("tags every imported claim world=to-be, layer=domain (a standard is a domain truth, C4)", () => {
    for (const c of s.claims()) { expect(c.world).toBe("to-be"); expect(c.layer).toBe("domain"); }
  });
});

describe("as-is import populates the sparse as-is world alongside a to-be unknown", () => {
  it("an as-is stage set and a to-be ?unknown coexist (a deviation-eligible pair, not an overwrite)", () => {
    const s = createLedgerStore();
    // migrated to-be unknown for the same locus
    const open = s.assert({ about: "el:attr:opportunity.stagename#valueSet", value: { kind: "unknown" }, world: "to-be", layer: "domain", source: "generated", ownerWhileOpen: { kind: "role", role: "Sales Leaders" }, status: "open" });
    salesforceToClaims(SF_OPPORTUNITY, s); // as-is import
    const live = s.liveClaimsAbout("el:attr:opportunity.stagename#valueSet");
    expect(live.length).toBe(2); // both worlds live — as-is closed + to-be open, no overwrite
    expect(open.supersededBy).toBeUndefined();
  });
});
