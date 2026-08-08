# Aura — Joint meetings, the meeting-request exit, and seam preview (spec)

Completes the stakeholder-link + operator-inbox model for the things the scheduling
verb must handle: a stakeholder requesting a meeting, how a joint session resolves, and
what each seam owner can do async **before** a session without closing it. The
stakeholder-facing side is **gated** on the write path (model key + binder); the
operator-capture interim is buildable now.

**No core change.** A joint closure, per-question outcomes, seam re-classification and
pre-marks all map onto states the ledger already has — `closed`, `conflict`, `open`,
`n/a` — and the ownership it already carries (the `⋈` join). Findings, not changes, are
called out at the end.

---

## 1 · The stakeholder link — four exits (request-meeting is the fourth)

Each stakeholder gets a page scoped to what they own. The autonomous primary path (their
answer landing as an attributed closure with no human in the loop) is gated; the
operator-capture bridge is the interim. An owned question has four exits — only the first
is an answer:

| Exit | What it is | Ledger effect | Ticks heard? |
|---|---|---|---|
| **ANSWER** | the goal | `closed`, attributed | **yes** |
| **REDIRECT** ("ask X") | proposed reassignment; operator one-tap confirms | ownership only | no |
| **RELEASE** ("not mine") | back to unowned → operator inbox | ownership only | no |
| **REQUEST-MEETING** ("get me in a room") | higher-bandwidth ask; becomes an inbox item | ownership/queue only | no |

**Request honesty:** the button **requests**, it does not book. The stakeholder sees
*"requested — the team will set a time,"* never *"meeting scheduled."* A request exists; a
calendar event does not — the same discipline as "mark for joint session."

## 2 · Meeting-request and seam-scheduling converge on one verb

A requested meeting lands in the operator inbox and is scheduled with the **same verb as a
seam** — the inbox's mark-for-session action. Only the trigger differs:

- a **SEAM** is Aura detecting two functions must meet (a jointly-owned locus);
- a **MEETING REQUEST** is a stakeholder saying so directly.

Requests on related loci **group into one session**, the way seams sharing a function pair
group (already built: `groupSeams` / the inbox's seam grouping). So one schedule verb
handles both; the operator-capture interim (`ScheduleAction`) is identical.

## 3 · What a joint meeting produces — the core addition

A joint session settles a seam's grouped questions. Two owners answer together, so two
things differ from a solo answer.

### 3a · A closure can have joint attribution

When Finance and Legal agree, the closure is **"Finance and Legal agreed X"** — ONE
closure carrying BOTH attributions (the `⋈` ownership carried onto the closure), not one
owner's closure with the other silently co-signed. The ledger already models joint
ownership (`Owner = {kind:"joint", a, b}`); a joint closure carries the same pair as its
attribution. *Finding: the current `Closure` shape carries a single `by`; representing two
attributions is either a `by` list or two linked closures — a **write-model** decision for
when the gate opens, reported not made.*

### 3b · Each question resolves independently into one of three outcomes

A joint session is **not** "book it and mark done." Each grouped question resolves on its
own, mapping onto states that already exist:

| Outcome | Meaning | Ledger state | Routes to |
|---|---|---|---|
| **AGREEMENT** | both agree | one joint-attributed `closed` | — (done) |
| **DISAGREEMENT** | each function's own claim | two live claims → `conflict` | operator to adjudicate (freeze-and-adjudicate) |
| **DEFERRED** | couldn't settle | stays `open` | possibly re-owned / escalated |

A disagreement is **not a failed meeting** — it's a discovered conflict, which is valuable
and exactly what the seam flagged. The session surface records which of the three happened
**per question**, never a single session-level "done."

## 4 · Heard / closed-count rules per outcome

- **AGREEMENT** closure counts as **heard for BOTH functions** on that locus — both were
  genuinely heard, together. Not double-counting: one closure, two attributions.
- **DISAGREEMENT** produced claims, not a closure — the functions participated but the
  question isn't answered, so the closed-count does **not** move. (Tracking "participated"
  separately from "closed" is a surface choice; closed-count moves only on agreement.)
- **DEFERRED** ticks nothing.

Hold the boundary: only an agreement closure moves *answered*. This is the same seam where
"21 of 21 heard" lived — **a session that happened is not a set of questions answered.**

