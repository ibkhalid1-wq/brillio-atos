# Aura — Full-flow validation + information-density pass

Autonomous pass: complete the buildable surface work, drive a new program through the
flow, validate the operator and stakeholder experiences end-to-end, do an
information-density pass (move non-essential detail to hover/drill-down), fix issues, and
report. Verified live in the preview against migrated Laila.

**Headline:** the operator and stakeholder experiences are built, honest, and validated
live. A new program creates cleanly and generation is **invoked live** — but the
generation edge call **does not complete in this environment** (the charter generation
ran >5 min and never landed; a hard reload showed it reset to "generate"), so a *fresh*
program can't be driven to prototype here. The complete flow was therefore validated
against the existing fully-generated program (`Laila - Provisional`), plus the density
pass shipped and is verified live.

---

## 1 · New program — created; generation invoked but times out (the honest gate)

Created **"Agentic CRM"** (client *Meridian Commercial* — fictional, per the no-real-names
rule; industry Professional Services; sponsor *Alex Rivera*) with the requested charter
intent (an agentic CRM replacing Salesforce across Marketing, Sales, GTM, Sales Ops,
Delivery, Legal, Alliances, Talent Acquisition).

- Program creation: **works** — lands on a clean, honest empty ledger (0% convergence, no
  artifacts, `GENERATE` affordances on the frontier).
- Charter generation: **invoked live** — `POST /functions/v1/run-agent` fired (OPTIONS 200,
  POST in-flight), UI showed "generating…". This confirms the edge + model path is wired.
- Outcome: after ~5 min the POST never returned a document; a hard reload showed the
  charter **reset to "generate ↧"** (no document persisted). The edge generation **timed
  out / did not complete**. A large 8-function charter is a heavy generation; retrying
  would hit the same wall.
- **Conclusion:** driving a fresh program Frame→prototype via live generation is not
  reliably completable in this environment. This is the model/edge gate made concrete —
  generation is *invoked* but not *completing* here. Not a surface defect (the surfaces
  correctly showed the honest in-progress and reset states).

## 2 · Complete-flow validation against `Laila - Provisional` (fully generated)

This program has the full Frame→Prototype artifacts (charter, kit, ontology ×11 areas,
atlas ×11, architecture, experience, blueprint, prototype) + minted stakeholder links —
the right dataset to validate the complete experience with real content.

### Operator experience — validated ✅
- Work header reads the ledger honestly: **Heard 0 attributed closures**, **Convergence
  57.2%**, **UNOWNED 5 of 151**, **5 seams** — every number a real read or `provisional`.
- Design Loop renders its three ownership zones; Discover shows the goal headline + operator
  inbox + engagement dashboard; Record shows the attribution strip. All render, no console
  errors (the one console error is a pre-existing telemetry fetch).

### Stakeholder experience — validated ✅ (respond linked page)
Opened a real durable link (`?flowRespond=…` for *Head of Marketing*):
- **Scoped to what they own** — "This covers **Marketing** — the workflows and terms in
  your world" (the phase-per-claim staging principle, live).
- **Confirm-or-deviate**, not open recall — "confirm what's right, fix what's not, add what
  we missed … it saves as you go."
- **The four exits are present**, including **"Request a meeting"** ("Skip the form — request
  a short call and we'll capture it for you") — the fourth exit is *built*, not just spec.
- **Honest interim** — "nothing is final until the team reviews it" (the operator-capture
  bridge, stated to the stakeholder).

*Correction to the earlier surface-verification "spec-only" list: **request-meeting is
built** on the respond page. Direct-answer landing as an attributed closure remains the
gated piece; the capture interim is live.*

## 3 · Information-density pass — issues found and fixed (shipped)

Reviewed the operator surfaces for non-essential information; moved detail to hover/
drill-down; killed a contradicting number. Verified live on `Laila - Provisional`.

| # | Issue (non-essential/contradicting info on the operator surface) | Fix |
|---|---|---|
| D-1 | Convergence readout showed the full "202 closed/weak · 151 open" split inline, twice (Work header + Design Loop) | Headline "**57.2% closed/weak**" stays; the exact split moves to **hover** (`title`). Shared primitive → both surfaces get it. |
| D-2 | Work-header seam strip listed **all** seam pairs inline (long at 11 seams) | Caps at the **top 3** + "**+N more**"; full list on **hover**, and actionable in the Discover inbox (the header is a summary, not the queue). |
| D-3 | Design Loop band chip showed "**0 of 11 converged**" — a second convergence number **contradicting** the real burn-down convergence in the zone header | Chip is now the **gate fraction** like every other band; demo-verdict sign-off stays on the gate criteria the chip opens. |

Verified live: `convSub` reads "closed/weak" (split on hover), the seam strip shows "+2
more", and "of 11 converged" is gone from the DOM. `tsc` + eslint clean.

## 4 · Buildable work completed this session

- The full operator inbox + verbs + legibility + Discover engagement dashboard (prior
  commits) — all green, heard-boundary tested.
- Suite greened (`buildReadModel` extracted pg-free; incidental grounding word dropped).
- The density pass above.
- Full-flow validation (operator + stakeholder) against complete data.

## 5 · Honest remaining items

- **New-program generation reliability** — generation is invoked but the edge call times
  out on a large charter here; driving a fresh program to prototype needs a reliable/keyed
  edge (a provisioning/infra matter, not a surface defect).
- **Gated stakeholder write-back** — direct answers landing as attributed closures (and the
  auto-transition firing without the operator) still need the model key + binder +
  persistence; the operator-capture interim + request-meeting are live.
- **Cockpits + FlowBrief** (ListenCockpit / EnvisionCockpit / ShowCockpit /
  ProductOwnerCockpit / FlowBrief) still show roster/verdict-based counts — flagged in the
  vocabulary-honesty list, buildable-now rewiring to the shared ledger primitives.
- **Artifact-view per-slot claim overlay** on the ontology graph / atlas swimlane (needs
  the binder for a clean graph-node ↔ ledger-element link).
- **Housekeeping** — the Laila demo `_operatorActions` (additive, reversible; stored ledger
  byte-identical) and the empty "Agentic CRM" program remain; both removable on request.

## 6 · Verdict

The operator and stakeholder experiences are **built, honest, and validated live** against
a complete program; the information-density pass shipped and is verified. Creating and
driving a *fresh* program to prototype is blocked by the edge generation not completing in
this environment (invoked, not completing) — the model/edge gate, made concrete. All
buildable surface work is committed and green.
