/**
 * Name display helper ONLY. Question TEXT comes from exactly one place —
 * `renderQuestion.ts` (locus + kind → deterministic template, full data at render
 * time, no truncation). This module deliberately contains no question templates:
 * a second producer is how the kit, the queue, and the linked page drift apart.
 */

/** A readable display name for the element, from its stored name; falls back to a
 *  de-slugged id tail so a person still sees words, never a raw address. */
export function readableName(rawName: string | undefined, elementId: string): string {
  const name = (rawName ?? "").trim();
  if (name) return name;
  const tail = elementId.replace(/^el:/, "").split(":").pop() ?? elementId;
  return tail.replace(/[.#_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
}
