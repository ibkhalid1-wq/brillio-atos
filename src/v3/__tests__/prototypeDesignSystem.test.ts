/**
 * Meridian design system — invariants that keep the codified system, its exported
 * copy, and the reference page in lockstep, and keep it engagement-neutral.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  MERIDIAN_TOKENS, resolveTheme, meridianStylesheet, meridianRootVars,
} from "@shared/prototypeDesignSystem.ts";

describe("Meridian design system", () => {
  it("resolveTheme fills every gap from the defaults", () => {
    const sparse = resolveTheme({ brand: "#123456" });
    expect(sparse.brand).toBe("#123456");        // override honoured
    expect(sparse.ink).toBe(MERIDIAN_TOKENS.ink); // gap filled
    expect(sparse.radius).toBe(MERIDIAN_TOKENS.radius);
    // blank strings are treated as absent, not as an empty override
    expect(resolveTheme({ brand: "" }).brand).toBe(MERIDIAN_TOKENS.brand);
    // a null theme yields a complete set
    expect(Object.values(resolveTheme(null)).every((v) => v !== "" && v != null)).toBe(true);
  });

  it("radius drives the whole radii scale", () => {
    expect(meridianRootVars({ radius: 20 })).toContain("--m-r-md:20px");
    expect(meridianRootVars({ radius: 20 })).toContain("--m-r-lg:22px");
  });

  it("is engagement-neutral — no source app / client name leaks into the CSS", () => {
    const css = meridianStylesheet().toLowerCase();
    for (const forbidden of ["laila", "brillio", "\\.l-", "--l-"]) {
      expect(css).not.toMatch(new RegExp(forbidden));
    }
    // every class is either a Meridian component (`m-`) or a state modifier (`is-`)
    const classes = [...meridianStylesheet().matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]);
    expect(classes.length).toBeGreaterThan(20);
    expect(classes.every((c) => c.startsWith("m-") || c.startsWith("is-"))).toBe(true);
  });

  it("the reference page is generated from the module (no drift)", () => {
    const p = resolve(__dirname, "../../../public/prototype-design-system.html");
    expect(existsSync(p), "run scripts/build-ds-demo.mjs").toBe(true);
    const html = readFileSync(p, "utf8");
    // the page embeds the module's stylesheet verbatim
    expect(html).toContain(meridianStylesheet());
    // and exercises the core patterns
    for (const cls of ["m-app", "m-side", "m-nav-item", "m-table", "m-btn--primary", "m-pill--risk", "m-field"]) {
      expect(html).toContain(cls);
    }
  });
});
