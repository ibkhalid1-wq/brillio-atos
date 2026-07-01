/**
 * Grid auto-save safety net.
 *
 * The phase-inputs buffer initialises from persisted data, but there is a brief
 * window on remount / when an external write lands where a local grid buffer can
 * be empty ("[]") while the persisted value already holds rows. If the debounced
 * auto-save (or the leave-phase flush) fires in that window it would serialize the
 * empty buffer over real data — the class of clobber behind the ATOS design-
 * decision-row loss.
 *
 * This guard restores the persisted value for any grid field the user has NOT
 * interacted with, so an empty grid write can only happen as a deliberate clear
 * (which marks the field touched). It is a pure function over the outgoing save
 * payload and the persisted inputs, so it is trivially testable and side-effect
 * free — it never blocks a legitimate edit, only a phantom erase.
 */

/** True when a serialized grid value carries no rows (absent / "" / "[]"). */
function isEmptyGridValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "[]";
}

/**
 * Return an outgoing save payload with any *untouched* grid field that would be
 * written empty replaced by its non-empty persisted value. Fields the user has
 * touched (edited, cleared, or adopted a draft into) are left exactly as the
 * buffer has them, so real edits — including intentional clears — always persist.
 *
 * Returns the original object reference when nothing needs protecting, so callers
 * can cheaply detect a no-op.
 */
export function preserveUntouchedGrids(
  outgoing: Record<string, string>,
  persisted: Record<string, unknown>,
  gridFieldIds: Iterable<string>,
  touched: ReadonlySet<string>,
): Record<string, string> {
  let next: Record<string, string> | null = null;
  for (const id of gridFieldIds) {
    if (touched.has(id)) continue; // user interacted — never override their intent
    if (!isEmptyGridValue(outgoing[id])) continue; // buffer has rows — keep them
    const prev = persisted[id];
    if (typeof prev !== "string" || isEmptyGridValue(prev)) continue; // nothing to protect
    if (!next) next = { ...outgoing };
    next[id] = prev;
  }
  return next ?? outgoing;
}
