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
