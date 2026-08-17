/**
 * THE STAKEHOLDER WRITE PATH — the channel by which a person's own answer becomes a
 * claim on the locus they were asked about.
 *
 * Until now there was none. Questions went OUT with their loci attached (a pack's
 * `questionLoci`, index-aligned with `questions`), and what came back was a single
 * block of free text, quarantined and ingested as evidence. Nothing ever attached a
 * reply to the question it answered, so:
 *
 *   · the locus stayed open on the burn-down for ever;
 *   · the heard count could never move, because nothing produced an attributed
 *     closure — `heard = 0` on every real programme;
 *   · "Owned & in-flight" was a section that could only grow (see the worklog).
 *
 * The operator's own `capture` is deliberately NOT this. A capture is the operator
 * retyping what somebody said in a corridor: it stays beside the ledger, never
 * becomes a claim, and never ticks heard. What this module writes is different in
 * the one way that matters — the words arrived through the stakeholder's own
 * token-gated link and are attributed to THEM. The operator reviews; they do not
 * author. That is the whole boundary, and it is why this may close a locus and a
 * capture may not.
 *
 * ── The shape a closing claim has to have, and why each part ──
 *
 *   source: "asserted"    the strongest human non-regulatory source, and one of the
 *                         ATTRIBUTED_SOURCES `isHeardClosure` accepts
 *   status: "closed"      a REAL closure, not `weak` — it carries verbatim
 *   closedBy.by           the PERSON, never "operator" and never a system token
 *                         (`isHeardClosure` rejects prototype/import/system/?)
 *   closedBy.method       "assertion" — a person asserting, not an import
 *   closedBy.verbatim     their words; absent verbatim is a touch, not an answer
 *   world / layer / owner MIRRORED from the open claim being answered, never guessed
 *
 * That last one is the subtle part. A locus lives in a WORLD ("as-is" / "to-be") and
 * a LAYER, and precedence is per-world: a to-be answer asserted into as-is does not
 * supersede the open claim, it sits beside it as a second live claim and the locus
 * becomes a CONTRADICTION the operator has to adjudicate. So the answer is minted
 * against the claim it is answering, and a locus with no open claim gets no claim at
 * all — see `stakeholderAnswerClaims`.
 */
import type { AssertInput, LedgerStore } from "./store";
import type { ProgramSummary } from "@/new/types";
import { readMovementInputs } from "@/v3/components/flow/flowShellData";
import { isLive } from "./types";
import { applyOwnership, type LocusOwnership } from "./operatorActions";

/** The field on the listen inputs. Underscore-prefixed, so it is excluded from the
 *  movement fingerprint and answering a question cannot flag every document stale. */
export const STAKEHOLDER_ANSWERS_FIELD = "_stakeholderAnswers";

/**
 * One answer, as it arrives from a link. `via` is the provenance that separates this
 * from an operator capture: the pack/token the reply came in on. An entry without it
 * is not trusted to close anything (see `readStakeholderAnswers`) — that is the
 * difference between "they answered" and "somebody typed into the blob".
 */
export interface StakeholderAnswer {
  /** The locus their answer is about — `<elementId>#<slot>`. */
  about: string;
  /** Their words, verbatim. This becomes `closedBy.verbatim`. */
  answer: string;
  /** Who said it. Becomes `closedBy.by`, so it must be a person, never a system. */
  saidByName: string;
  saidByRole?: string;
  /** When they sent it (caller-supplied — the ledger never calls Date.now). */
  at: string;
  /** The link the answer arrived on: pack id or token. Provenance, and required. */
  via: string;
  /**
   * HOW IT ARRIVED, and the reason this is not always "assertion".
   *
   * A reply on somebody's own token-gated link IS an assertion — they answered,
   * in their own channel, and nobody stood between. A quote lifted from a
   * meeting transcript is their words too, but an operator read the room and
   * confirmed the match, so calling it an assertion would claim a channel it
   * never came through. `"transcript"` says what happened. It is still a HUMAN
   * closure — not `"import"` — so the person is rightly counted as heard: they
   * were, out loud, in a meeting.
   *
   * Absent ⇒ "assertion", which is what every existing row is.
   */
  method?: "assertion" | "transcript";
  /** Who attested the match, for a row that needed one. The codebase's own rule
   *  for an operator-attested statement: it names its attester and says what was
   *  said (`answer`, verbatim). */
  confirmedBy?: string;
}

/** Actors that are the SYSTEM, not a person — `isHeardClosure` rejects these, and so
 *  do we, one step earlier, so a bad row never becomes a claim in the first place. */
