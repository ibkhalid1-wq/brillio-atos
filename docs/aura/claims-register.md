# Aura — Claims Register

**One question, one file: _what may we truthfully say about Aura today?_**

Every place the platform asserts something about itself — UI copy, agent/system
prompts, generated boilerplate, docs, the user guide — is listed here with what
is actually true, the evidence for it, and the honest phrasing that is defensible
right now. This exists because the failure that started this whole build was a
claim nobody chose to make: the product said *"generated, traceable to evidence"*
while nothing computed grounding and a lineage walk on real data achieved **zero
hops**. The claim accreted because nothing tracked the distance between what the
system did and what it said. This register is that tracker. Keep it true (§4) or
delete it — a stale honesty register is worse than none.

**Ground truth** cited below is the read-only verification pass (this session's
answer register + the binder measurement): lineage walk = 0 hops on live data;
nothing computes grounding; the audit trail is the in-blob `flowAttestations`
array (capped 200, opt-in, oldest dropped silently); the `llmReplay` harness is
delivered but unwired; measured hop-1 element→entity resolution is ~75% on real
engagements with a **permanent** sub-100% ceiling.

Status values: **TRUE** · **PARTIALLY TRUE** · **NOT YET TRUE** · **WILL NEVER BE
FULLY TRUE**.

---

## Summary — every claim, at a glance

| # | Claim (as worded) | Status | Remediation |
|---|---|---|---|
| 1 | now: "generated from your evidence" | **TRUE** | ✅ Applied 2026-08-07 |
| 2 | now: "generates artifacts from that evidence" | **TRUE** | ✅ Applied 2026-08-07 |
| 3 | ontology, now: "every entity is generated from these packs or the sponsor's own words" | **TRUE** | ✅ Applied 2026-08-07 |
| 4 | Outcome agent, now: "links benefits from strategy to KPI" | **TRUE** | ✅ Applied 2026-08-07 |
| 5 | Requirements agent, now: "with priority and source links" | **TRUE** | ✅ Applied 2026-08-07 |
| 6 | Company Brief: "each traceable to a page you actually read" | PARTIALLY TRUE | Verify display, then keep |
| 7 | maturity stage named "grounded" | PARTIALLY TRUE | Fix at Step 5 (tie to metric) |
| 8 | "N governed — each defined once, verifiable" (metrics) | **TRUE** | None — keep |
| 9 | "the standards the ontology is grounded in" | **TRUE** | None — keep |
| 10 | "a curation dismissal is auditable" (code comment) | PARTIALLY TRUE | Scope-word; keep |
| 11 | platform is **auditable** (not yet asserted in UI) | NOT YET TRUE | Fix at Step 1 (guard against premature claim) |
| 12 | a computed **grounding** figure | NOT YET TRUE + ceiling | Fix at Step 5; state the ceiling |
| 13 | **reproducible / deterministic** (not asserted anywhere) | WILL NEVER BE FULLY TRUE | Never claim "deterministic"; guard |

**Applied 2026-08-07** — rows **1–5** edited to the phrasing below and re-statused
**TRUE** (see each row for file, before→after). No surface in the repo now asserts
something this register marks NOT YET TRUE. Rows **7** (grounding maturity label →
Step 5) and **11** (platform auditability → Step 1) remain **scheduled**, written
into those steps' definitions of done — not touched here.

---

## The rows, in detail

### 1 · "generated from your evidence" — the founding claim, corrected
- **Where:** `src/v3/components/flow/FlowShell.tsx:2985` (Artifacts strip subtitle).
- **Applied 2026-08-07:** `"generated, traceable to evidence"` → **`"generated from your evidence"`**.
- **True today?** Yes, as reworded. Artifacts *are* generated from the captured evidence; the claim no longer asserts a resolvable path (walk = 0 hops) it cannot back.
- **What would let "traceable" return:** Step 4 (binder + LineageEdge) + Step 5 (computed grounding). At that point copy may say "traceable — X% by reference."
- **Status:** **TRUE** (as reworded). Was NOT YET TRUE.

### 2 · "generates artifacts from that evidence"
- **Where:** `src/v3/components/flow/FlowShell.tsx:352` (Help → "One live programme, six movements").
- **Applied 2026-08-07:** `"generates artifacts traceable back to that evidence"` → **`"generates artifacts from that evidence"`**.
- **Status:** **TRUE** (as reworded). Was NOT YET TRUE. → "traceable" returns at Step 4/5.

### 3 · "every entity is generated from these packs or the sponsor's own words"
- **Where:** `src/v3/components/flow/FlowGrounding.tsx:138` (Grounding surface subtitle).
- **Applied 2026-08-07:** `"every entity must trace to these packs…"` → **`"every entity is generated from these packs or the sponsor's own words"`**.
- **True today?** Yes — this now describes the generation input (what the ontology agent is fed) rather than asserting a verified output property. "must trace" (a guarantee nothing checks) is gone.
- **Status:** **TRUE** (as reworded). Was PARTIALLY TRUE. → re-strengthen to a measured claim at Step 5.

