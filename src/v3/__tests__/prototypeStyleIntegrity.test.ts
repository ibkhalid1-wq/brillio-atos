/**
 * THE SHEET HAS TO PARSE — the gate the Laila New 2 build proved necessary.
 *
 * On 2026-08-16 a stylesheet-mode restyle shipped with ONE unclosed `var(`
 * (`margin-bottom:var(--m-sp-6}`). CSS error recovery cannot cross an
 * unbalanced bracket, so the browser parsed 19 of the sheet's 158 rules: every
 * chip, badge, table treatment and @media query — ~80% of the design system —
 * was silently dead, while the structural post-condition reported PASS because
 * every id, screen and seeded value was intact. Worse, `baselineWithPriorSkin`
 * then re-adopted the stored sheet as "the skin already approved" on every
 * subsequent round, so one typo poisoned every later build including full
 * regenerations.
 *
 * Three hooks close the class, and each is proven here:
 *   1. `checkStylesheetSyntax` — the delimiter scanner itself.
 *   2. `checkRefinedPrototype` folds it in, so a refined document OR a spliced
 *      restyle with a broken sheet takes the existing reject path.
 *   3. `baselineWithPriorSkin` refuses to adopt a prior skin that fails it.
 *
 * And the contract that makes the class unreachable going forward:
 *   4. `styleTokens` — the model returns token VALUES, slot-checked, and the
 *      deterministic sheet is rebuilt around them. Syntax holds by construction.
 */
import { describe, expect, it } from "vitest";
import {
  baselineWithPriorSkin, checkRefinedPrototype, checkStylesheetSyntax,
  prototypeBaselineFor, resolvePrototypeDoc, stylesheetIn, withStylesheet,
} from "@shared/prototypeRefine.ts";
import { meridianStylesheet } from "@shared/prototypeDesignSystem.ts";

const ontology = {
  entities: [
    { name: "Account", attributes: ["id", "name", "region"] },
    { name: "Lead", attributes: ["id", "name", "status", "accountId"] },
  ],
  relations: [{ from: "Account", to: "Lead", cardinality: "1:N" }],
};
const atlas = { workflows: [{ name: "Qualify", owner: "Sales", steps: [{ action: "Score the lead", entities: ["Lead"] }] }] };

const baseline = () => prototypeBaselineFor(ontology, atlas)!;

describe("§1 the scanner — checkStylesheetSyntax", () => {
  it("catches the exact Laila New 2 breach: an unclosed var(", () => {
    const broken = ".m-page-h{display:flex;margin-bottom:var(--m-sp-6}.m-title{font-size:32px}";
    const v = checkStylesheetSyntax(broken);
    expect(v).toHaveLength(1);
    // The `}` lands while `var(` is still open — reported as the mismatch it is,
    // with enough context to find it.
    expect(v[0]).toMatch(/mismatched '\}'/);
    expect(v[0]).toMatch(/var\(--m-sp-6/);
  });

  it("catches an unterminated comment and an unterminated string", () => {
    expect(checkStylesheetSyntax(".a{color:red}/* the rest of the sheet")[0]).toMatch(/unterminated comment/);
    expect(checkStylesheetSyntax('.a{content:"unclosed}')[0]).toMatch(/unterminated double-quoted string/);
  });

  it("catches a mismatched closer", () => {
    expect(checkStylesheetSyntax(".a{color:red)}")[0]).toMatch(/mismatched '\)'/);
  });

  it("passes the design system's own sheet, brackets in strings, and empty input", () => {
    expect(checkStylesheetSyntax(meridianStylesheet())).toEqual([]);
    expect(checkStylesheetSyntax('.a::before{content:"}"}.b{background:url(x.svg)}')).toEqual([]);
    expect(checkStylesheetSyntax("")).toEqual([]);
  });
});

describe("§2 the post-condition folds it in", () => {
  it("a restyle whose sheet cannot parse is REJECTED and the assembled build stands", () => {
    const b = baseline();
    const brokenCss = b.stylesheet.replace("box-sizing:border-box", "box-sizing:var(--never-closed");
    expect(checkStylesheetSyntax(brokenCss).length, "fixture must actually be broken").toBe(1);
    const { doc, source } = resolvePrototypeDoc({ styleCss: brokenCss }, b);
    expect(source).toBe("assembled");
    expect(String(doc.html)).toBe(b.html);
    const gaps = (doc.gaps as string[]).join(" ");
    expect(gaps).toMatch(/stylesheet was NOT applied/);
    expect(gaps).toMatch(/unclosed '\('|mismatched/);
  });

  it("a refined DOCUMENT with a broken sheet is rejected by the same check", () => {
    const b = baseline();
    const brokenDoc = withStylesheet(b.html, b.stylesheet + "\n.m-late{margin:var(--m-sp-4}");
    const verdict = checkRefinedPrototype(b, brokenDoc);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.join(" ")).toMatch(/unclosed '\('|mismatched '\}'/);
  });
});

