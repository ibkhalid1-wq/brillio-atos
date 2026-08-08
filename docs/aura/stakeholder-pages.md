# Aura — Stakeholder pages + Discover as the engagement dashboard

Specs the stakeholder-facing side and turns Discover into the operator's live "who to
engage, and why" view. The stakeholder engagement is **gated** on the write path (model
key + binder); the operator-side dashboard + honest interims are **built now**. Frozen
core untouched — every state maps onto existing claim status, ownership, and the `⋈`
join; findings are called out, not made.

---

## 1 · The staging principle — phase is a property of a claim, not a person

Stakeholders are **not** marched through phases together. Each owned locus has its own
state, so one person simultaneously holds Listen questions (open) and Design validations
(built from their already-closed answers). Aura routes **each locus** to the right ask for
its state — it never flips a whole person or the whole engagement between phases. A
person's page is the honest mix of whatever they own. This is why Discover computes
engagement **per locus** and shows a person's **dominant actionable state** (§4).

## 2 · The linked page — Listen content (gated; operator-capture interim now)

Scoped to what this person can close:

- **Their owned questions in plain language** — "What statuses can an escalation be in?",
  never `attr:escalation.status#valueSet`. (The rendering is built: `phrasing.ts`,
  `questionForLocus`.)
- **Confirm-or-deviate** against the strongest existing claim — "the system shows these
  six stages — keep, change, or tell us what's right." Deviation is the value; reacting to
  a draft is easy, recall is hard. (The projection exists: `buildSessionAgenda` frames each
  open unknown against its strongest sibling claim, with an as-is claim reading "this is
  what you're leaving.")
- **Their own honest burn-down** — real closed/open counts on their turf, never a roster
  "N of N".
- **The four exits on every question** (§ below).
- Enough **surrounding context** to answer well, scoped to their ownership — not the whole
  engagement.

## 3 · The linked page — Design content (gated)

When loci they shaped are closed and a prototype element is generated, the page shifts
from **asking** to **showing**:

- The **design surface scoped to what their answers shaped** — "here's what your input
  became."
- **The deviation register on their turf** — where the built design drifted from the
  intent they asserted. The highest-value thing to show: not "does this look right" but
  "here's where what we built differs from what you told us." (Built: `buildDeviationRegister`,
  already surfaced in the Design Loop's joint zone.)
- **Scoped refinement** — they refine where they own; a refinement is an **asserted claim
  that wins over regeneration** (reconcile guarantees it). Not "needs refresh" — a real
  attributed change.
- **Sign-off** — the validation verdict, theirs alone, the loop's goal state.
- The same four exits (a design question can also need a meeting or a redirect).

## The four exits (every owned question, Listen or Design)

Only the first is an answer. All gated; interim = operator-capture (see operator-inbox.md
and joint-meeting-model.md — the fourth exit, request-meeting, is specced there).

| Exit | Effect | Ticks heard/closed? |
|---|---|---|
| **ANSWER** | closes it, attributed | **yes** |
| **REDIRECT** ("ask X") | proposed reassignment; operator one-tap confirms | no |
| **RELEASE** ("not mine/can't") | → unowned → operator inbox | no |
| **REQUEST-MEETING** ("get me in a room") | → operator schedules (converges on the seam/schedule verb) | no |

## 4 · The auto-transition — Listen → Design, per-locus, claim-strength-gated

- When the claims a design element depends on are **closed by genuine stakeholder answers**
  and the element is generated, it **auto-appears** on the owning stakeholder's page as a
  validation. No manual re-queuing.
- **Per-locus, not per-person** — a stakeholder validates ready elements while other
  questions they own are still open. Never wait for whole-engagement closure.
- **The strength gate:** a prototype can be *generated* from weak or operator-entered
  claims, but an element resting on those **must not** auto-queue as validated design. It
  either waits, or appears explicitly flagged *"built on an assumption we haven't confirmed
  with you — is it right?"* — a Listen question in a Design surface. **Never a polished
  screen resting on a guess shown as validated.** (The distinction is already in the ledger:
  `isHeardClosure` separates genuine stakeholder closures from operator/import; the Design
  Loop already marks generated-vs-asserted.)
- **Joint elements:** an element built on a seam locus queues to **both** owners (or the
  joint-session context), never to one — the `⋈` carried forward. Jointly decided, jointly
  validated.

*Gated:* the auto-transition firing **without the operator** needs the write path. Interim:
the operator surfaces the ready Design element with honest provisional marking.

## 5 · Discover — the engagement dashboard (BUILT)

Discover is no longer a roster; it's the operator's live **"who needs attention, and why"**
view, computed from ownership + claim state. Verified on Laila.

**A summary strip** — `Who to engage · 21 ready · 1 in flight (oldest today) · 0 blocked ·
0 done for now` — then the roster **grouped and sorted by engagement state:**

| State | Meaning (computed from the ledger) | Verified on Laila |
|---|---|---|
| **Ready** | the ledger has open questions on their turf — a link to send now | 20–21 people, each "N open on their turf — send a link" (306, 347, 332…) |
| **In flight** | assigned/engaged, awaiting a response — with inline ageing | "Leader - Alliances · awaiting · today · operator-tracked" after an assign |
| **Blocked** | only a seam left for them (needs a joint session) — or an unowned area to assign | styled distinct (purple), non-alarm |
| **Done for now** | nothing open maps to them | (re-enters *ready* when a Design element built from their answers is ready to validate) |

- **"Done" is a LEDGER read, never the roster's evidence flag.** A person is done only when
  the ledger has nothing open on their turf — so a fully-"heard" roster over a ledger with 0
  answered reads as **ready**, not done. This is exactly the "N of N heard" trap, closed.
- **Dominant actionable state:** per-locus state means one person spans states; Discover
  shows *ready* if they have answerable questions now (even with a blocked seam elsewhere),
  the full mix one click into their row.
- **Unblock ordering:** ready is sorted by how much is open on their turf (a keystone-owner
  proxy — the session-plan logic made live); in-flight is sorted oldest-first (the chase).

**Turf mapping (finding):** a person is matched to their open ledger questions by
**word-overlap between their area/role and the ledger's owner bands** (functions) — a
faithful in-browser proxy. A precise person↔function↔locus map needs an ownership
projection the in-browser read model doesn't carry — **reported, not made** (see also the
area-cascade finding in operator-surface-legibility.md).

## 6 · Inline ageing on in-flight items (BUILT)

- **Growing elapsed time** since the question went out: `today → 9 days → 3 weeks`. Time is
  the signal; without it, "in flight" reads as handled.
- **To-do escalation, not alarm** — the age pill intensifies with age (`warm` ≥ 9 days,
  `hot` ≥ 21 days) but never screams; it's a nudge cue.
- **Per-stakeholder rollup by oldest** — the summary strip shows "oldest {age}" so Discover
  sorts the chase; per-question detail one click in.
- **Honesty — operator-tracked vs system-tracked:** until the link is live, ageing times the
  **operator's chase** (sent out-of-band, tracked by hand) — every in-flight item and the
  summary say **"operator-tracked."** The same clock ages a real system send once the link
  lands. No implied automated tracking that isn't wired.
- Aged items drive the next action (the row's link/redirect/schedule affordances), not just
  display.

## 7 · The honesty boundaries (same discipline throughout)

- Plain-language questions, not locus ids, as the primary label.
- Real counts and burn-down, never a roster "N of N".
- **Only a genuine stakeholder ANSWER ticks heard/closed** — not assign, redirect, release,
  request-meeting, preview pre-mark, or operator-capture. (Verified: heard stayed 0 through
  every operator action.)
- Design surfaces mark what rests on unconfirmed claims; never validated-looking design over
  a guess.
- Ageing and "in flight" are honest about operator- vs system-tracked until the link is live.
- No control past-tense that overclaims; the resulting ledger state is shown.

## 8 · Buildable now vs gated

**Built now (operator side + honest interims):** Discover's ready/in-flight/blocked/done
states from the ledger; inline ageing of operator-tracked engagement; plain-language
questions; operator-capture of answers/redirects/releases/meeting-requests (operator-inbox.md);
Design surfaces shown by the operator with honest provisional marking (the Design Loop's
joint zone + deviation register).

**Gated (write path):** the stakeholder link itself — answering, refining, requesting,
validating directly; the auto-transition firing without the operator; system-tracked
in-flight timing.

## 9 · Anything that suggested a core change — reported, not made

- **Turf mapping** (§5): person↔function↔locus is a word-overlap proxy in-browser; a precise
  map needs an ownership projection. Reported.
- **Auto-transition + joint-to-both** (§4): firing without the operator, and a per-locus
  strength gate that distinguishes "generated" from "stakeholder-answered" for the queue,
  are write-path wiring — the ledger already carries the distinction (`isHeardClosure`, the
  `⋈` join); no core change, gated build.
- Everything built maps onto existing reads (`buildUnknownQueue.byOwner`, the operator-action
  overlay) and existing operator actions. Store, precedence, migrate, projections' data logic
  and audit trigger untouched.

**Verification:** `tsc` clean · eslint clean · live preview against `Laila CRM` — Discover
shows "21 ready / 1 in flight (oldest today)"; an assign moved a person ready → in flight
with "awaiting · today · operator-tracked"; heard stayed 0. Screenshots in-session (Ready
list with on-turf counts; the In flight item with inline ageing). One note: the Laila demo
holds a few `_operatorActions` from verification (additive/reversible; stored ledger
untouched).
