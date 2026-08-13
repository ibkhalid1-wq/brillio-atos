/**
 * REGENERATE IS A HEADER ACTION, NOT A MENU ITEM.
 *
 * Reported as "currently regenerate is hidden under the menu". The header button was
 * gated on `!artifact.present || artifact.stale || regenerating`, on the reasoning
 * that a current document needs no rebuild — and the same verb was then repeated as
 * a ⋯ menu item, gated on the exact opposite (`!artifact.stale`). So the ONE case
 * where an operator has to go looking for it (the document is fine by the
 * fingerprint, but the prompt changed, or the generation was poor) was the one case
 * it was hidden in.
 *
 * The staleness flag tracks the inputs FINGERPRINT. Every reason to rebuild that a
 * hash cannot see was unreachable from the surface.
 *
 * These are source-level on purpose: `artifact.stale` is the condition under test, so
 * a DOM check would have to mount both states to say anything the grep does not, and
 * the property that matters is "the header gate does not mention staleness at all".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../components/flow/studio/FlowArtifactStudio.tsx"), "utf8");

/** The header CTA block: from the opening of the CTA div to the ⋯ menu wrapper. */
const headerCta = (() => {
  const from = src.indexOf('<div className="v3fs-docview-cta">');
  const to = src.indexOf('v3fs-dv-menuwrap', from);
  expect(from, "the artifact header's CTA block is gone").toBeGreaterThan(-1);
  expect(to, "the ⋯ menu wrapper is gone — this slice no longer means what it says").toBeGreaterThan(from);
  return src.slice(from, to);
})();

/** The ⋯ overflow menu block, with its JSX comments stripped — a comment ABOUT
 *  regenerate is not a menu item offering it. */
const overflowMenu = (() => {
  const from = src.indexOf('<div className="v3fs-dv-menu" role="menu">');
  const to = src.indexOf("</div>", src.lastIndexOf('role="menuitem"'));
  expect(from, "the ⋯ menu is gone").toBeGreaterThan(-1);
  return src.slice(from, to).replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
})();

describe("the regenerate control on a generated document", () => {
  it("renders on the header whenever the document can be regenerated", () => {
    // MUTATION: restore `onRegenerate && (!artifact.present || artifact.stale || regenerating)` → RED.
    expect(headerCta).toContain("{onRegenerate ? (");
    expect(headerCta).toContain("v3fs-btn-regen");
  });

  it("is not gated on staleness — the fingerprint is not the only reason to rebuild", () => {
    // The whole defect in one assertion: the header's gate must not consult the
    // stale flag, or a current document goes back to offering nothing.
    expect(headerCta, "the header regenerate is conditioned on staleness again")
      .not.toContain("artifact.stale");
  });

  it("still names the act correctly for a document that does not exist yet", () => {
    // Generate and Regenerate are the same control and must not become the same
    // WORD: one creates, the other replaces.
    expect(headerCta).toContain("artifact.present ? \"↻ Regenerate\" : \"✦ Generate\"");
  });

  it("is not duplicated inside the ⋯ menu", () => {
    // MUTATION: put the menu item back → RED. Two controls for one verb, each
    // showing in the state the other hides in, is how it got lost.
    expect(overflowMenu, "the overflow menu carries a second copy of Regenerate")
      .not.toMatch(/Regenerate/);
    // …and the menu is not left empty: it still holds what has nowhere else to go.
    expect(overflowMenu).toContain("Export · print or PDF");
  });
});
