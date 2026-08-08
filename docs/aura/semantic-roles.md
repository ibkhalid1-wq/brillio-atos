# Semantic roles — the bridge between the fabric and the design system

> Status: spec + the client-buildable deriver. Grounded on Laila's real ontology
> (33 entities, 35 relations, 178 attributes, entity-level `standardAlignment`).
>
> **Reframed by the claims ledger (2026-08-08).** The ontology values this deriver reads are now
> *claims* (`ledger-spec.md`): mostly `generated`/`weak`, world `to-be`. The "0 / 178 typed" gap is
> not a missing field but **178 `attr#dataType` open-unknown claims** in the ledger, and the "213
> assignments to capture" cost is the ledger's **unknown queue** (measured 395 open, ranked by owner).
> Role derivation (derived-vs-heuristic) is orthogonal to claim status and stands unchanged; the point
> that supersedes here is that "types are absent" is now a first-class *open claim*, not an omission.

## The contract

The [fabric](./fabric.md) knows structure and ontology. [Meridian](./prototype-design-system.md)
knows appearance. **Neither references the other.** Both reference a third, small vocabulary — the
**semantic roles** here. The fabric *emits* a role on every node; the design system *consumes* the
role and renders it. The one and only place the two vocabularies meet is the
[role → component map](#5--role--component-map-the-only-meeting-point) at the end of this doc — which
is precisely what makes the design system swappable without touching the fabric, and the fabric
retargetable without touching the design system.

```
ontology/atlas ──derive──▶ fabric node { …, role: "monetary" }
                                          │
                                    (semantic-roles vocabulary)
                                          │
design system  ◀──consume── role→component map { monetary → .m-cell (tabular, right-aligned) }
```

## 1 · The vocabulary

Roles are a closed set, grouped by what they answer.

**Identity & labelling** — *what is this record?*
`identifier` · `title` · `description`

**Value types** — *what kind of value is this field?*
`monetary` · `date` · `quantity` · `code` · `free-text` · `boolean`

**State** — *where does this record stand?*
`status` · `health` · `priority`

**Relationships** — *how does it connect?*
`parent-ref` (single owning parent) · `collection` (child list) · `cross-ref` (lateral link) ·
`multi-select` (many-to-many membership)

**Actions** — *what can you do?*
`action-primary` · `action-secondary` · `action-destructive` · `action-navigational`

## 2 · Derivation from what the ontology already knows and discards

Every role the fabric can assign **deterministically** is a model call it never makes. Here is what
each ontology signal yields — and, honestly, what it does *not*.

### Relationship roles — from cardinality *(fully derivable; present on all 35)*

Cardinality is on every relation, and today it is discarded at render. It fully determines the
relationship role:

| Cardinality | Role emitted | On |
|---|---|---|
| `1:N` | `collection` | the parent's detail (a child list/table) |
| `N:1` | `parent-ref` | the child's form/detail (an owning-parent link) |
| `1:1` | `parent-ref` (inline) | an inline panel on the owner |
| `N:M` | `multi-select` | both sides (membership) |

Laila has 33× `1:N` → 33 `collection`/`parent-ref` pairs, 1× `1:1`, 1× `N:1` — **35 relationship
roles, 100% derived, zero model calls.**

### Required markers — from optionality *(would be derivable; ABSENT on all 35)*

Optionality → the form's required marker (`.m-req`) and whether a `collection` can be empty. But
optionality is **absent on all 35 relations** (see [seed-data.md](./seed-data.md)). So every required
marker is currently a **decision, not a derivation** — the single biggest gap between "could be
deterministic" and "is". Filling optionality in Listen converts ~35 decisions into derivations.

### Entity-standard roles — from `standardAlignment` *(partly derivable; entity-level only)*

`standardAlignment` is present and useful — but **entity-level**, not attribute-level:

```jsonc
{ "entity": "Account", "relation": "skos:closeMatch",
  "standard": "https://schema.org/Organization", "confidence": 0.95, "vocabulary": "schema.org" }
```

So it tells us *Account is an Organization, Contact is a Person* — which fixes the entity's
`title`/`identifier` convention (an Organization titles by legal name; a Person by full name) and its
detail-header shape. It does **not** carry the per-attribute FIBO amount / FHIR quantity codes the
ideal design hoped for — those aren't in this ontology. **Finding:** attribute-level standard
alignment is where monetary/quantity/date roles *could* become fully deterministic; today they can't
be read, so they fall to the heuristic below. (Recorded as **F-D**; per-attribute alignment is
*mixed* — a generator proposes the code, domain work confirms it — not a pure Listen ask.)

### Value-type roles — from attribute types *(NOT derivable here — types are absent)*

The ideal: attribute `type` → value role. The reality in this ontology: **all 178 attributes are
bare untyped strings** (`"amount"`, `"closeDate"`, `"stage"`, `"annualRevenue"`, `"owner"`) — there
is no `type` field to read. So value-type roles are assigned by a **name heuristic**: deterministic
and reproducible, but a *guess*, and it must be marked low-confidence:

| Attribute-name pattern | Role (heuristic) |
|---|---|
| `amount`, `*revenue`, `price`, `value`, `cost`, `*fee` | `monetary` |
| `*date`, `*at`, `closeDate`, `dueOn` | `date` |
| `count`, `qty`, `*number`, `score`, `*percent` | `quantity` |
| `stage`, `status`, `state`, `health`, `priority` | `status` / `health` / `priority` |
| `owner`, `account`, `*_manager`, `key_decision_maker` | `parent-ref` / `cross-ref` |
| the entity's name/id attribute | `identifier` / `title` |
| everything else | `free-text` |

This heuristic is the right *default*, but the honest position is: **value-type roles are the least
derivable dimension in this ontology**, because the type information was never captured. Every
heuristic assignment is surfaced with its confidence so a human confirms the ambiguous ones (is
`score` a quantity or a `health`? is `type` a `code` or a `status`?).

## 3 · Derivable vs decision — the measure

The derivable fraction is the measure of how much of prototype generation can **stop being
generative**:

| Role dimension | Signal | Derivable now? | Count (Laila) |
|---|---|---|---|
| Relationship roles | cardinality | **Yes, fully** | 35 / 35 |
| Entity title/identity convention | `standardAlignment` | **Yes** where aligned | ~20 / 33 entities |
| Required markers | optionality | **No** — absent | 0 / 35 (all decisions) |
| Value-type roles | attribute `type` | **No** — types absent; name-heuristic only | 0 / 178 typed; ~70% heuristic-confident |
| `title` vs `description` split | — | **Decision** (which string leads) | per entity |
| Action roles | atlas step verb | **Partly** (create/edit/delete verbs map; nuanced ones decide) | — |

**Headline:** the *structural* roles (all 35 relationship roles) are 100% deterministic today — the
fabric can wire every list, nested list, and parent link with **no model call**. The *value* roles
are the opposite — 0% type-derived, because the ontology has no attribute-`type` field to read.

### The remediation is NOT one big Listen ask — it splits three ways

It is tempting to say "213 assignments (178 attributes + 35 optionalities) need capturing." That
conflates two very different costs. The honest split:

- **~178 attribute types → a schema + generator-prompt fix. Gated, small. Not a Listen ask.** They
  are untyped because there is *no field* for a type, not because nobody was asked. The generator
  would emit `amount: monetary` today if there were somewhere to put it — the name carries the
  signal. Stakeholders answer this *badly* anyway: nobody says "that attribute is of type monetary,"
  they say "that's a dollar figure." So the generator proposes; a human confirms in passing.
- **~35 optionalities → a genuine Listen ask.** Required-vs-optional is a business rule only a
  domain owner can state — **one question per relation**, routed to the session that owns it, not a
  bulk survey.
- **Per-attribute standard alignment → mixed.** A generator can *propose* the FIBO/FHIR code; only
  domain work *confirms* it.

So the lever is **one gated schema change + one generator-prompt change + ~35 one-line Listen
questions** — the difference between "we need a lot of stakeholder time" and "a schema fix plus one
question per relation." Recorded as **F-D** in [`artifact-schema-findings.md`](./artifact-schema-findings.md).

## 4 · What the deriver looks like

`deriveRoles(ontology) → Record<entityAttr | relation, { role, source, confidence }>` — a pure
function over the stored ontology (client-buildable, testable): cardinality → relationship roles
(confidence 1.0), `standardAlignment` → entity conventions (confidence = the alignment's own), name
heuristic → value roles (confidence per pattern strength). It emits confidences so the low ones route
to Listen, and it references only ontology ids — never a design token.

## 5 · Role → component map (the only meeting point)

This table — and nothing else — couples the two vocabularies. Swap Meridian for another system by
rewriting only this column; the fabric and the roles do not change.

| Role | Meridian component · variant |
|---|---|
| `identifier` | `.m-cell-main` (mono, as row key) |
| `title` | `.m-title` (detail) · `.m-cell-main` (row) |
| `description` | `.m-sub` · `.m-cell-sub` |
| `monetary` | `.m-cell` right-aligned, tabular-nums |
| `date` | `.m-cell` (formatted) |
| `quantity` | `.m-cell` right-aligned, tabular-nums |
| `code` | `.m-badge` (neutral) |
| `free-text` | `.m-cell` / `.m-input` / `.m-textarea` (in a form) |
| `boolean` | `.m-checkbox` (form) · `.m-dot` (read) |
| `status` | `.m-badge` · `.m-tab` filter |
| `health` | `.m-pill--good/warn/risk` + `.m-dot--*` |
| `priority` | `.m-pill--warn/risk` |
| `parent-ref` | `.m-crumbs` link · `.m-select` (edit) |
| `collection` | `.m-table` + `.m-pagination` (or nested `.m-card` list) |
| `cross-ref` | `.m-chip` |
| `multi-select` | `.m-chip` set (edit: multi-select) |
| `action-primary` | `.m-btn--primary` |
| `action-secondary` | `.m-btn--secondary` |
| `action-destructive` | `.m-btn--danger` |
| `action-navigational` | `.m-btn--ghost` · `.m-nav-item` |

## 6 · Buildable now vs gated

- **Buildable now (client, deterministic, testable):** the role vocabulary, `deriveRoles()`
  (cardinality + standardAlignment + name heuristic, with confidences), and the role→component map.
  Pure functions over the stored ontology; no model, no edge.
- **Decision/model:** the low-confidence value roles, the title/description split, and required
  markers — until attribute types and optionality are captured, these need a human (in Listen) or a
  scoped model call. This is the same content-vs-structure line the fabric and seed-data specs draw;
  no new gated surface, and it composes with **F-E**.
