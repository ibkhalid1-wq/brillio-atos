# Aura — Import adapters (what feeds the ledger)

Two adapters turn an **already-exported** file into ledger claims. The transform layer is built and
tested (`src/v3/lib/ledger/adapters.ts`, `ledgerAdapters.test.ts`) against small fixtures constructed
from the public specs. **Fetching a real export is gated** on access (credentials / network) — the
transform is the part that needs neither, so it is what got built; the retrieval is specified, not
stubbed.

## Salesforce Metadata adapter (Laila as-is)

- **Source of the file:** `sf project retrieve` / the Metadata API `CustomObject` XML→JSON — a
  developer already runs this against the org; the adapter consumes the output file. **Retrieval is
  gated** (needs org credentials); the transform is not.
- **Maps to:** source `code-derived`, world **`as-is`** (the current system), layer **`configuration`**
  (how this org is set up today — the Tier-2 durability, set at the source, not guessed).
- **What it imports:** each `CustomObject` → an entity `exists` claim; each `field` → an attribute with
  a `dataType` claim (from `field.type`); each **picklist** → a `valueSet` claim whose members are the
  picklist values. **This closes the exact `valueSet` unknowns F-F named** — the opportunity stage set
  arrives from the export as a closed as-is claim, no interview needed for the current-system values.
- **What stays out:** layout/UI metadata, automation (flows/triggers) beyond their existence,
  profiles/permissions (a separate access-model import), and anything the org marks as managed-package
  internal. Field *history* is out — the ledger records the current export as one as-is snapshot, not a
  change log.

## FHIR StructureDefinition adapter (HLS pilot)

- **Source of the file:** an HL7-published or IG-published `StructureDefinition` JSON (e.g. a profile's
  `snapshot`). No credentials for the public specs; a private IG is a file the client provides.
- **Maps to:** source `external-standard`, world **`to-be`** (a standard you align toward), layer
  **`domain`** (a standard is a business-truth, not a system config — Tier-2 durability at the source).
- **What it imports:** the root `StructureDefinition.name` → an entity; each `snapshot.element` with a
  dotted path → an attribute; `element.type` → `dataType`; `element.min ≥ 1` → `optionality` (required);
  `element.binding.valueSet` → a `valueSet` claim referencing the bound ValueSet URL (`required`
  strength → closed; weaker → `weak`, a strong default awaiting confirmation).
- **What stays out:** the full ValueSet *expansion* (the adapter references the ValueSet by URL; expanding
  it is a second import), extensions beyond their presence, invariants/constraints (FHIRPath) — those are
  an `obligation`-shape import, specified later. Slicing is flattened to the sliced element's presence.

## Why these two, and the precedence they exercise

The adapters populate **both worlds** and let precedence do real work: a Salesforce picklist (as-is,
code-derived) and a FHIR binding (to-be, external-standard) on the *same* attribute are a **cross-world
pair → coexist**, which the deviation register reads as "your current stages vs the standard's" — the
confirm-or-deviate question, grounded. Where a client document (to-be) later contradicts the FHIR
binding, precedence gives the **client document the win** (hard case 3), with the standard retained as
the alignment reference. The adapters are how the ledger gets real as-is facts to weigh, instead of a
reverse-engineered prototype standing in for the current system.

## Gated (needs access, not built here)

- Live retrieval of either export (org credentials for Salesforce; a private IG endpoint for FHIR).
- ValueSet expansion (a second FHIR call).
- The access-model / permissions import (Salesforce profiles → the 56-role resolution).