### 4 · Outcome Framework Agent: "links benefits from strategy to KPI"
- **Where:** `supabase/functions/run-agent/index.ts:988` (system prompt — **model-facing**).
- **Applied 2026-08-07:** `"…measurable hierarchy that makes benefits traceable from strategy to KPI"` → **`"…measurable hierarchy that links benefits from strategy to KPI"`**.
- **Register-variant, recorded:** the register's defensible phrasing was *"links benefits from strategy to KPI in a measured-by hierarchy"*; the sentence already contained "measurable hierarchy", so "in a measured-by hierarchy" was redundant and dropped. Accurate: the schema links the KPIs that evidence each outcome — real within-artifact linkage.
- **Status:** **TRUE** (as reworded). Was PARTIALLY TRUE. High leverage — a model no longer tells every user the output is "traceable."

### 5 · Requirements Catalog Agent: "with priority and source links"
- **Where:** `supabase/functions/run-agent/index.ts:1094` (system prompt — **model-facing**).
- **Applied 2026-08-07:** `"…with priority and traceability"` → **`"…with priority and source links"`**.
- **Accuracy check:** the requirements JSON schema carries `"source": "where it came from"` and `"linkedOutcome"` per requirement, so "source links" is *true*, not merely smaller.
- **Status:** **TRUE** (as reworded). Was PARTIALLY TRUE.

### 6 · Company Brief: "each traceable to a page you actually read"
- **Where:** `supabase/functions/company-brief/index.ts:102` (system prompt — model-facing).
- **True today?** Mostly — the brief is web-fetched and instructed to bind each fact to a page read. **Needs check:** confirm the page citation still reaches a user-visible surface (source display may have been removed from the brief UI). If the citation is not shown, the *instruction* is honest but the *user* can't verify it.
- **Status:** PARTIALLY TRUE (pending display check).
- **Honest phrasing now:** keep the model instruction (good discipline); if sources aren't shown, either restore them or don't imply the user can trace them.
- **Remediation:** Verify display; keep or restore. Not a "change today" copy error.

### 7 · Maturity stage named "grounded"
- **Where:** `src/v3/components/flow/TheLine.tsx:88` (`MATURITY_WORDS = [..., "grounded", ...]`), rendered in the board legend and harvey-ball tooltips.
- **True today?** Partially. "grounded" is a maturity *stage* derived from coverage/approval heuristics, **not** a grounding-by-reference computation. The word implies evidence-backing that isn't computed.
- **Status:** PARTIALLY TRUE.
- **Honest phrasing now:** keep the stage name, but the legend must define it as *"has evidence on record for its scope"* (a coverage stage), not a computed guarantee.
- **Remediation:** **Fix at Step 5** — once grounding is computed, tie the "grounded" stage to the metric. Add that copy change to Step 5's definition of done.

### 8 · "N governed — each defined once, verifiable" (metrics) — a TRUE claim
- **Where:** `src/v3/components/flow/FlowShell.tsx:3138,3144` (Outcomes panel: "one governed definition per measure"; "✓ N governed — each defined once, verifiable"; title: "Every surface reads these from one registry, so a definition can't drift").
- **True today?** Yes, scoped to metrics. The governed metric registry (F-002) holds one definition per measure, read by the charter, board pack, and brief from a single registry; `metricHealth.governed` verifies each is defined once. "Verifiable" = each definition is checkable and non-drifting.
- **What makes it true:** F-002 governed metric registry (built).
- **Status:** **TRUE** (scoped to metrics — do not generalize "governed" to the whole platform).
- **Honest phrasing:** already honest and scoped. **Keep.** This is the shape every other claim should reach: specific, backed, checkable.

### 9 · "the standards the ontology is grounded in"
- **Where:** `src/v3/components/flow/FlowShell.tsx:176`; `FlowGrounding.tsx:137-138` ("the facts the Domain Ontology is generated against").
- **True today?** Yes — descriptive of the generation input: steering standards (e.g. FHIR/FIBO) + client vocabulary packs. "grounded in the standards" = aligned to, and generated against, those packs.
- **Status:** **TRUE.** Keep.

