# Next-session brief — Aura / brillio-atos

Paste the block under "THE PROMPT" into a fresh session. Everything below it is the
detail that prompt refers to.

---

## THE PROMPT

> Continue the Aura work in `~/ATOS/brillio-atos`, branch `reimagined-ui`.
>
> **Orient first, before doing anything:**
> 1. `export PATH="$HOME/tools/node/bin:$HOME/.deno/bin:$PATH"` — node, deno and the
>    supabase CLI are all OFF the default Bash PATH. Assuming they're absent is a real
>    mistake that has been made; check before claiming a tool is missing.
> 2. Read `docs/aura/next-session-brief.md` (this file) and
>    `docs/aura/backlog-completion-*.md` if it exists.
> 3. Run `bash scripts/validate-pipeline.sh` (17 invariant checks) and `npx vitest run`.
>    That tells you the true state without reading much code.
> 4. `git log --oneline -15` and `git status` — a background workflow may have landed
>    or partially landed work.
>
> **Then work the PENDING list below in order.** Prefer delegating bounded tasks to
> Workflow subagents early rather than doing everything in-context — context
> exhaustion caused real errors last session.
>
> **Non-negotiable invariants** (this codebase exists to enforce them):
> one definition per number, computed once, read by every surface; no fabricated
> owners/counts/prices/confidence — a miss stays visible; question text comes ONLY from
> `src/v3/lib/ledger/renderQuestion.ts`; the frozen core
> (`src/v3/lib/ledger/{store,types,precedence,projections}.ts`) is not edited — a needed
> core change is a FINDING; conservation holds
> (`open === owner-queue + dictionary + role/joint-owned`).
>
> Do not push without being asked. Do not deploy edge functions without being asked.

---

## STATE AT HANDOFF (2026-08-10)

**Pushed:** through `d06cca1`. **Unpushed:** `564cd3d` (classic Flow sunset).
**Deployed live:** `run-agent` on project `vudqrrqpipnkxzxslbim` (Brillio - ADAM) —
carries the SME placeholder prompt + the budget-vs-provider 429 fix.
Tests were green at handoff (1298) with a background workflow still running.

### Background workflow (may have completed since)
Run `wf_94981eef-76c`, script at
`~/.claude/projects/<project>/<session>/workflows/scripts/aura-backlog-complete-wf_94981eef-76c.js`.
9 tasks, sequential. Resume with
`Workflow({scriptPath: "<that path>", resumeFromRunId: "wf_94981eef-76c"})` — completed
agents replay from cache. **The last two tasks were added AFTER the run started, so the
in-flight run does not include them; resuming from the script picks them up.**

---

## PENDING

### A. In the workflow (verify each actually landed — do not assume)
1. **sunset-classic-flow** — DONE (`564cd3d`), unpushed.
2. **people-duplicates** — user-reported duplicate rows in People (Laila). Cause:
   `FlowShell.tsx` FlowPeople merges 4 lists and keys identity on
   `peopleIdentity(r.role)` — ROLE, not person — so one human under two role spellings
   makes two rows. **DANGER: keying too loosely MERGES TWO DIFFERENT PEOPLE.** Dedupe by
   person identity when a name exists; role identity only for `— TBC` placeholders.
   Must keep working: two different people in the same role → two rows (supported design).
3. **inbox-badge** (queued late) — the left-rail Inbox icon shows no number.
   `waitingCount` (`FlowShell.tsx` ~541) omits the ledger operator queue that moved into
   the Inbox in `d9c69e0`. Fix with ONE exported helper shared by the badge and the Inbox
   page's own emptiness check.
4. **sessions-collapse** (queued late) — Sessions renders 8 pair cards whose only control
   is a gated button. Collapse to one expandable summary line. **Do NOT delete it:** joint
   owners are excluded from `soloByOwner` (see the `joint` branch in `useProgramLedger`),
   so this section is those questions' only home.
5. **model-catalog** — settings list lacks current models. Root cause is a SECOND source
   of truth: `IntelligenceView.tsx:444` hardcodes its own array duplicating
   `supabase/functions/_shared/modelCatalog.ts`. Add Opus 4.8 / Sonnet 5 / Fable 5, mark
   superseded ones `legacy`, add a client↔edge lockstep test (text-parse idiom — see
   `answerCapLockstep.test.ts`). **Do not invent prices** — flag unverified.