describe("§3 a broken prior skin is not re-adopted", () => {
  it("the poisoned-carry regression: a stored build with a broken sheet no longer re-skins the baseline", () => {
    const b = baseline();
    const poisoned = withStylesheet(b.html, b.stylesheet.replace("box-sizing:border-box", "box-sizing:var(--x"));
    const carried = baselineWithPriorSkin(b, poisoned);
    // Same ids, so before the guard this WOULD have been adopted.
    expect(carried.stylesheet).toBe(b.stylesheet);
    expect(checkStylesheetSyntax(stylesheetIn(carried.html))).toEqual([]);
  });

  it("a healthy prior skin is still carried — the loop must keep accumulating", () => {
    const b = baseline();
    const reskinned = withStylesheet(b.html, b.stylesheet + "\n.m-extra{color:#123456}");
    const carried = baselineWithPriorSkin(b, reskinned);
    expect(carried.stylesheet).toContain(".m-extra");
  });
});

describe("§4 styleTokens — judgement in, CSS out", () => {
  it("a valid token patch re-skins the governed sheet: correct by construction, stored as restyled", () => {
    const b = baseline();
    const { doc, source, verdict } = resolvePrototypeDoc({ styleTokens: { brand: "#0b3d2e", radius: 6 } }, b);
    expect(source).toBe("restyled");
    expect(verdict?.ok).toBe(true);
    const css = stylesheetIn(String(doc.html));
    expect(css).toContain("--m-brand:#0b3d2e");
    expect(css).toContain("--m-r-md:6px");
    expect(checkStylesheetSyntax(css)).toEqual([]);
    // Consumed, never persisted — same discipline as styleCss.
    expect("styleTokens" in doc).toBe(false);
  });

  it("a value that does not fit its slot is refused BY NAME, and the rest still apply", () => {
    const b = baseline();
    const { doc, source } = resolvePrototypeDoc(
      { styleTokens: { brand: "#0b3d2e", bg: "}body{display:none}", nonsense: "#fff" } }, b,
    );
    expect(source).toBe("restyled");
    const css = stylesheetIn(String(doc.html));
    expect(css).toContain("--m-brand:#0b3d2e");
    // The hostile value never reaches the sheet — the bg slot keeps its default.
    expect(css).not.toContain("}body{display:none}");
    expect(css).toMatch(/--m-bg:#f4f3f7/);
    const gaps = (doc.gaps as string[]).join(" ");
    expect(gaps).toMatch(/2 style tokens were refused \(bg, nonsense\)/);
  });

  it("tokens outrank a legacy styleCss when both arrive — the safe contract wins", () => {
    const b = baseline();
    const { doc, source } = resolvePrototypeDoc(
      { styleTokens: { brand: "#112233" }, styleCss: b.stylesheet + "\n.m-x{color:red}" }, b,
    );
    expect(source).toBe("restyled");
    expect(stylesheetIn(String(doc.html))).toContain("--m-brand:#112233");
    expect(stylesheetIn(String(doc.html))).not.toContain(".m-x");
  });
});