const SYSTEM_ACTORS = new Set(["prototype", "import", "system", "operator", "?", ""]);

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * ── THE INGEST THAT WAS MISSING ────────────────────────────────────────────────
 *
 * Answers came back with their loci attached and NOTHING READ THEM. The pack
 * sends each question with the point it settles; `composeLocusAnswers` writes
 * the reply as `Q:` / `A:` / `[locus: …]`; the reply is stored, attributed, on
 * the programme. And then the loop stopped: `parseLocusAnswers` had no
 * production caller, so every locus stayed open for ever and `heard` was zero on
 * every real programme.
 *
 * What follows is that missing half — built as a READER over what the portal
 * already wrote, not as a second write path. The answers are already on the
 * record; nothing needs to be re-stored for them to count.
 *
 * THE DISCRIMINATOR IS THE TAG ITSELF, and it has to be, because the boundary
 * this module defends is between a person's own words and an operator's retyping
 * of them. A `[locus: …]` tag is produced by exactly one thing — the response
 * surface behind somebody's token-gated link. An operator's typed capture has no
 * tags and therefore closes nothing, which is the rule stated at the top of this
 * file, now enforced by the shape of the evidence rather than by a convention
 * nobody could check.
 */

/** "— Priya Raman, Marketing lead, 2026-08-16 —" — the attribution convention
 *  the transcript fields document and `parseTranscript` already splits on. Kept
 *  to a name-with-comma so a dash-wrapped line inside a pasted document ("—
 *  INPUT SIGNALS —") cannot mint a phantom voice. */
const ATTRIBUTION = /^[—–-]{1,2}\s*(.{3,200}?)\s*[—–-]{1,2}\s*$/gm;
const LOCUS_TAG = /^\[locus:\s*(.+?)\]\s*$/;
const ISO_DAY = /\b(\d{4}-\d{2}-\d{2})\b/;

/** Split "Priya Raman, Marketing lead, 2026-08-16" into the parts a closure needs. */
function attributionOf(header: string): { name: string; role?: string; at: string } | null {
  const parts = header.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;                       // no comma: not an attribution
  if (/^Document:/i.test(parts[0])) return null;           // a document, not a voice
  const at = header.match(ISO_DAY)?.[1] ?? "";
  const dated = (p: string) => ISO_DAY.test(p) || /^\d/.test(p);
  const role = parts.slice(1).find((p) => !dated(p));
  return { name: parts[0], role, at };
}

/**
 * Every locus-tagged answer sitting in the programme's own evidence, with the
 * person it is attributed to.
 *
 * Deliberately walks EVERY movement and every string field rather than one named
 * one: a review answer lands on the movement being reviewed, and a design round's
 * lands on another. The tag is what makes a block an answer, not its address.
 */
export function deriveStakeholderAnswers(program: ProgramSummary | null | undefined): StakeholderAnswer[] {
  if (!program) return [];
  const out: StakeholderAnswer[] = [];
  for (const movementId of ["frame", "listen", "envision", "show", "evolve"]) {
    const inputs = readMovementInputs(program, movementId) as Record<string, unknown>;
    for (const [field, value] of Object.entries(inputs)) {
      const text = typeof value === "string" ? value : "";
      if (!text.includes("[locus:")) continue;
      const heads = [...text.matchAll(ATTRIBUTION)].filter((m) => attributionOf(m[1]));
      for (let i = 0; i < heads.length; i += 1) {
        const who = attributionOf(heads[i][1])!;
        const from = (heads[i].index ?? 0) + heads[i][0].length;
        const to = i + 1 < heads.length ? heads[i + 1].index ?? text.length : text.length;
        for (const block of text.slice(from, to).split(/\n{2,}/)) {
          const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
          const tag = lines.length ? LOCUS_TAG.exec(lines[lines.length - 1]) : null;
          if (!tag) continue;
          const answer = lines.find((l) => l.startsWith("A: "))?.slice(3).trim() ?? "";
          if (!answer) continue;
          out.push({
            about: tag[1].trim(), answer,
            saidByName: who.name, saidByRole: who.role,
            at: who.at,
            // The provenance a closure is required to carry: where it arrived.
            via: `${movementId}.${field}`,
          });
        }
      }
    }
  }
  return out;
}

/**
 * The answers on the record, validated. Anything that cannot honestly close a locus
 * is dropped HERE rather than minted into a claim that lies about its provenance:
 * no locus, no words, no named person, a system actor wearing a person's slot, or no
 * link to have arrived on.
 */
