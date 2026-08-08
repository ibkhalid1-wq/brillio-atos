# Laila — Listen artifact snapshot (2026-08-07)

> **Why this file exists.** The Laila Domain Ontology and Current-State Atlas are both `stale`,
> and a **Regenerate** press replaces them **in place** — there is no ontology version id to roll
> back to, and the whole-programme snapshot ring is opaque. The corrections below came from **real
> stakeholder meetings** and are the *only* stakeholder input in either artifact. This committed,
> human-readable export is the sole record if someone regenerates. Restore from the JSON beside it.

- **Source:** engagement `3acf97de-fadd-48e1-99a7-15b80ef87cf7` ("Laila CRM"), read 2026-08-07.
- **Domain Ontology:** 33 entities, 35 relations. Status at capture: `stale` (staleAt `2026-08-08T01:51:17.814Z`).
- **Current-State Atlas:** 14 workflows. Status: `stale` (staleAt `2026-08-08T01:52:30.339Z`).
- **Operator override log:** 49 entries. By fieldKey: domainOntology×47, currentStateAtlas×2.

## The caveat that must travel with this

The override log records **that** an element was changed (the `note`), not the **diff** or the
**reason**. So these elements are *touched, not confirmed* — lightly grounded at best. The exact
corrected values live in the JSON artifacts beside this file; the log tells you which elements a
stakeholder deliberately moved, so a regeneration that reverts one is a real loss, not noise.

## Operator override log — every stakeholder correction, oldest first

| When (UTC) | Field | Correction |
|---|---|---|
| 2026-07-27 01:06:57 | `currentStateAtlas` | Workflow "Opportunity Signal Generation" moved to area "Marketing" |
| 2026-07-27 01:06:57 | `currentStateAtlas` | Workflow edited: "Opportunity Signal Generation" |
| 2026-07-27 03:16:36 | `domainOntology` | Entity edited: "Quote" |
| 2026-07-27 03:16:36 | `domainOntology` | Entity edited: "Contract" |
| 2026-07-27 03:19:55 | `domainOntology` | Entity removed: "User" |
| 2026-07-27 03:19:55 | `domainOntology` | Entity removed: "Pricing Item" |
| 2026-07-27 03:19:55 | `domainOntology` | Entity edited: "Lead" |
| 2026-07-27 03:19:55 | `domainOntology` | Entity edited: "Lead Score" |
| 2026-07-27 03:19:55 | `domainOntology` | Entity edited: "Proposal" |
| 2026-07-27 03:19:55 | `domainOntology` | Entity edited: "SOW" |
| 2026-07-27 03:19:55 | `domainOntology` | Entity edited: "Escalation" |
| 2026-07-27 03:19:55 | `domainOntology` | Entity edited: "Signal" |
| 2026-07-27 03:19:55 | `domainOntology` | Entity edited: "Signal Action" |
| 2026-07-27 03:19:55 | `domainOntology` | Entity edited: "Interaction" |
| 2026-07-27 03:19:55 | `domainOntology` | Entity edited: "Entity Profile" |
| 2026-07-27 03:19:55 | `domainOntology` | Entity edited: "Document" |
| 2026-07-27 03:33:05 | `domainOntology` | Entity removed: "Entity Profile" |
| 2026-07-27 03:33:05 | `domainOntology` | Entity edited: "Opportunity" |
| 2026-07-27 03:33:05 | `domainOntology` | Entity edited: "Forecast Snapshot" |
| 2026-07-27 03:33:05 | `domainOntology` | Entity edited: "Interaction" |
| 2026-07-27 03:52:03 | `domainOntology` | Entity edited: "Opportunity" |
| 2026-07-27 03:52:03 | `domainOntology` | Entity edited: "Opportunity Line Item" |
| 2026-07-27 03:52:03 | `domainOntology` | Entity edited: "Practice Forecast Split" |
| 2026-07-27 03:52:03 | `domainOntology` | Entity edited: "Practice Contribution" |
| 2026-07-27 03:52:03 | `domainOntology` | Entity edited: "Quote" |
| 2026-07-27 03:52:03 | `domainOntology` | Entity edited: "Proposal" |
| 2026-07-27 03:52:03 | `domainOntology` | Entity edited: "SOW" |
| 2026-07-27 03:52:03 | `domainOntology` | Entity edited: "Staffing" |
| 2026-07-27 03:52:03 | `domainOntology` | Entity edited: "Revenue Projection" |
| 2026-07-27 03:52:03 | `domainOntology` | Entity edited: "Signal" |
| 2026-07-27 03:52:03 | `domainOntology` | Entity edited: "Signal Action" |
| 2026-07-29 06:33:18 | `domainOntology` | Entity removed: "Interaction" |
| 2026-07-29 06:33:18 | `domainOntology` | Entity edited: "Account" |
| 2026-07-29 06:33:18 | `domainOntology` | Entity edited: "Buying Committee" |
| 2026-07-29 06:33:18 | `domainOntology` | Relation added: "Partner is a type of Account" |
| 2026-07-29 06:33:18 | `domainOntology` | Relation added: "Account produces Signal" |
| 2026-07-29 06:33:18 | `domainOntology` | Relation added: "Document applies to Account" |
| 2026-07-29 06:33:18 | `domainOntology` | Relation added: "Document applies to Lead" |
| 2026-07-29 06:33:18 | `domainOntology` | Relation added: "Document applies to Opportunity" |
| 2026-07-29 06:33:18 | `domainOntology` | Relation added: "Document applies to Contract" |
| 2026-07-29 06:33:18 | `domainOntology` | Relation added: "SOW is a type of Document" |
| 2026-07-29 06:33:18 | `domainOntology` | Relation added: "Partner participates in Opportunity" |
| 2026-07-29 06:33:18 | `domainOntology` | Relation added: "Signal Action applies to Signal" |
| 2026-07-29 06:33:18 | `domainOntology` | Relation removed: "Account produces Engagement" |
| 2026-07-29 06:33:18 | `domainOntology` | Relation removed: "Account produces Invoice" |
| 2026-07-29 06:33:18 | `domainOntology` | Relation removed: "Contract produces Billing Schedule" |
| 2026-07-29 06:33:18 | `domainOntology` | Relation removed: "Partner produces Account" |
| 2026-07-29 06:33:18 | `domainOntology` | Relation edited: "Opportunity produces Forecast Snapshot" |
| 2026-07-29 06:33:18 | `domainOntology` | Relation edited: "Contract produces SOW" |

## Files in this snapshot
- `domain-ontology.json` — full ontology content (entities, relations, attributes, evidence) at capture.
- `current-state-atlas.json` — full atlas content (workflows, steps, systems inventory, pain heatmap).
- `operator-overrides.json` — the raw 49-entry override log.
- `curation-context.json` — decision queue + gate reviews at capture.
