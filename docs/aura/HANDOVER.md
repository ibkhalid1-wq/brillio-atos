# Aura — engineering handover

Written 2026-08-13, at the point the Inbox/Discover redesign was handed over. It
covers what to run, what is real, what is gated, and what is still owed — stated
plainly enough that nothing here needs a conversation to decode.

---

## 1 · Run it

```bash
npm install
npm run validate        # typecheck → lint → build → test. All four must pass.
npm run dev             # the app, on :5173
```

`npm run validate` is the gate. It is green as of `e80bdc7` (2718 tests, 176 files);
if it is red, that is a regression, not a known state.

**You will need your own `.env.local`** — it is deliberately not in the repo. Copy
`.env.local.example` and fill in the Supabase URL and keys. Without it the app runs
but every read fails.

**Supabase edge functions** are Deno and are NOT exercised by `npm test`. Deploying:

```bash
npx supabase functions deploy run-agent --project-ref <ref>
```

`run-agent` is at **v221** in the deployed project. Two changes in it are recent and
worth knowing: attributes now carry per-field `evidence`, and a regeneration clears
the `status: "stale"` flag it answers (see §5).

---

## 2 · The shape of the thing

Three surfaces, and the boundary between them is load-bearing:

| surface | what it is | what it may do |
|---|---|---|
| **Work** | the board — bands, stations, gates | operator progress |
| **Discover** | the people — links, capture, invites | READ + engage stakeholders. **No operator moves.** |
| **Inbox** | everything waiting on an operator decision | ACT. Every block carries a control. |
| **Record** | who said what, when | read-only, including findings nobody acted on |

Two rules that will look like bugs if you do not know them:

- **A question is asked of a PERSON or answered by a DICTIONARY, never both.** Typing
  questions (`dataType` / `valueSet` / `optionality`) route to the data dictionary and
  are deliberately absent from person cards — with two exceptions, both deliberate: a
  confident **lifecycle**'s stages, and any **jointly-owned** question (a seam), which
  goes to BOTH owners because a document cannot settle a disagreement between two
  functions.
- **Only a genuine stakeholder answer ticks the heard count.** Assign, reassign,
  release, operator-capture: none of them do. If you are tempted to make one of them
  count, read the claims register first (§6).

### The ledger, in one paragraph

Everything is claims about loci (`<elementId>#<slot>`). `store.ts`, `types.ts`,
`precedence.ts` and `projections.ts` are the **frozen core** — treat a needed change
there as a finding to raise, not an edit to make. Surfaces read PROJECTIONS of the
store (`useProgramLedger`), never the blob. Operator verbs are appended as actions and
applied as a read overlay; the frozen store is never written from a surface.

---

## 3 · The design system

One token set, both surfaces, declared at the top of
`src/v3/components/flow/theLine.css`:

```
type    --aura-t-meta 10 · --aura-t-body 11 · --aura-t-title 12 · --aura-t-head 13
shape   --aura-r-ctl 6 · --aura-r-box 10 · 999 for pills
control --aura-ctl-h 26   every button and every select
space   --aura-s1..s5 on a 4px base
motion  --aura-motion 160ms, with a reduced-motion override
```

Three font weights (400/600/700), one leading, tracking only on uppercase
micro-labels. `--ib-*` names remain as aliases so existing Inbox rules resolve.

**Guards enforce this** (`inboxPlainEnglish.test.ts`): a rule that reaches for its own
size, radius, half-pixel or extra weight fails the suite. That is intentional — the
surface reached seven button variants and six radii by drift, one component at a time.

---

## 4 · What is NOT wired (do not mistake these for bugs)

- **The stakeholder write path.** Stakeholders cannot answer through the system in the
  browser today. Everything an operator records on their behalf is marked
  operator-entered and never counts as heard. Surfaces say "provisional" where this
  bites.
- **Session scheduling.** A seam can have a session proposed; no date is booked and
  nothing consumes the intent. The questions themselves are NOT waiting on it — they
  go out on both owners' links.
- **Redirect.** The action and the referral row still exist and render, but no surface
  creates one any more: the operator form was the only writer, and reassigning does
  the same thing in one step.
- **`llmReplay`** is delivered and unwired.

---

## 5 · Known limits and open items

1. **Four artifacts on Laila New read stale** — Agentify, Architecture Strategy,
   Experience Design, Agentic Blueprint. The edge fix that clears the flag is
   deployed; each needs **one regeneration**, now reachable from the artifact's own
   header on either surface (Work or Library).
2. **The service-role key needs rotating.** It was exposed in a working session.
3. **`any` in app code: 110 occurrences**, almost all in three pre-v3 files —
   `src/lib/adamDecisionUtils.ts` (56), `src/lib/adamCopilot.ts` (27),
   `src/new/lib/parseDocumentToText.ts` (18). None in the v3 ledger. Worth typing if
   those files are touched; not worth a sweep on their own.
4. **Three files exceed 1,800 lines** — `FlowShell.tsx` (3,497), `AppShellV3.tsx`
   (3,109), `TheLine.tsx` (1,902). They are cohesive, not tangled, but they are the
   first place a new engineer will get lost.
5. **`QuestionList` and `DetailPane` are defined inside `OperatorInbox`.** React
   therefore remounts that subtree on every render, which is why the detail pane's
   keyboard focus lives on the BOARD rather than the row. Hoisting them to module
   scope would fix the cause; it needs ~12 props threaded and was not worth doing
   blind. This is the one piece of structural debt introduced knowingly.
6. **Per-attribute evidence only covers attributes.** Atlas STEP questions still say
   "no source on record", because the evidence work did not reach the atlas side.

---

## 6 · Two guards that will stop you, and should

**The claims register** (`docs/aura/claims-register.md`). Every place the product
asserts something about itself is listed with what is actually true. Add UI copy that
makes a claim and the suite fails until the claim is accounted for. It exists because
this product once said *"generated, traceable to evidence"* while nothing computed
grounding and a lineage walk achieved zero hops. When it flags you, the answer is to
account for the claim or stop making it — not to reword around the detector.

**The badge-equals-page guard** (`inboxBadgeIsThePage.test.ts`). The rail badge must
equal what the Inbox draws. It has caught several real divergences; if it fails, a
count and a page have stopped agreeing and one of them is lying to an operator.

---

## 7 · The habit that found most of the bugs this week

Nearly every defect fixed in this pass looked fine in the code and wrong on the page:
a button disabled until armed, a busy flag nothing cleared, an empty state below a
`return null`, a strip that repeated the same forty words four times, a count that
named the wrong population, a seam swallowed by the dictionary route. Tests were green
throughout.

**Open the page.** Then measure the thing you are about to assert — on the running
board, before writing the fix — and write the number into the commit. Several
"improvements" this week turned out to be wrong on the data, and the measurement is
what caught them.