export function readStakeholderAnswers(program: ProgramSummary | null | undefined): StakeholderAnswer[] {
  if (!program) return [];
  const raw = (readMovementInputs(program, "listen") as Record<string, unknown> | undefined)?.[STAKEHOLDER_ANSWERS_FIELD];
  // The explicit field stays the primary channel — a caller that wants to state
  // an answer outright still can. What the derivation adds is every answer
  // ALREADY on the record, which is where they have all been sitting.
  const derived = deriveStakeholderAnswers(program);
  const arr = typeof raw === "string"
    ? (() => { try { return JSON.parse(raw) as unknown; } catch { return []; } })()
    : raw;
  if (!Array.isArray(arr)) return dedupeAnswers(derived);
  const out: StakeholderAnswer[] = [];
  for (const row of arr) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const about = str(r.about), answer = str(r.answer), saidByName = str(r.saidByName), via = str(r.via);
    if (!about || !answer || !via) continue;
    if (!saidByName || SYSTEM_ACTORS.has(saidByName.toLowerCase())) continue;
    const method = str(r.method) === "transcript" ? "transcript" as const : undefined;
    out.push({
      about, answer, saidByName, saidByRole: str(r.saidByRole) || undefined, at: str(r.at), via,
      ...(method ? { method, confirmedBy: str(r.confirmedBy) || undefined } : {}),
    });
  }
  return dedupeAnswers([...out, ...derived]);
}

/** One answer per locus per person: an operator who ALSO filed the row explicitly
 *  has not made the stakeholder say it twice, and the burn-down must not move by
 *  two for one reply. First wins — the explicit row is listed first, so a caller
 *  who stated the answer outright keeps their own wording. */
function dedupeAnswers(rows: readonly StakeholderAnswer[]): StakeholderAnswer[] {
  const seen = new Set<string>();
  const out: StakeholderAnswer[] = [];
  for (const r of rows) {
    const key = `${r.about}\u0000${r.saidByName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Mint the closing claims — one per answer that has an OPEN claim to answer.
 *
 * Deliberately silent on everything else. An answer to a locus that is already
 * settled, or that never existed, closes nothing: this is the read side of "a miss
 * stays visible" — the answer is still on the record and still shown as what the
 * person said, it simply does not get to rewrite a claim it does not match. Callers
 * that want to report the drop can diff the returned batch against the input.
 */
export function stakeholderAnswerClaims(
  store: LedgerStore,
  answers: readonly StakeholderAnswer[],
  /** The operator's routing, so the closure is credited to the band that was actually
   *  waiting. Without it the answer lands on the DERIVED owner and the heard register
   *  credits a band nobody had routed the question to — caught by the guard, which
   *  asserts the band and not just the total. */
  fold?: Map<string, LocusOwnership>,
): AssertInput[] {
  const batch: AssertInput[] = [];
  for (const a of answers) {
    // MIRROR, DO NOT GUESS. The open claim carries the world/layer/owner this locus
    // lives in; asserting into the wrong world makes a contradiction, not an answer.
    const open = store.liveClaimsAbout(a.about)
      .filter((c) => isLive(c) && (c.status === "open" || c.status === "blocked"))[0];
    if (!open) continue;
    // ONE definition of "who owns this open locus after the operator's routing" —
    // `applyOwnership`, run over the single claim rather than restated here.
    const owned = fold?.size ? applyOwnership([open], fold)[0] : open;
    batch.push({
      about: a.about,
      value: { kind: "scalar", value: a.answer },
      world: open.world,
      layer: open.layer,
      ownerWhileOpen: owned.ownerWhileOpen,
      source: "asserted",
      status: "closed",
      closedBy: {
        method: a.method ?? "assertion",
        by: a.saidByName,
        verbatim: a.answer,
        ...(a.at ? { at: a.at } : {}),
        note: a.method === "transcript"
          ? `said in a review (${a.via}), confirmed by ${a.confirmedBy || "an operator"}${a.saidByRole ? ` — ${a.saidByRole}` : ""}`
          : `answered on their own link (${a.via})${a.saidByRole ? ` — ${a.saidByRole}` : ""}`,
      },
      ...(a.at ? { createdAt: a.at } : {}),
    });
  }
  return batch;
}

/** Append answers to what the record already holds, for the write half. Pure: returns
 *  the field's next value, and the caller commits it through the one write path. */
export function appendStakeholderAnswers(
  program: ProgramSummary | null | undefined,
  added: readonly StakeholderAnswer[],
): string {
  return JSON.stringify([...readStakeholderAnswers(program), ...added]);
}
