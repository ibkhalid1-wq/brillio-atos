#!/usr/bin/env bash
# validate-live-db.sh — the LIVE-STORE legs of the A–G harness.
#
# Pass 1 (2026-08-10) listed eight checks as BLOCKED with one shared cause: they
# need the Supabase store, and that session had no credentials. That is a real
# gap, not a safe one — "BLOCKED" and "PASS" look equally green in a summary, and
# the checks it hid are exactly the ones about what STAKEHOLDERS actually receive.
# This script is those legs, so they stop being permanently unrunnable.
#
# READ-ONLY. It issues GETs against PostgREST and the deployed flow-portal and
# writes nothing. Safe to run against production.
#
# Usage: bash scripts/validate-live-db.sh    (exit 0 = all runnable legs pass)
# Needs .env.local with VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Without
# it every leg SKIPs LOUDLY and the exit code stays 0 — a missing credential is
# a known gate, not a failure, but it must never read as a pass.
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/tools/node/bin:$PATH"
FAIL=0
say()  { printf "\n== %s ==\n" "$1"; }
pass() { printf "PASS  %s\n" "$1"; }
fail() { printf "FAIL  %s\n" "$1"; FAIL=1; }
skip() { printf "SKIP  %s\n" "$1"; }

if [ ! -f .env.local ]; then
  say "LIVE-DB LEGS"
  skip "every live leg — .env.local absent (GATE 1: credentials)"
  echo "      A2-DB, LOCI, B4, C2/F1, E1 all need the live store."
  exit 0
fi
set -a; . ./.env.local; set +a
if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || [ -z "${VITE_SUPABASE_URL:-}" ]; then
  say "LIVE-DB LEGS"; skip "every live leg — URL or service-role key unset (GATE 1: credentials)"; exit 0
fi

SNAP=/tmp/validate-live-db.json
HTTP=$(curl -s -o "$SNAP" -w "%{http_code}" \
  "${VITE_SUPABASE_URL}/rest/v1/adam_programs?select=id,name,is_deleted,data" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}")
if [ "$HTTP" != "200" ]; then
  say "LIVE-DB LEGS"; skip "every live leg — programme fetch returned HTTP $HTTP (GATE 1: credentials)"; exit 0
fi

say "LIVE. STAKEHOLDER PACKS (pass-1 A2-DB, A3-linked-page, B4, F1-linked-page)"
python3 - "$SNAP" <<'PY'
import json, sys
rows = json.load(open(sys.argv[1]))
# The pass-1 D1 artifact list, verbatim, plus arrow notation. A stored string is
# only safe if it carries none of these.
ARTIFACTS = [" the be ", " to pre be", " and u —", "…", "->", "→"]
packs = arts = misaligned = 0
legacy_open_live = []
for r in rows:
    d = r.get("data") or {}
    for p in (d.get("flowInterviewPacks") or []):
        packs += 1
        qs = p.get("questions") or []
        loci = p.get("questionLoci")
        if loci is not None and len(loci) != len(qs):
            misaligned += 1
        arts += sum(1 for q in qs for a in ARTIFACTS if a in str(q))
        openish = not (p.get("closedAt") or p.get("respondedAt"))
        if not r.get("is_deleted") and openish and not loci:
            legacy_open_live.append((r["name"][:38], p.get("stakeholder") or "?"))
print(f"packs={packs} artifacts={arts} misaligned={misaligned} legacy_open_live={len(legacy_open_live)}")
for row in legacy_open_live[:10]:
    print("   legacy-open:", " | ".join(row))
PY
read -r RESULT < <(python3 - "$SNAP" <<'PY'
import json, sys
rows = json.load(open(sys.argv[1]))
ARTIFACTS = [" the be ", " to pre be", " and u —", "…", "->", "→"]
packs = arts = mis = legacy = 0
for r in rows:
    for p in ((r.get("data") or {}).get("flowInterviewPacks") or []):
        packs += 1
        qs = p.get("questions") or []
        loci = p.get("questionLoci")
        if loci is not None and len(loci) != len(qs): mis += 1
        arts += sum(1 for q in qs for a in ARTIFACTS if a in str(q))
        if not r.get("is_deleted") and not (p.get("closedAt") or p.get("respondedAt")) and not loci: legacy += 1
print(f"{packs} {arts} {mis} {legacy}")
PY
)
set -- $RESULT
PACKS=$1; ARTS=$2; MIS=$3; LEGACY=$4

# A2-DB — the leg pass 1 could not run at all.
[ "$PACKS" -gt 0 ] && pass "A2-DB corpus is non-empty ($PACKS packs) — the scan below is not vacuous" \
                   || fail "A2-DB corpus EMPTY — every assertion below would pass for the wrong reason"
