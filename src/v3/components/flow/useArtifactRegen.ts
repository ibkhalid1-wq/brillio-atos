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
 * than a copied five lines. `onRunAgent` is fire-and-forget: nothing resolves, so a
 * naive boolean is a write-only latch that reads "Generating…" for ever. The flag
 * stores the document AS IT WAS at dispatch and clears when that document CHANGES,
 * which is the only observable event meaning the run came back. A run that returns a
 * byte-identical document leaves the flag set until the next change — the honest
 * failure mode, quiet rather than wrong.
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
): ArtifactRegen {
  const [busy, setBusy] = useState<Record<string, string>>({});

  useEffect(() => {
    setBusy((current) => {
      const ids = Object.keys(current);
      if (!ids.length) return current;
      const landed = ids.filter((id) => (artifactDocument(program, id) ?? "") !== current[id]);
      if (!landed.length) return current;
      const next = { ...current };
      for (const id of landed) delete next[id];
      return next;
    });
  }, [program]);

  return {
    regenerate: onRunAgent
      ? (card: ArtifactCardModel) => {
          // Latch FIRST, so the tile answers the click immediately — a rebuild that
          // waits for the whole agent run before acknowledging is a dead button.
          setBusy((s) => ({ ...s, [card.id]: artifactDocument(program, card.id) ?? "" }));
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
