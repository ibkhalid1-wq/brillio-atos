# Aura — Ledger precedence (the one undefined piece)

Two claims on the same locus (`about: <elementId>.<slot>`) can conflict. This is the full lattice of
**source class × world** and the outcome for every pairing. Encoded in
`src/v3/lib/ledger/precedence.ts` as a pure `resolvePrecedence(a, b)`; **the table below is generated
from that function** and pinned by a test — the doc and the code are one definition.

## The three outcomes

- **wins** — one claim prevails; the loser is **retained as history** (never deleted — a superseded
  claim is evidence of what was believed and by whom). Where a *bound* claim loses, it is retained
  **blocked** instead, not silently dropped.
- **coexist** — both stay live as a **visible contradiction**. Routable (it becomes an item), never an
  error. This is the honest outcome when nothing local can decide.
- **escalate** — routed to a **named authority**: `slot-owner` (the claim's owner-while-open; for a
  joint `A ⋈ B` slot, both; for an unowned slot, the engagement's domain authority) or
  `legal-compliance` (anything regulation touches).

## The model, in three rules

1. **Cross-world is a deviation, not a conflict.** Two claims about *different worlds* of the same slot
   (one `as-is`, one `to-be`) **coexist** — that pair is exactly what the deviation register exists to
   hold. `as-is` never auto-promotes to `to-be` by "winning." (Exception: regulation, rule 2.)
2. **Regulation binds — across worlds.** Regulation vs an attributed `asserted` claim **escalates to
   Legal/Compliance**, and the assertion is held **blocked** (see the hard case below — "binds" is not
   "silently overwrite"). Regulation vs anything else **wins**, loser kept as history. This holds
   regardless of the two claims' worlds.
3. **Same world → source strength decides.** Each world has its own strength order (below). Stronger
   **wins**. Equal strength: two **human-decision** sources (`asserted`, `dispositioned`, `regulation`)
   **escalate** to a human; two **evidence/machine** sources **coexist** as a visible contradiction.

## Source strength is world-dependent (the key subtlety)

The same source is not equally authoritative in both worlds. Strongest → weakest:

- **as-is** (describing the current system): `regulation` › `asserted` › **`code-derived`** › `document`
  › `external-standard` › `precedent` › `dispositioned` › `generated`.
  *Why code-derived is high here:* a system export is near-ground-truth **for what currently exists** —
  only a human saying "the export is wrong" (asserted) or regulation outranks it.
- **to-be** (describing the target): `regulation` › `asserted` › **`document`** › `external-standard` ›
  `precedent` › `dispositioned` › **`code-derived`** › `generated`.
  *Why code-derived is low here:* the current system does not define the target; a client's own target
  document does. The export is the past.

*Why `dispositioned` sits below the evidence sources:* a disposition closes an unknown with an
**accepted assumption** made **without** full evidence — deliberately the weakest human closure. An
owner who actually knows the answer **asserts** (which outranks everything but regulation); a
disposition is the placeholder until they do. So real evidence (document, export-for-as-is, standard,
precedent) outranks a provisional assumption.

## The six hard cases, resolved

| # | Conflict | Outcome | Reasoning |
|---|---|---|---|
| 1 | sf-export (`code-derived`, as-is) vs `asserted` correction ("the export is wrong, we never use that stage") | **asserted wins**; export kept as history | *Asserted outranks generated/derived* — a human correcting the as-is beats the machine reading of it. The export isn't deleted: it's why the correction was needed. |
| 2 | two `asserted` claims from different sessions, same world | **escalate → slot-owner** | Same source class; strength can't decide two humans. Coexisting would leave a live contradiction with no path; the slot's owner picks (joint owner → both; unowned → domain authority). |
| 3 | `document` (to-be) vs `external-standard` | **document wins** | For *this* engagement's target, the client's own document is specific intent; the external standard is a **strong default awaiting confirmation**, not a settled fact. Retained as the standard-alignment reference. |
| 4 | `regulation` vs anything | **binds** (see below) | Regulation vs `asserted` → **escalate → Legal**, assertion held **blocked**: a firm human assertion that regulation forbids is a genuine conflict a named authority must reconcile — you cannot locally auto-overwrite it. Regulation vs everything else → **regulation wins** cleanly. Binds **across worlds**. |
| 5 | `precedent` vs a fresh `generated` claim, same engagement | **precedent wins** | A precedent is a prior **ratified** decision; a generation is unconfirmed model output. The ratified decision outranks the guess. |
| 6 | `dispositioned` vs a **later** `asserted` claim on the same slot | **assertion wins**; disposition kept as history | A disposition is explicitly provisional ("assume X until told otherwise"); a real assertion is the "otherwise." It supersedes cleanly — this is *not* a regeneration overwriting an attributed closure (both are attributed; the stronger closure method wins). |

**The cell that was hardest to decide** was #4 — *what "binds" does to an existing asserted claim*.
The naive reading ("regulation wins, overwrite the assertion") violates *asserted outranks generated
and no regeneration overwrites an attributed closure* — regulation is not the human who made the
assertion, and silently discarding an attributed claim is the exact failure this structure exists to
kill. So regulation **binds** (the asserted claim cannot be *closed* in violation) but does **not
overwrite**: the assertion is held **blocked** and the conflict **escalates to Legal**. Second-hardest
was the world-dependence of `code-derived` (#1 vs the to-be case): the same source is authoritative for
as-is and near-worthless for to-be, which is why strength is a per-world vector, not one global order.

## The generated lattice

<!-- AUTOGEN:precedence (generated by src/v3/lib/ledger/precedence.ts — do not hand-edit) -->
Legend: **A▸** = row (a) wins · **◂B** = col (b) wins · **~** = coexist (visible contradiction) · **!o** = escalate to slot-owner · **!L** = escalate to Legal/Compliance.

**Same world = as-is** (both claims describe the current system):

| as-is · a↓ b→ | regula | assert | dispos | docume | extern | code-d | preced | genera |
|---|---|---|---|---|---|---|---|---|
| **regulati** | !L | !L | A▸ | A▸ | A▸ | A▸ | A▸ | A▸ |
| **asserted** | !L | !o | A▸ | A▸ | A▸ | A▸ | A▸ | A▸ |
| **disposit** | ◂B | ◂B | !o | ◂B | ◂B | ◂B | ◂B | A▸ |
| **document** | ◂B | ◂B | A▸ | ~ | A▸ | ◂B | A▸ | A▸ |
| **external** | ◂B | ◂B | A▸ | ◂B | ~ | ◂B | A▸ | A▸ |
| **code-der** | ◂B | ◂B | A▸ | A▸ | A▸ | ~ | A▸ | A▸ |
| **preceden** | ◂B | ◂B | A▸ | ◂B | ◂B | ◂B | ~ | A▸ |
| **generate** | ◂B | ◂B | ◂B | ◂B | ◂B | ◂B | ◂B | ~ |

**Same world = to-be** (both claims describe the target):

| to-be · a↓ b→ | regula | assert | dispos | docume | extern | code-d | preced | genera |
|---|---|---|---|---|---|---|---|---|
| **regulati** | !L | !L | A▸ | A▸ | A▸ | A▸ | A▸ | A▸ |
| **asserted** | !L | !o | A▸ | A▸ | A▸ | A▸ | A▸ | A▸ |
| **disposit** | ◂B | ◂B | !o | ◂B | ◂B | A▸ | ◂B | A▸ |
| **document** | ◂B | ◂B | A▸ | ~ | A▸ | A▸ | A▸ | A▸ |
| **external** | ◂B | ◂B | A▸ | ◂B | ~ | A▸ | A▸ | A▸ |
| **code-der** | ◂B | ◂B | ◂B | ◂B | ◂B | ~ | ◂B | A▸ |
| **preceden** | ◂B | ◂B | A▸ | ◂B | ◂B | A▸ | ~ | A▸ |
| **generate** | ◂B | ◂B | ◂B | ◂B | ◂B | ◂B | ◂B | ~ |

**Cross-world** (a and b describe different worlds of the same slot): **~ coexist** in every case —
the pair is a *deviation* (the deviation register's job), not a conflict — **except** when either
side is `regulation`, which **binds across worlds**: regulation vs `asserted` → **!L escalate**
(assertion held blocked); regulation vs anything else → regulation **wins** (loser kept as history).
<!-- /AUTOGEN:precedence -->
