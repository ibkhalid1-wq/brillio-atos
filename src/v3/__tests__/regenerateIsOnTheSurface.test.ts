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

describe("every surface that opens an artifact wires the act", () => {
  /**
   * The button is only as real as the handler behind it. `FlowArtifactStudio` draws
   * nothing without `onRegenerate`, and the Library's mount passed none — so the
   * fix above was invisible on that surface, and a STALE document there showed the
   * "claims moved" band with nothing to press.
   *
   * This is a source guard because the two mounts are what it is about: a DOM test
   * would prove one of them and say nothing about the other appearing later.
   */
  const mounts = ["TheLine.tsx", "FlowShell.tsx"].map((f) => ({
    file: f,
    src: readFileSync(resolve(__dirname, `../components/flow/${f}`), "utf8"),
  }));

  it.each(mounts)("$file passes onRegenerate to the artifact studio", ({ src: text }) => {
    const at = text.indexOf("<FlowArtifactStudio");
    expect(at, "this file no longer mounts the artifact studio — move or drop this guard").toBeGreaterThan(-1);
    const mount = text.slice(at, text.indexOf("/>", at));
    expect(mount, "an artifact opens here with no way to rebuild it").toContain("onRegenerate=");
    expect(mount, "…and nothing tells the header a rebuild is already out").toContain("regenerating=");
  });

  it("both take the dispatch from one definition, not a second copy", () => {
    // MUTATION: paste the busy-tracking back into either file → RED. Two copies of
    // "is it back yet" is two answers to it, and the flag is the part that was
    // wrong before (a write-only latch reading "Generating…" for ever).
    for (const { file, src: text } of mounts) {
      expect(text, `${file} does not use the shared regen hook`).toContain("useArtifactRegen(");
      expect(text, `${file} keeps its own in-flight bookkeeping`).not.toContain("setRegenBusy");
    }
  });
});

describe("the regenerate control on a generated document", () => {
  it("renders on the header whenever the document can be regenerated", () => {
    // MUTATION: restore `onRegenerate && (!artifact.present || artifact.stale || regenerating)` → RED.
    expect(headerCta).toContain("{onRegenerate ? (");
    expect(headerCta).toContain("v3fs-btn-regen");
  });

  it("is not gated on staleness — the fingerprint is not the only reason to rebuild", () => {
    // The whole defect in one assertion, and it is about the GATE, not the label:
    // staleness may choose the WORD on the button (see below), but it must never
    // decide whether the button exists, or a current document offers nothing again.
    const gate = headerCta.slice(headerCta.indexOf("{onRegenerate"), headerCta.indexOf("<button", headerCta.indexOf("{onRegenerate")));
    expect(gate, "the header regenerate is conditioned on staleness again").not.toContain("artifact.stale");
  });

  it("names the act for the state the document is in", () => {
    // Three states, three words: nothing to replace yet (Generate), claims moved
    // (Rebuild in full — the honest name, because it does NOT merge hand
    // corrections), and everything else (Regenerate).
    expect(headerCta).toContain('!artifact.present ? "Generate"');
    expect(headerCta).toContain('artifact.stale ? "Rebuild in full" : "Regenerate"');
    // …and the glyph is decoration, not part of the name a screen reader reads.
    expect(headerCta).toContain('<span aria-hidden="true">{artifact.present ? "↻ " : "✦ "}</span>');
  });

  it("is the only control for that act on the screen", () => {
    // The stale band used to carry its own "Rebuild in full" button while the
    // header showed "Regenerate" — two names, one act, two inches apart. The band
    // keeps the explanation; it must not grow the button back.
    const from = src.indexOf('<div className="v3fs-dv-band amber">');
    const band = src.slice(from, src.indexOf("</div>", from)).replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(from, "the stale band is gone").toBeGreaterThan(-1);
    expect(band, "the stale band has a second regenerate button again").not.toMatch(/<button/);
    // …and it still says what a full rebuild costs, which is the only place that does.
    expect(band).toContain("targeted update of just the affected sections");
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
