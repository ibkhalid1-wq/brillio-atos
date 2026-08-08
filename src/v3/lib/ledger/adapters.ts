/**
 * Import adapters (docs/aura/import-adapters.md §3.1). Transform an ALREADY-EXPORTED
 * file (no network, no credentials — fetching is gated) into ledger claims.
 *
 *  - Salesforce Metadata (Laila as-is): source `code-derived`, world `as-is`, layer
 *    `configuration`. A picklist's values CLOSE the very `valueSet` unknowns F-F named.
 *  - FHIR StructureDefinition (HLS pilot): source `external-standard`, world `to-be`,
 *    layer `domain`. A binding provides the standard's value set; min/max give
 *    cardinality + optionality.
 *
 * Durability (Tier 2) is set here at the source — this is Tier 2's committed consumer
 * (ledger-critique.md C4): configuration vs domain is decided by *where the claim came
 * from*, not guessed.
 */
import type { LedgerStore } from "./store";
import { aboutOf, type ClaimValue, type Owner } from "./types";

const slug = (s: unknown): string => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
const OWNER: Owner = { kind: "role", role: "Sales Ops" };

// ── Salesforce Metadata (CustomObject / picklists) → as-is configuration claims ──
export interface SfPicklistValue { fullName: string }
export interface SfField { fullName: string; type: string; picklistValues?: SfPicklistValue[] }
export interface SfCustomObject { fullName: string; fields?: SfField[] }

export function salesforceToClaims(obj: SfCustomObject, store: LedgerStore): void {
  const eid = `el:entity:${slug(obj.fullName)}`;
  store.addElement({ id: eid, kind: "entity", name: obj.fullName });
  store.assert({ about: aboutOf(eid, "exists"), value: { kind: "scalar", value: true }, source: "code-derived", world: "as-is", layer: "configuration", ownerWhileOpen: OWNER, status: "closed", closedBy: { method: "import", by: "sf-metadata-export" } });
  for (const f of obj.fields ?? []) {
    const aid = `el:attr:${slug(obj.fullName)}.${slug(f.fullName)}`;
    store.addElement({ id: aid, kind: "attribute", name: f.fullName, of: eid });
    store.assert({ about: aboutOf(aid, "dataType"), value: { kind: "scalar", value: f.type }, source: "code-derived", world: "as-is", layer: "configuration", ownerWhileOpen: OWNER, status: "closed", closedBy: { method: "import", by: "sf-metadata-export" } });
    if (f.picklistValues?.length) {
      const members = f.picklistValues.map((p) => p.fullName);
      store.assert({ about: aboutOf(aid, "valueSet"), value: { kind: "ref-list", to: members }, source: "code-derived", world: "as-is", layer: "configuration", ownerWhileOpen: OWNER, status: "closed", closedBy: { method: "import", by: "sf-metadata-export" } });
    }
  }
}

// ── FHIR StructureDefinition → to-be external-standard domain claims ──
export interface FhirBinding { strength?: string; valueSet?: string }
export interface FhirElement { path: string; min?: number; max?: string; type?: Array<{ code: string }>; binding?: FhirBinding }
export interface FhirStructureDefinition { resourceType: "StructureDefinition"; name: string; kind?: string; snapshot?: { element: FhirElement[] } }

export function fhirToClaims(sd: FhirStructureDefinition, store: LedgerStore): void {
  const rootName = sd.name;
  const eid = `el:entity:${slug(rootName)}`;
  store.addElement({ id: eid, kind: "entity", name: rootName });
  store.assert({ about: aboutOf(eid, "exists"), value: { kind: "scalar", value: true }, source: "external-standard", world: "to-be", layer: "domain", ownerWhileOpen: OWNER, status: "closed", closedBy: { method: "import", by: `fhir:${sd.name}` } });
  for (const el of sd.snapshot?.element ?? []) {
    const parts = el.path.split(".");
    if (parts.length < 2) continue; // the root element itself
    const attr = parts.slice(1).join(".");
    const aid = `el:attr:${slug(rootName)}.${slug(attr)}`;
    store.addElement({ id: aid, kind: "attribute", name: attr, of: eid });
    const std = { method: "import" as const, by: `fhir:${sd.name}` };
    if (el.type?.length) store.assert({ about: aboutOf(aid, "dataType"), value: { kind: "scalar", value: el.type.map((t) => t.code).join("|") }, source: "external-standard", world: "to-be", layer: "domain", ownerWhileOpen: OWNER, status: "closed", closedBy: std });
    if (typeof el.min === "number") {
      const required: ClaimValue = { kind: "scalar", value: el.min >= 1 };
      store.assert({ about: aboutOf(aid, "optionality"), value: required, source: "external-standard", world: "to-be", layer: "domain", ownerWhileOpen: OWNER, status: "closed", closedBy: std });
    }
    if (el.binding?.valueSet) store.assert({ about: aboutOf(aid, "valueSet"), value: { kind: "ref", to: el.binding.valueSet }, source: "external-standard", world: "to-be", layer: "domain", ownerWhileOpen: OWNER, status: el.binding.strength === "required" ? "closed" : "weak", closedBy: std });
  }
}