### 10 · "a curation dismissal is auditable, and recoverable"
- **Where:** `src/v3/components/flow/studio/StudioKit.tsx:53` (code comment).
- **True today?** Narrowly yes — a dismissal records a mandatory reason (attested) and is recoverable. But this is a code comment, and the **word** "auditable" must not be read as a platform-level guarantee (see #11).
- **Status:** PARTIALLY TRUE (feature-scoped).
- **Remediation:** keep, scoped. Do not promote to a platform claim until #11.

### 11 · The platform is "auditable" (not yet asserted in UI — guard row)
- **Where:** not currently claimed in user copy (good). Tracked so nobody adds it prematurely. Referenced in `docs/aura/step1-audit-choke-point.md:106`.
- **True today?** No. The audit trail is the in-blob `flowAttestations` array — capped at 200, opt-in per handler, oldest dropped silently, entries carry no affected-record id (verification pass, Q11/Q12/Q38/Q39).
- **What would make it true:** Step 1 (`audit_events`: authoritative, append-only, complete, affected-record id) applied and flipped to enforce.
- **Status:** NOT YET TRUE.
- **Remediation:** **Fix at Step 1.** Do not add an "auditable" claim to any surface before Step 1 is applied and enforcing. (Step 1 is authored, NOT applied.)

### 12 · A computed grounding figure — the permanent-ceiling row
- **Where:** none quoted today. **No traceability count or percentage is displayed anywhere** — the nearest numbers (gate fractions like "7/10", "N of M voices heard", the "grounded" maturity stage) count attestation/approval, not grounding by reference. This row exists so the first grounding number shipped is framed correctly.
- **True today?** No — nothing computes grounding (Step 5 delivers it).
- **The ceiling — state it in the register AND in the copy when it ships:** grounding **plateaus below 100% by design.** Entity births (agents legitimately create new entities) and out-of-scope concepts never ground; measured hop-1 resolution is ~70–80% on real engagements. A grounding figure of ~75% is the honest, healthy number — **not** a failure. Whoever reads it first will read <100% as broken unless the copy says otherwise.
- **Status:** NOT YET TRUE (no metric) **and** WILL NEVER BE FULLY TRUE at 100%.
- **Honest phrasing when it ships:** *"X% of elements resolve to evidence by reference"* with a one-line note that some elements (new/agent-born/out-of-scope) are expected never to.
- **Remediation:** **Fix at Step 5.** Add the ceiling wording to Step 5's definition of done.

### 13 · Reproducible / deterministic (not asserted — guard row)
- **Where:** not claimed anywhere user- or model-facing (good). Guarded so it stays that way.
- **True today?** No mechanism (the `llmReplay` harness is delivered but unwired).
- **The ceiling:** even wired, generation is **record fidelity, not determinism** — temperature 0.2, no seed. Re-running does not reproduce byte-identical output.
- **Status:** WILL NEVER BE FULLY TRUE as "deterministic."
- **Honest phrasing if ever claimed:** *"reproducible record"* (we retain exactly what was sent and received), never *"deterministic replay."*
- **Remediation:** never introduce a determinism claim. If audit-tier determinism is needed, it requires seed + temp 0 first.

---

## External claims we cannot verify from the repo — human check needed
- **The Laila / Aura demo films** (Remotion; narration/VO scripts in the film content modules). Video narration is a place a "traceable / grounded / end-to-end" claim can be asserted to an audience and never tracked here. **A human should review the VO script** against this register before any film is shown externally.
- **Any deck, proposal, or exported board-pack** made outside the tree. If "traceable / grounded / governed / auditable" appears in one, it inherits the statuses above — flag where it has been said.

---

## §4 — Keeping the register true (or it rots into theatre)

Three mechanisms, most-mechanical first:

1. **A CI lint that fails when a claim is added _or reworded_ in a surface this register doesn't account for.** `src/v3/__tests__/claimsRegister.test.ts` scans the claim-surface files (UI components, edge prompts, agent meta, the user guide), **normalizes each claim-bearing line** (strip whitespace + case-fold, so reindent/reflow is silent), **hashes it**, and checks every hash against the hash set in `docs/aura/claims-allowlist.json`. It **fails** when a claim line's content changes (a reworded claim → new hash → not allowlisted) or a new surface file introduces the vocabulary. This closes the count-based hole: rewording *"grounded in the evidence"* → *"fully traceable to source"* trips it even though the line count is unchanged. Normalization + surface-set + vocabulary live in **one** module — `src/v3/lib/claimsGuard.ts` — imported by both the test and the regen script, so the two can never disagree. **When the guard trips:** re-status the affected row above, then run **`npm run claims:regen`** (the message says which file and line changed). Regen refuses to write unless this register has changed since the allowlist was last generated (it pins a `registerHash`), so regeneration cannot silently re-bless a reworded claim; `npm run claims:regen -- --force` (optionally `--reason "..."`) overrides with a warning for a genuine mechanics-only regen — and records a `forced` block (timestamp + reason) **in the allowlist itself**, so an overridden regen shows up in the diff a reviewer reads, not only in the terminal. The next unforced regen clears it.
2. **Definition-of-done line, already in every step:** *"the claims register is updated to state what the platform may now truthfully assert about itself."* That line is the gate — a step is not done until the rows it changes are re-statused here and any "Fix at Step N" copy change is made.
3. **Discoverability:** this file lives at `docs/aura/claims-register.md`. Anyone writing user copy or an agent prompt should find it before shipping the claim, not after. Recommended (not done in this unit): a one-line pointer comment at the top of `FlowShell.tsx` and the edge prompt files — *"self-claims about Aura are governed by docs/aura/claims-register.md."*

---

*Last swept: 2026-08-07 (this unit). Re-sweep whenever a step lands or copy changes.*
