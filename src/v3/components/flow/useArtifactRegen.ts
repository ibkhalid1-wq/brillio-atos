/**
 * REGENERATION, IN ONE PLACE — dispatch and "is it back yet", for every surface that
 * shows an artifact.
 *
 * This lived inside TheLine, so only the Work board could offer it. Opening the SAME
 * document from the Library gave a header with ⋯ and Close, and — on a stale one — a
 * band that says the claims it rests on moved with no button under it, because that
 * mount passed no `onRegenerate`. The only offer was a link to a different page.
 *
 * The subtle half is the in-flight flag, and it is the reason this is a hook rather
 * than a copied five lines. It clears on THREE signals, in order of authority:
 * the dispatch was refused (nothing started), the agent left the backend's running
 * set (it finished), or the document changed (it finished and produced something).
 *
 * It used to clear on the last of those alone, and that was wrong in the ordinary
 * case: a successful regeneration over a stable ontology emits a byte-identical
 * document, so the tile said "rebuilding…" for ever while the run table read
 * `complete`. See the effect below.
 */
import { useEffect, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { artifactDocument, type ArtifactCardModel } from "@/v3/components/flow/flowShellData";

export interface ArtifactRegen {
  /** Dispatch a rebuild. Undefined when the surface has no agent runner — which is
   *  what every caller must gate its button on, so a control is never drawn over a
   *  handler that cannot run. */
  regenerate?: (card: ArtifactCardModel) => void;
  /** Is this artifact's rebuild still out? */
  regenerating: (artifactId: string) => boolean;
  /** The same answer as a set of ids, for children that take a map rather than ask.
   *  The document snapshot behind it stays in here — it is bookkeeping for knowing
   *  when a run came back, not something a child should have to know. */
  regeneratingIds: string[];
}

export function useArtifactRegen(
  program: ProgramSummary,
  onRunAgent?: (agentId: string, phaseId?: string) => void | Promise<boolean | void>,
  /** The surface's own way of saying what just happened — a board toast, a row
   *  note, or nothing. The hook never renders. */
  say?: (message: string) => void,
  /** Agent ids the backend reports as running. THE primary clear signal — see the
   *  effect below. Optional: without it the hook falls back to document-change
   *  detection alone, which is what it did before and what was not enough. */
  runningAgentIds?: ReadonlySet<string>,
): ArtifactRegen {
  /** doc = the document as it was at dispatch; seen = we have observed this agent in
   *  the backend's running set, so its DISAPPEARANCE means it finished. */
  const [busy, setBusy] = useState<Record<string, { doc: string; seen: boolean }>>({});

  /**
   * A RUN THAT FINISHES CLEARS THE LATCH — even when it changed nothing.
   *
   * This used to clear on one signal only: the artifact's document CHANGING. That is
   * true of a regeneration that produces new content and false of one that does not,
   * and "does not" is the common case on a stable ontology — the agent runs, succeeds,
   * and emits a byte-identical document. The tile then said "rebuilding…" for ever.
   * Reported three times (Architecture Strategy, Experience Design, Agentify); the run
   * table showed every one of them `complete` with no error while the board still
   * claimed they were building. I had written the old behaviour up as "the honest
   * failure mode, quiet rather than wrong". It was neither.
   *
   * So completion is the primary signal, and it is already on the client:
   * `runningAgentIds` comes from `adam_agent_runs`. The `seen` flag is what makes it
   * safe — an agent is not in that set for the moment between dispatch and the backend
   * registering it, so we only treat ABSENCE as completion once we have seen PRESENCE.
   * Document change stays as a secondary, for a run so fast the client never observed
   * it running.
   */
  useEffect(() => {
    setBusy((current) => {
      const ids = Object.keys(current);
      if (!ids.length) return current;
      const next = { ...current };
      let touched = false;
      for (const id of ids) {
        const st = current[id];
        const running = runningAgentIds?.has(id) ?? false;
        if (running && !st.seen) { next[id] = { ...st, seen: true }; touched = true; continue; }
        if (!running && st.seen) { delete next[id]; touched = true; continue; }   // finished
        if ((artifactDocument(program, id) ?? "") !== st.doc) { delete next[id]; touched = true; }
      }
      return touched ? next : current;
    });
  }, [program, runningAgentIds]);

  return {
    regenerate: onRunAgent
      ? (card: ArtifactCardModel) => {
          // Latch FIRST, so the tile answers the click immediately — a rebuild that
          // waits for the whole agent run before acknowledging is a dead button.
          setBusy((s) => ({ ...s, [card.id]: { doc: artifactDocument(program, card.id) ?? "", seen: false } }));
          say?.(`Regenerating ${card.title} from the record — it refreshes when it lands.`);
          // …and UNLATCH if the dispatch was refused. `onRunAgent` resolves false when
          // a guard turned it away (not signed in, read-only, AI not connected). It
          // used to return bare, so a refusal looked exactly like a live run: nothing
          // dispatched, so no document ever changed, so this flag never cleared and
          // the tile read "rebuilding…" for ever over a six-second toast. Reported as
          // three Design Loop cards stuck that way.
          void Promise.resolve(onRunAgent(card.id, card.movementId)).then((dispatched) => {
            if (dispatched !== false) return;
            setBusy((s) => { if (!(card.id in s)) return s; const next = { ...s }; delete next[card.id]; return next; });
            say?.(`${card.title} was not sent — nothing is rebuilding. See the message above for why.`);
          }).catch(() => {
            // The dispatch threw. Same rule: do not leave a tile claiming progress.
            setBusy((s) => { if (!(card.id in s)) return s; const next = { ...s }; delete next[card.id]; return next; });
            say?.(`${card.title} was not sent — the request failed before it started.`);
          });
        }
      : undefined,
    regenerating: (artifactId: string) => artifactId in busy,
    regeneratingIds: Object.keys(busy),
  };
}
