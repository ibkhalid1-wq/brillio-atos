# Aura — Blueprint consolidation + actionable headline numbers

Two fixes in the "one model, many surfaces" pattern this redesign keeps correcting.
Surface + read-model work over existing projections, verified live on `Laila CRM` (the
program with a generated Agentic Blueprint). Frozen core untouched; findings called out.

---

## 1 · The blueprint is one model, not ten documents — canvas + lenses

**Before:** the Agentic Blueprint studio (`BlueprintStudio`) was ten top-level accordions —
orchestration map, journeys, agents, orchestration pattern, data contracts, HITL points,
eval plan, build sequence, track plan, gaps. The summary told the operator nothing; every
answer was one click into a drawer, ten times.

**After (the target, not the fallback):** ONE canvas with LENSES. `BlueprintGraph` now owns
a lens toggle — the same agents, re-emphasised:

| Lens | What the same canvas emphasises |
|---|---|
| **Flow** (default) | the derived dataflow edges (A feeds B where A's outputs meet B's inputs) |
| **Data** | each agent's data contracts — the inputs it reads (`↓`) and outputs it writes (`↑`) |
| **HITL** | the agents a human gates are highlighted; the rest dim |
| **Eval** | each agent's pass bar from the eval plan |
| **Build** | agents numbered by their build-sequence slice |

Above the canvas, an inline **summary strip** reads the counts so the operator learns the
shape without opening a drawer: *"One model, five lenses: **6** agents · **7** data contracts ·
**2** HITL points · **4** evals · **6** build slices · **5** journeys."* The former ten
accordions are reframed: a divider states *"the sections below edit the one model above — each
is the underlying detail of a lens, not a separate document,"* so the editable tables remain
the CRUD path (progressive disclosure) while the canvas+lenses is the primary read surface.

**Claim status per element:** each agent node shows its autonomy as a claim — `ACT-WITH-APPROVAL`
/ `SUGGEST` where decided, and **`?unknown autonomy`** (amber) where the blueprint-layer
automation decision is still open. The lens bar shows an `N ?unknown` chip so those
blueprint-layer unknowns are visible and, eventually, answerable — consistent with every
other surface.

Verified live: the five lenses toggle on one canvas; HITL dims all but the gated **Deal
Pricing Agent** ("⛊ Deal Pricing Approval"); the summary counts render inline. Screenshots
in the session.

*Each former sub-view → a lens:* orchestration map = **Flow**; data contracts = **Data**
overlay; HITL points = **HITL**; eval plan = **Eval**; build sequence = **Build**; journeys
and track plan remain edit-sections beneath (the journey grid is a distinct editor, kept as
detail). No sub-view is a top-level drawer hiding a table anymore.

---

## 2 · The "evidence changed · Regenerate" banner → claim-status + targeted intent

**Before:** *"Evidence changed since this document was generated · Regenerate"* — a generic
staleness flag offering to nuke-and-rebuild the whole document.

**After** (in `FlowArtifactStudio`, so every artifact incl. the blueprint gets it):
- Reads as **claim status**, not generic staleness: *"**The claims this Agentic Blueprint
  rests on moved** since it was generated — an upstream deliverable was rebuilt or its own
  inputs changed."* (The two real `stale` signals — an upstream `status:"stale"` cascade, or
  this doc's own input-fingerprint change — are what it reports.)
- **Names the intended path honestly:** *"A targeted update of just the affected sections is
  the intended path; today only a full rebuild is wired."* The button is relabelled **"↻
  Rebuild in full"** with a title spelling out it *replaces* the whole document — nuke-and-
  rebuild is never presented as if it were the incremental update.
- The stakeholder-correction warning ("N corrections would be replaced — a full rebuild does
  not merge them") is kept.

**Finding (F-D, core/read-model):** the artifact model carries only a boolean `stale` (two
signals, no per-locus diff), so the banner can name *that* claims moved and *which cause*, but
not yet *which specific loci* and *which sections*. Section-level "what changed" + the
targeted-update write both need the incremental fabric wiring (the diff already exists as
`docSectionDiff` for the what-changed band but is not threaded to this staleness banner) —
reported, not made.

Verified live: the blueprint studio shows the reframed banner + "Rebuild in full".

---

## 3 · Headline numbers — actionable or honestly static (audit)

Rule applied everywhere: a displayed number is **either** actionable (clicks through to the
thing it counts) **or** styled as a plain, non-interactive stat — never a prominent number
that looks clickable and isn't.

### Made actionable (drill-through) — the Design Loop "Stakeholders shape it" panel
This is the most action-relevant thing on the panel, so it was wired, not removed. Each is
now a **work-queue filter** that drills to the exact questions it counts (phrased plain-
language, each with its owner), off the one `queue` projection:

| Number | Now does |
|---|---|
| **146** open unknowns owned by a role | drills to all role-owned open questions |
| **59** blocking — gates the Architect | filters to the blocking set |
| **87** answerable — send a link now | filters to the answerable set |
| **0** blocked — needs unsticking | disabled (nothing to show), not a dead affordance |

Verified live: clicking "59 blocking" reveals the 59 questions ("What values can status take?
→ Sales Ops", "→ Finance", …); the segment highlights; a "+N more" points to the Discover
inbox for the long tail.

### Kept honestly static (read-only stats, clearly non-interactive)
- **"0 stakeholder sign-offs on record · ◇ provisional"** — gated (the assertion write path).
  The click-through to sign-off already exists as the separate *"open Validation"* button;
  the number itself is a plain stat with a provisional mark, not styled as a button.
- **"0 asserted intents"**, **"0 stakeholder refinements"** (Joint zone) — gated, provisional,
  plain stats.
- **Blueprint summary counts** (6 agents · 7 data contracts · …) — a summary that points to
  the lenses/sections; the interaction is the lens toggle and the section editors, so the
  counts read as plain stats.
- **Discover goal headline** (355 open · 0 answered · 6 unowned · 11 seams) and the **Work-
  header** readouts (HEARD, Convergence, UNOWNED strip) — summaries; the action lives in the
  inbox/roster below. The **HEARD** stat is the one that *is* a button (opens the Discover
  tab) and is styled as such.

No number was found that looks interactive but isn't, after this pass.

---

## Findings (reported, not made)
- **F-D (core/read-model):** the staleness banner can't yet name *which sections/loci* moved or
  offer a section-only update — needs the incremental fabric (a claim-diff threaded to the
  banner + a targeted-regen write). The `docSectionDiff` what-changed band exists but isn't
  wired to this banner.
- **Agent ↔ ledger claim link:** an agent's `?unknown autonomy` is read from the *doc*
  (no autonomy set), a faithful blueprint-layer proxy. Linking it to the atlas step's ledger
  `automationDisposition` claim (so answering it in the ledger closes it here) needs the
  binder — the same gated graph-node↔ledger-element link as elsewhere.

## Verification
`tsc` + eslint clean; verified live on `Laila CRM`: five-lens canvas with HITL emphasis, the
summary counts, the reframed claim-status banner, and the Design Loop numbers drilling to
their filtered sets. Screenshots in the session.