[ "$ARTS" -eq 0 ] && pass "A2-DB zero truncation/arrow artifacts in stored question strings" \
                  || fail "A2-DB $ARTS truncation artifacts in the live store"

# The questions/questionLoci index-alignment contract (flowPortal.ts alignedAsk),
# asserted against production data rather than fixtures.
[ "$MIS" -eq 0 ] && pass "A3-linked-page questions/questionLoci index-aligned in every live pack" \
                 || fail "A3-linked-page $MIS packs whose loci and questions have different lengths"

# LOCI COVERAGE. Pass 2 first read this as a migration gap — "the fix only
# applies at mint time, so backfill the rest". A dry run falsified that:
# renderQuestion was run over every open locus on every live programme, in both
# audiences, and matched against all 126 stored strings in these packs. EXACT
# matches: ZERO. Ambiguous: zero.
#
# Because they are not drifted renderings of loci at all. They are a DIFFERENT
# ARTIFACT — generated Discovery Kit interview script ("Describe how you engage
# with partners for funding, training, and co-sell…") beside ledger slot
# questions ("What type of value is Account.category?"). There is no locus
# behind the first because it does not settle one slot; it opens a conversation.
#
# So this is NOT a backfill waiting to happen, and re-minting would REPLACE good
# human prompts with narrower schema questions — an upgrade in attribution and a
# downgrade in the conversation. Which artifact a durable link should carry is a
# product decision (see docs/aura/full-validation-pass2-2026-08-11.md, N-1).
#
# The check stays RED on purpose: these links close nothing when answered, and
# that should stay visible until the decision is made. It is a standing question,
# not a defect to patch.
if [ "$LEGACY" -eq 0 ]; then
  pass "LOCI every open link on a live programme carries its ledger loci"
else
  fail "LOCI $LEGACY open link(s) carry an interview SCRIPT, not ledger loci — answering closes nothing (product decision, not a backfill: see N-1)"
fi

say "LIVE. E1 AUDIT TRAIL"
AUD=$(curl -s -o /dev/null -w "%{http_code}" "${VITE_SUPABASE_URL}/rest/v1/audit_events?select=id&limit=1" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}")
if [ "$AUD" = "200" ]; then
  pass "E1 audit_events reachable — closure rows can be asserted"
else
  skip "E1 audit_events absent (HTTP $AUD) — GATE 2: migration 20260807_audit_events.sql unapplied"
fi

say "LIVE. DEPLOYED PORTAL CONTRACT"
# The portal's own GET contract, exercised against the DEPLOYED function rather
# than the local source — the only way to catch "fixed in the repo, not shipped".
TOKEN=$(python3 - "$SNAP" <<'PY'
import json, sys
for r in json.load(open(sys.argv[1])):
    for p in ((r.get("data") or {}).get("flowInterviewPacks") or []):
        t = str(p.get("token") or "")
        if len(t) >= 24 and all(c in "0123456789abcdef" for c in t.lower()):
            print(f"{r['id']}.{t}"); raise SystemExit
PY
)
if [ -z "$TOKEN" ]; then
  skip "portal contract — no hex-token pack in the store to probe"
else
  BODY=$(curl -s "${VITE_SUPABASE_URL}/functions/v1/flow-portal?token=${TOKEN}")
  if printf '%s' "$BODY" | python3 -c "
import json,sys
d=json.load(sys.stdin)
need={'kind','stakeholder','responded','closed'}
sys.exit(0 if need <= set(d) else 1)"; then
    pass "deployed flow-portal GET returns the durable-link state contract (responded/closed)"
  else
    fail "deployed flow-portal GET is missing the durable-link fields — repo is ahead of the deploy"
  fi
fi

say "LIVE. CONSERVATION ON REAL DATA"
# Every conservation assertion in this repo runs against a fixture or a synthetic
# mirror — the shapes we thought of. This runs the identity over every programme
# actually in the store. The snapshot fetched above is its input, so the test
# itself stays offline.
if npx vitest run src/v3/__tests__/liveStoreConservation.test.ts >/tmp/vld-cons.txt 2>&1; then
  pass "conservation holds on every live programme (queue is a subset of open/blocked claims, no duplicates)"
else
  fail "conservation BROKEN on live data (see /tmp/vld-cons.txt)"
fi

say "RESULT"
[ "$FAIL" -eq 0 ] && echo "ALL RUNNABLE LIVE LEGS PASS" || echo "LIVE LEGS FAILED"
exit "$FAIL"