## 5 · Seam preview — async touch that PREPARES but never CLOSES

A seam's answer lives *between* two functions, so it cannot be closed by two independent
async answers — asking each owner independently would give two partial views plus false
coverage, hiding the gap between their assumptions (the exact thing the seam flags). So
**seams route to a joint session, never to two independent closes.** But independent async
engagement can *prepare* a seam — and catch a mis-flagged one.

Each co-owner can, on their link, do three things ahead of the session — **none closes the
seam**:

### 5a · Pre-mark their side (a position, not a closure)

The function records its starting position — "here's how Legal sees this handoff." A
**provisional, single-function claim marked explicitly as a pre-session position**, not a
closure. It loads the session so it starts with both priors on the table. Ledger: a
`weak`/provisional claim tagged as a pre-mark (a preview), which does **not** move
heard/closed — a position is not an answer. Closure still happens jointly, in the room,
where the two positions collide and reconcile.

### 5b · Re-classify the seam — "this isn't actually joint"

Aura detected the seam heuristically and can be wrong. Previewing, a function can say:

| Says | Effect on the locus |
|---|---|
| "this is ours, cleanly" | **re-own** to that single function — leaves the joint queue, becomes a normal owned question |
| "this isn't ours at all" | **release** → back to unowned → operator inbox |
| "yes, genuinely joint" | **confirm** the seam — the session stands |

This validates the seam **before** a session is booked, so the operator doesn't schedule
meetings that aren't needed. A mis-flagged seam caught at preview is a saved session.
Re-classification changes ownership/routing only — it **closes nothing, ticks nothing.**

### 5c · Request the meeting (or defer it)

Confirm the seam needs a session (→ operator schedules it, converging on the one schedule
verb, §2), or flag it isn't ready yet.

## 6 · The honest boundary — preview is not progress

- A **pre-mark** is a provisional position, visibly distinct from a closure; ticks nothing.
- **Confirming "yes this is joint"** validates routing, does not answer; ticks nothing.
- **Only the joint session's AGREEMENT closure** closes a seam question and ticks the
  count, for both functions.
- Same discipline throughout: a session prepared is not a session held; a position stated
  is not a question answered. Preface must never look like closure.

## 7 · The complete sequence

- **Solo-answerable unknowns** → stakeholder link, async, autonomous (most questions).
- **Seams** → routed to a joint session. Optionally each owner **previews** async
  (pre-mark / re-classify / confirm), sharpening the session or revealing it isn't needed.
  **Closure is joint only.**
- Aura **never** attempts to close a seam by two independent answers.

## 8 · The operator-capture interim (buildable now)

Until the write path lands, the operator runs the session / relays the preview and records
outcomes by hand — each marked operator-entered (distinct from a direct stakeholder
assertion), attributed to who said it:

- **Session · agreement** → record the joint closure attributed to both.
- **Session · disagreement** → record the two claims and the conflict (routes to
  adjudicate — already read-side in the inbox).
- **Session · deferred** → stays open.
- **Preview · pre-mark** → record the function's position as a provisional single-function
  position (not a closure).
- **Preview · re-classify** → apply re-own (assign to one function) or release (→ unowned)
  — both already buildable via the inbox's assign / unassign(release) actions.
- **Preview · request/defer** → mark-for-session or hold.

Stakeholder-facing controls show their honest interim — *"requested — the team will set a
time," "your position — noted for the session," "flagged as not joint — team will
re-route," "captured via the team for now"* — never a working-looking button that isn't
wired. Nothing operator-captured ticks heard.

## 9 · Anything that suggested a core change — reported, not made

- **Joint attribution on a closure** (§3a): `Closure.by` is currently single-valued.
  Carrying two attributions (a `by` list, or two linked closures) is a **write-model
  decision** for when the write path lands. Reported.
- **A pre-mark tag** (§5a): a provisional single-function position that must be visibly
  *not* a closure and must not count — representable as a `weak` claim with a preview
  marker, but the marker is a small schema addition to make at write-path time. Reported.
- Everything else maps onto existing states (`closed`/`conflict`/`open`/`n/a`) and existing
  ownership (`⋈`), and onto operator actions the inbox already performs (assign, unassign/
  release, mark-for-session, adjudicate read-side). Store, precedence, migrate, projections'
  data logic and audit trigger untouched.