6. **pack-pipeline** — HIGHEST RISK. The stakeholder linked page still receives stored
   question STRINGS (`flowInterviewPacks[].questions`); it is the last producer off the
   single-source renderer. Packs should carry loci; render via `renderQuestion` with
   affordances. Backward-compatible with string-only packs. May need an edge change.
7. **inflight-pinning** — a sent link must PIN its questions; re-derivation may not move
   them silently; disagreement surfaces as an operator decision.
8. **locus-minting** — no curation path exists to act on an `ontology-gap` kit question.
   Surface-layer overlay only; provisional, attributed, retractable.
9. **schema-trio** — (a) demote kit agenda strings to a versioned cache, (b) add a Frame
   input naming systems of record so the ask can exist before an ontology, (c) per-SoR
   keyed `_dataDictionary` (a plain string must stay valid).

### B. Not in the workflow — still open
- **Dormant server-side generator.** `_shared/ledgerGenerator.ts`, `optionA.ts`,
  `overrideAdapter.ts` are imported by NO deployed function (proven by the deploy upload
  manifest). The owner-fabrication fix there ships nowhere. DECIDE: wire the Option-A
  path, or delete the dead code. Do not leave it ambiguous.
- **Stakeholder-facing prototype is still model-authored.** The deterministic fabric
  assembly is only in the operator studio (`PrototypeStudio`); `flow-portal` still serves
  `prototypeBuild.html` to stakeholders. Decide: serve the assembly there too, or keep
  the model path as a refinement layer (retiring it kills the refine loop).
- **Constant owners** in `src/v3/lib/ledger/adapters.ts:19` and
  `supabase/functions/_shared/overrideAdapter.ts:13` — the same fabrication pattern that
  caused the Chief-of-Surgery bug. Dormant (not in the live read path). Retire before
  those adapters go live.
- **Adjudicate caveat has no home.** Hiding zero-count sections removed the honest note
  that "0 conflicts" partly means "no one has answered yet" (0 stakeholder assertions).
  Find it an honest home that doesn't resurrect a hidden-by-request panel.
- **LLM polish layer** on `renderQuestion` — gated enhancement; may rephrase, never change
  locus or kind, falls back to the template.
- **Kits must be REGENERATED** for the SME placeholder change to appear; existing kits
  keep `Head of … — TBC`.

### C. Needs the live DB / a real program (BLOCKED locally)
- Surgery: confirm the 61 "need an owner" drains after the owner fix + regeneration.
- Laila roster chips (Head of Sales 9 / Head of GTM 15) vs the projection.
- The provided-up-front dictionary path end to end (Salesforce export).
- `audit_events` rows for the three closure methods.
- A real duplicated People pair to validate the dedupe fix against.

---

## TOOLCHAIN NOTES (learned the hard way)
- node/npm: `$HOME/tools/node/bin`. deno 2.9.5: `$HOME/.deno/bin`. Neither on PATH.
- Supabase CLI: `npx --yes supabase@latest` (v2.113.0). Session is CACHED, project
  `vudqrrqpipnkxzxslbim` LINKED. `supabase functions deploy run-agent --project-ref …`
  works. Docker is not running, so no `supabase start`.
- `deno check` works on shared modules with NO remote imports; on function ENTRYPOINTS it
  fails with `invalid peer certificate: UnknownIssuer` — TLS interception in the sandbox,
  not a deno fault. Entrypoints are verified only by the deploy bundler.
- The deploy upload manifest is the truth about what a function actually bundles.
- `npm run claims:regen -- --force` only when the change is mechanics/comments, never for
  a new user-facing claim.
- Verify: `npx tsc --noEmit`, `npx eslint <files>`, `npx vitest run`,
  `bash scripts/validate-pipeline.sh`.

## KEY DOCS
`full-validation-2026-08-10.md` (17-check report) · `one-question-renderer.md` ·
`kit-question-projection.md` · `artifact-asks.md` · `owner-routing-fabrication-fix.md` ·
`need-an-owner-61.md` · `data-dictionary-import.md` · `prototype-design-system.md`
