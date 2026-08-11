#!/usr/bin/env bash
# validate-pipeline.sh — the repeatable A–G validation harness
# (docs/aura/full-validation-*.md). Runs every check that is scriptable in this
# environment; DB-gated checks are listed BLOCKED in the report, not here.
# Usage: bash scripts/validate-pipeline.sh   (exit 0 = all scripted checks pass)
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/tools/node/bin:$HOME/.deno/bin:$PATH"
FAIL=0
say()  { printf "\n== %s ==\n" "$1"; }
pass() { printf "PASS  %s\n" "$1"; }
fail() { printf "FAIL  %s\n" "$1"; FAIL=1; }

run_tests() { # $1 label, rest: vitest files
  local label="$1"; shift
  if npx vitest run "$@" >/tmp/vp-out.txt 2>&1; then pass "$label"; else fail "$label (see /tmp/vp-out.txt)"; fi
}

say "A. SINGLE SOURCE"
# A1 — exactly one question-text producer (renderQuestion.ts)
PRODUCERS=$(grep -rln "One step in\|Should this be automated\|What values can\|Which phase does" src/v3 --include="*.ts" --include="*.tsx" | grep -v __tests__ | grep -v "renderQuestion.ts" || true)
[ -z "$PRODUCERS" ] && pass "A1 one question-text producer" || fail "A1 extra producers: $PRODUCERS"
# A2 — truncation artifacts in committed blobs/fixtures
ART=$(grep -rn " the be \| to pre be\| and u —\|…\"" docs/laila/snapshot-2026-08-07/*.json 2>/dev/null || true)
[ -z "$ART" ] && pass "A2 no truncation artifacts in stored blobs" || fail "A2 artifacts: $ART"
# A3 — three surfaces one set (cold, fresh stores)
run_tests "A3 three surfaces one set (cold)" src/v3/__tests__/pipelineValidation.test.ts src/v3/__tests__/renderQuestion.test.ts src/v3/__tests__/kitProjection.test.ts

say "B. ROUTING"
# B1/B2 — no fabricated/default owners; most-specific wins; miss -> unowned
run_tests "B1/B2 owner routing (no default owner, specific wins)" src/v3/__tests__/ownerRoutingRegression.test.ts
# The file must EXIST before its contents are judged: a missing file makes grep exit
# non-zero, which the `&& fail || pass` shape reports as PASS. Deleting migrate.ts would
# have printed "no default-owner branch" — a guard passing because its subject vanished.
B1_SRC=src/v3/lib/ledger/migrate.ts
if [ ! -f "$B1_SRC" ]; then fail "B1 subject missing at $B1_SRC"
elif grep -qn 'ownerFor("sales ops")\|fallback: string' "$B1_SRC"; then fail "B1 default-owner branch present in migrate.ts"
else pass "B1 no default-owner branch (grep)"; fi
# B3 — partition (also in pipelineValidation) + conservation
run_tests "B3 partition + conservation" src/v3/__tests__/inboxReconciliation.test.ts
# B4 — in-flight-with-0-sent unrepresentable (guard is in the row builder)
grep -qn "questions.length > 0" src/v3/components/flow/TheLine.tsx && pass "B4 in-flight requires sent questions (guard present)" || fail "B4 guard missing in TheLine.tsx"
# B5 — a SENT question is PINNED to its recipient: re-derivation (and a later assign)
#      never moves it; a disagreement is an operator decision, never an automatic sweep.
run_tests "B5 in-flight pinning (pin beats re-derivation; disagreement = a decision)" src/v3/__tests__/inFlightPinning.test.ts

say "C. FRAME / DICTIONARY"
run_tests "C1/C2 one ask per SoR, states, conservation" src/v3/__tests__/artifactAsks.test.ts
run_tests "C3/C4 dictionary import closes external-authoritative, deviatable" src/v3/__tests__/dictionaryImport.test.ts

say "D. RENDERER"
run_tests "D1-D3 renderer (artifacts, casing, affordances, grouping)" src/v3/__tests__/renderQuestion.test.ts src/v3/__tests__/pipelineValidation.test.ts

say "E. CLOSURE + CONSERVATION"
run_tests "E1/E2 closures move burn-down; conservation around mutations" src/v3/__tests__/pipelineValidation.test.ts src/v3/__tests__/convergenceBurnDown.test.ts
# E3 — convergence counts only real (verbatim) closures
run_tests "E3 convergence = real closures only" src/v3/__tests__/convergenceBurnDown.test.ts

say "F. REGRESSION SENTRIES"
# F2 — zero-count sections hidden by request (2026-08-10) — assert no resurrected collapsed rows
# Same existence guard as B1 — a deleted OperatorInbox would have printed PASS.
F2_SRC=src/v3/components/flow/OperatorInbox.tsx
if [ ! -f "$F2_SRC" ]; then fail "F2 subject missing at $F2_SRC"
elif grep -qn "v3ib-collapsed-row" "$F2_SRC"; then fail "F2 collapsed rows resurrected"
else pass "F2 zero sections hidden (by request), none resurrected"; fi
# F4 — ONE fossil regression, and the label says so. This greps a single fixed string;
#      it does NOT check "no constant-owner fabrication in ledger paths", which is what
#      it used to claim. Two fabricated constant owners planted on the live path during
#      the refutation pass walked straight past it and it printed PASS in the same run
#      that F5 went red. Kept because the specific line is worth pinning; relabelled
#      because an overstated PASS is worse than no check. F5 is the real invariant.
FAB=$(grep -rn 'ownerFor("sales ops")' src/v3/lib/ledger/ supabase/functions/_shared/ledgerGenerator.ts 2>/dev/null || true)
[ -z "$FAB" ] && pass 'F4 no ownerFor("sales ops") regression (one fixed string — F5 is the real scan)' || fail "F4 fabrication: $FAB"
# F5 — the FINAL GATE's three invariants, checked against the shipped source: one
#      question-text producer, no constant role-owner literal anywhere in the ledger
#      (ONE exemption — the dictionary's neutral band — and it is CONDITIONAL on that
#      literal only ever landing on a weak/closed claim), and ONE expression behind both
#      the rail badge and the Inbox page's empty state. This grep-of-4-phrases (A1) is
#      why F5 exists: it reads the files, so a rename cannot slip past a fixed string.
run_tests "F5 final-gate invariants (one producer, no constant owner, one inbox count)" src/v3/__tests__/finalGateInvariants.test.ts
# F6 — the guards BEHIND F5, fed the bypasses that used to slip past them: the plural
#      operatorQueueCounts spelling, the ledger modules a hardcoded file list never
#      scanned, and a "System Owner" exempted on the string alone. A sentry nobody has
#      shown to fail is not a sentry, so F5's predicates are themselves under test.
run_tests "F6 the F5 guards catch their own bypasses" src/v3/__tests__/sourceGuards.test.ts
# F7 — the one invariant F5 could never actually check: THE BADGE IS THE PAGE. F5's
#      headline (c) compared inboxWaitingCount against its own definition and so could
#      not fail for any input; the claim "the rail badge equals what the Inbox renders"
#      was asserted nowhere. F7 MOUNTS FlowShell over four programme shapes (empty /
#      ledger-only / mixed / with a ruling), reads the badge off the dock and counts the
#      rows on the page. The two documented divergences — the collapsed Sessions line and
#      the decided trace — are named expectations here, not weakened assertions.
run_tests "F7 the badge equals the rendered Inbox page (DOM)" src/v3/__tests__/inboxBadgeIsThePage.test.ts

say "H. EDGE TYPE GATE"
# H1 — THE EDGE HAS NO TYPE GATE OTHERWISE. `tsconfig.json` includes src/** only, so
# `tsc --noEmit` never reads supabase/functions at all: an edge module can carry a real
# type error indefinitely and every gate stays green. That is not hypothetical -
# claudeClient.ts held a TS2322 (a filter that never narrowed) through this whole branch,
# invisible, and a module whose check always fails is a module where the NEXT error cannot
# be seen either.
#
# `deno check` on function ENTRYPOINTS fails in this sandbox on remote imports
# (`invalid peer certificate: UnknownIssuer`) - TLS interception, not a code fault. So the
# gate covers the _shared modules, and a module that cannot be reached is reported SKIP by
# name rather than counted as a pass. Silence is not success.
if ! command -v deno >/dev/null 2>&1; then
  fail "H1 deno not on PATH - the edge type gate cannot run (export \$HOME/.deno/bin)"
else
  # BRANCH ON THE EXIT CODE, never on the message. The first version of this check
  # grepped the output for "TS<n> [ERROR]" and silently passed a real TS2322: deno colours
  # its output, so ANSI escapes sit between the code and the bracket and the pattern never
  # matched. A guard that reads formatted text is a guard that a formatting change
  # disables. The exit code is the contract; the text is only used to tell the sandbox TLS
  # failure apart from a genuine one.
  H1_BAD=""; H1_SKIP=""
  for f in supabase/functions/_shared/*.ts; do
    if OUT=$(deno check "$f" 2>&1); then continue; fi
    if printf '%s' "$OUT" | grep -q "UnknownIssuer"; then H1_SKIP="$H1_SKIP $(basename "$f")"
    else H1_BAD="$H1_BAD $(basename "$f")"; fi
  done
  [ -n "$H1_SKIP" ] && printf "SKIP  H1 unreachable (sandbox TLS, not a code fault):%s\n" "$H1_SKIP"
  [ -z "$H1_BAD" ] && pass "H1 every reachable _shared module type-checks" || fail "H1 type errors in:$H1_BAD"
fi

say "G. FABRIC -> MERIDIAN"
# G1 — assembler reachable from the studio; no model call in the render path.
# ONE copy of the assembler, in the Deno-importable shared layer: the studio
# (Vite) and flow-portal (Deno) import the same file, so operator and stakeholder
# cannot drift apart. src/v3/lib is deliberately NOT a mirror — see
# src/v3/__tests__/prototypeAssemblySource.test.ts.
ASSEMBLER=supabase/functions/_shared/prototypeAssembly.ts
grep -qn "assemblePrototype" src/v3/components/flow/studio/PrototypeStudio.tsx && pass "G1 assembler wired into the studio render path" || fail "G1 assembler unreachable"
# The file must EXIST before its contents are judged. A missing assembler makes the
# content grep exit non-zero, which the old one-liner reported as PASS.
if [ ! -f "$ASSEMBLER" ]; then fail "G1 assembler missing at $ASSEMBLER"
elif grep -qn "fetch\|anthropic\|claude" "$ASSEMBLER"; then fail "G1 model/network call in the render path"
else pass "G1 zero model tokens for structure (no model/network call)"; fi
# G1b — the STAKEHOLDER-facing page renders the same deterministic assembly, and the
# portal no longer reaches for the stored model-authored prototypeBuild.html. Both
# halves are asserted: importing the pilot is not enough if the old path survives.
PROTO_BUILD_READS=$(grep -n "prototypeBuild" supabase/functions/flow-portal/index.ts | grep -v "^[0-9]*: *//" || true)
if ! grep -qn "_shared/prototypePilot.ts" supabase/functions/flow-portal/index.ts; then fail "G1 stakeholder path not wired to the assembly"
elif [ -n "$PROTO_BUILD_READS" ]; then fail "G1 portal still reads the model-authored prototypeBuild: $PROTO_BUILD_READS"
else pass "G1 assembler wired into the stakeholder (portal) render path"; fi
# G2/G3/G4 — fallback honesty, both programs one table, tokens, incremental
run_tests "G2-G4 assembly (generic fallback, AA tokens, no leakage, diffFabric)" src/v3/__tests__/pipelineValidation.test.ts src/v3/__tests__/prototypeAssembly.test.ts src/v3/__tests__/prototypeDesignSystem.test.ts src/v3/__tests__/fabric.test.ts src/v3/__tests__/fabricDelta.test.ts src/v3/__tests__/prototypeAssemblySource.test.ts

say "RESULT"
if [ "$FAIL" -eq 0 ]; then echo "ALL SCRIPTED CHECKS PASS"; else echo "FAILURES PRESENT (see above)"; fi
exit $FAIL
