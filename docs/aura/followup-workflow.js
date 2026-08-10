// Follow-up workflow: the TWO tasks queued after the main backlog run started.
// Run this ONLY after the main run (wf_94981eef-76c) has finished and pushed.
// Do NOT resume the main script — inserting these tasks broke its cache prefix, so a
// resume would re-run five already-committed tasks on top of themselves.
//
//   Workflow({ scriptPath: "docs/aura/followup-workflow.js" })
export const meta = {
  name: 'aura-followup-inbox-badge-sessions',
  description: 'Inbox rail badge counts the ledger queue; Sessions collapses to one line',
  phases: [{ title: 'Fixes' }, { title: 'Verify' }],
}

const REPO = '/Users/Ibrahim.Khalid/ATOS/brillio-atos'

const BASE = `You are working in ${REPO} (branch reimagined-ui). Work AUTONOMOUSLY: never ask; decide, and record the decision + rationale in the commit message.

TOOLCHAIN (binaries are OFF the default PATH — always prefix):
  export PATH="$HOME/tools/node/bin:$HOME/.deno/bin:$PATH"
  npx tsc --noEmit ; npx eslint <changed files> ; npx vitest run ; bash scripts/validate-pipeline.sh
  npm run claims:regen -- --force   # ONLY if claimsRegister fails on comments/mechanics, never for a new user-facing claim

INVARIANTS: one definition per number, computed once, read by every surface — never a second copy of a count. No fabricated owners/counts. Question text ONLY from src/v3/lib/ledger/renderQuestion.ts. Frozen core (src/v3/lib/ledger/{store,types,precedence,projections}.ts) untouched — a needed core change is a FINDING. Conservation holds.

DONE = tsc clean, eslint clean, full vitest green, validate-pipeline all PASS, a regression test proving YOUR change, and a commit stating what/why/evidence/judgment calls/anything unverified. If you cannot finish safely, commit what is genuinely done and end with "INCOMPLETE: <what remains and why>". NEVER leave the tree failing.`

phase('Fixes')

await agent(BASE + `

TASK: The left-rail INBOX icon shows no number even when the Inbox has items (user-reported: the Inbox page read "8 awaiting a date" plus 5 dictionary asks while the rail icon was bare).

Root cause (verify, then fix): src/v3/components/flow/FlowShell.tsx computes waitingCount (~line 541) from decisions + portal inbox + approvals + disputes + unresolved roles + coverage names + governed exceptions. The badge renders from it (~line 656, class "v3fs-dock-n"). But the LEDGER OPERATOR QUEUE moved into the Inbox view (commit d9c69e0) and is NOT in that sum: assign queue, seam sessions, conflicts, in-flight assignments and the dictionary chase asks all render on the Inbox page and count for nothing in the badge.

Fix with ONE definition, not a second count: derive the ledger operator items from the SAME reads the Inbox page uses (useProgramLedger + asksNeedingChase from src/v3/lib/ledger/artifactAsks.ts — mirror how src/v3/components/flow/OperatorInbox.tsx computes its "nothingToShow": assignQueue, sessionQueue, conflicts, assignments, chase asks, decideFates). Extract ONE exported helper used by BOTH the badge and the Inbox page's emptiness check so they can never diverge — do NOT copy the expression.
Keep intact: OperatorInbox still returns null when everything is empty; the badge still hides at 0.
Test: a program with only ledger operator items (no decisions/approvals) yields a NON-ZERO badge; an empty program yields 0 and no badge; the badge equals the Inbox page's own item count in both cases.`, { label: 'inbox-badge', phase: 'Fixes' })

await agent(BASE + `

TASK: The Sessions section in the operator inbox is over-presented. Collapse it to ONE line, expandable.

Context (verified — do not relitigate): seam questions are joint-owned, and src/v3/lib/ledger/useProgramLedger.ts EXCLUDES joint owners from soloByOwner (the joint branch pushes to sessionMap then continues), so these questions appear on NO individual's Discover list. This section is their ONLY home — do NOT delete it and do NOT let the count go dark. The problem is purely presentation: on Laila it renders 8 pair cards whose single control is "propose a time", and scheduling is GATED (that button records intent and books nothing).

Do, in src/v3/components/flow/OperatorInbox.tsx (the ib-sessions section): render a single summary row by default — e.g. "⋈ Sessions · 8 seams, 23 questions — need a joint conversation; scheduling gated" — with a disclosure expanding to today's per-pair rows unchanged (pair, joint-question count, awaiting-a-date, propose-a-time).
Requirements: the SEAM count and the TOTAL JOINT-QUESTION count both stay visible collapsed (unit = QUESTIONS, summed from the SAME ledger.sessionQueue read the rows use — never a second count); keep the "0 seams -> section hidden" rule and the ProvisionalMark about gated scheduling; default COLLAPSED, no persistence; keyboard accessible (a real <button> with aria-expanded).
Test: collapsed counts equal the expanded rows' sum; expanding reveals exactly ledger.sessionQueue.length rows; 0 seams renders nothing.`, { label: 'sessions-collapse', phase: 'Fixes' })

phase('Verify')

const verdict = await agent(BASE + `

TASK: FINAL GATE — be hostile; assume the two previous agents broke something.

1. Run from ${REPO}: npx tsc --noEmit ; npm run lint (or npx eslint . --max-warnings 0) ; npx vitest run ; bash scripts/validate-pipeline.sh. Record exact numbers.
2. If ANYTHING fails: fix it if small and obvious, else 'git revert' the offending commit. A green branch matters more than a feature landing.
3. Re-check by READING, not assuming: (a) question text is produced ONLY in renderQuestion.ts; (b) no default/constant owner returns in src/v3/lib/ledger/; (c) the badge count and the Inbox page's emptiness check come from ONE shared helper (grep it — if there are two expressions, that is a FAIL, fix it).
4. Append a section to docs/aura/backlog-completion-*.md (or create it) covering these two tasks: DONE/PARTIAL/REVERTED, evidence, anything outstanding with its blocker.
5. Commit, then: git push origin reimagined-ui.
Report final numbers, the push result, and what remains.`, { label: 'final-gate', phase: 'Verify' })

return { verdict }
