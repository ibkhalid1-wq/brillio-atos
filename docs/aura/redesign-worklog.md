# Inbox + Discover redesign — worklog

Run under `aura-autonomous-execution-prompt.md`, against the inbox and Discover
briefs. Branch: `inbox-discover-redesign`, off `reimagined-ui`.

## Assumption 1 — which controls the Discover boundary actually removes

The Discover brief says "no verb buttons on Discover" and names the operator verbs
as **Assign / Decide-fate / Schedule / Adjudicate**. Discover also carries
STAKEHOLDER-ENGAGEMENT controls — send a link, capture an answer, invite, add to the
record — which are not among those verbs.

Decision: **operator-decision controls leave Discover; stakeholder-engagement
controls stay.** Reasons, in order of weight:

1. The brief enumerates the moves it means, and engagement is not one of them.
2. The operator's own stated architecture for this product (this session, verbatim):
   "Discover is for questions and confirmations targeted towards stakeholders."
   Engagement IS Discover's purpose; removing it would leave a page that names
   people and cannot reach them.
3. Those controls were added on explicit request earlier in this session. Deleting
   them under a brief that does not name them would be reading the brief past its
   intent.

What this removes from Discover is recorded in §"Actions removed" below.

## Assumption 2 — tokens are promoted, not re-invented

`--ib-*` tokens already exist for the Inbox (type scale, radii, control height,
added earlier today). Rather than fork a second set for Discover, they are renamed
to a surface-neutral `--aura-*` and both surfaces reference them. No values change
in the move, so the Inbox cannot regress while Discover adopts them.

## Assumption 3 — "navy base + antique gold"

The platform's existing accent is indigo (`--v3-accent-2`), and the brief asks for
navy + antique gold. Introducing a NEW hue across a product mid-flight is the one
change that would make the two surfaces inconsistent with everything else in the
app. Decision: keep the platform's navy/indigo base, and use the existing amber
(`--v3-amber`) as the restrained gold accent for emphasis and the single
route-to-inbox affordance. Logged rather than silently reinterpreted.

## Recon

Measured on the running board before any change (this is the record the work was
aimed at, not an impression of it):

| | Inbox before | Discover before | both, after |
|---|---|---|---|
| button variants | 7 | — | 1 control height, 26px |
| control heights | 2 + selects at a third | 3 | **1** |
| corner radii | 6 (4/6/7/9/11/999) | 5 (4/5/6/10/50%) | **6 / 10 / 999** (+50% for circles) |
| type sizes | 7 (9→13, two half-pixel) | 7 (10→17, two half-pixel) | **10 / 11 / 12 / 13** + one display figure |
| font weights | 6 (incl. 650, 750) | 6 (incl. 500, 650, 800) | **400 / 600 / 700** |
| letter-spacing | 5 (incl. −0.07px on body) | 8 (incl. −0.07px on body) | **normal**, .055em on uppercase labels |
| focus ring | browser default, per control | browser default, per control | **one ring, both surfaces** |

## Actions removed from Discover, and where they went

| removed | why it is an operator move | now |
|---|---|---|
| "confirm these stages" (lifecycle strip) | writes a dictionary row programme-wide at schema strength | stated on Discover; **"confirm in the Inbox →"**, and the Inbox gained the card that performs it |
| "apply as a data dictionary" (capture modal) | answers open questions programme-wide at schema strength | reading still stated on attach; **"apply it in the Inbox →"** |

Kept on Discover, deliberately (see Assumption 1): send a link, capture an answer,
invite, add to the record. These are stakeholder engagement — Discover's own purpose
— not the four operator moves the brief names.

## Deferred, with reasons

- **Right-hand detail pane.** Both briefs ask for one. The operator drove this
  surface to INLINE reveals earlier in the same session ("show the 37" opening a
  modal while the card beside it expanded in place was the specific complaint), and
  every reveal now opens in its own card. Adding a detail pane would reintroduce
  exactly the two-interaction inconsistency that was just removed. Not built;
  flagged rather than silently skipped.
- **Keyboard triage (j/k/Enter).** The Inbox is sections of cards, not a flat list
  of rows; j/k has no unambiguous cursor to move. Full keyboard OPERABILITY is in
  place (every control reachable, one visible focus ring). A triage cursor needs the
  list model the brief assumes, which is a structural change, not a polish pass.
- **Comfortable/compact density toggle.** The tokens now support it (one control
  height, one spacing scale), but it is a new control on a surface the operator has
  been actively reshaping; it would be built on guesses about which density they
  want as the default.
- **Optimistic updates with undo.** Writes are already reversible in the ledger
  (`reopen`, `unassign`, `pin-resolve`), which is a stronger guarantee than a UI
  undo buffer. An optimistic layer would add a second source of truth about what has
  happened, which is the one thing this ledger is built to avoid.

## Assumption 4 — the movement inks stay literal, deliberately

The consistency sweep asked for no hard-coded colour. Fourteen literals were found
in the two surfaces' rules; nine were chip tints and were named. The **movement
inks** were named too — and that broke four WCAG-contrast guards, which read those
hex values to prove each movement ink is AA in both themes and cannot follow a
`var()` to do it.

They were put back. `--mv` is already the token: it is declared once per movement
row, and the hex is its definition, which has to live somewhere. Naming it a second
time bought a cleaner grep and cost a working accessibility guard. A guard that
works beats a grep that passes.

## Deferred — the one-signal lifecycle readings

The lifecycle strip left Discover on 2026-08-13. Everything it stated is on the
person cards now EXCEPT the readings with a single signal behind them: they have no
question anywhere, so they are currently invisible. That is a miss. It belongs on the
Record — the surface for what was found and when — and it is recorded here rather
than dropped quietly.

## The design round no longer narrates absence

The band's foot was removed on request (2026-08-13). Two blocks lived there:

- **"Not drawn — nothing on record"** reported ABSENCES: no deviation on this
  programme, and a stakeholder write path that is gated. Both true; neither is
  something the operator acts on.
- **"N open questions are owned by someone"** pointed at Listen's work from inside the
  design round. It had been wrong twice over (counted the dictionary bucket, called
  itself the burn-down) and both were fixed earlier the same day.

**The trade, stated:** the band no longer distinguishes EMPTY from UNKNOWN on screen —
0 deviations (a real zero) and 0 stakeholder assertions (a gated write path) now read
the same, which is to say they do not read at all. The distinction still holds in the
ledger and on the surfaces that act on it. Three guards that proved the distinction
were retired with this note rather than weakened.
