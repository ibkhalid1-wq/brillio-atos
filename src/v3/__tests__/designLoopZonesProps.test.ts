/**
 * NO DEAD AFFORDANCE ON THE DESIGN LOOP.
 *
 * `DesignLoopZones` declared an optional `onQuestion` handler and drew a
 * "? question → {role}" button whenever it was supplied. TheLine — its ONLY caller —
 * never supplied it, so the button could not be reached in the running app: every render
 * fell to the `: <span className="v3dl-question-note">` branch. A reader of the component
 * saw a verb the product does not have, and a reader of the tests saw a prop with a type.
 *
 * It was removed rather than wired, because wiring it would have been a lie of a
 * different kind. The person who QUESTIONS an operator decision is the stakeholder, and
 * the stakeholder is not standing at this surface — this is the operator's own board.
 * The capture lives on the stakeholder's link (FlowRespond), and routing a proposal from
 * here would need a ledger write the read-only in-browser migrate does not have. So the
 * tile states the routing as a FACT ("questionable → routes to {role}"), which is true,
 * instead of offering an action the surface cannot perform.
 *
 * The guard below is general, not a grep for one name: EVERY handler prop the component
 * declares must be passed by its caller. That is the invariant `onQuestion` broke, and
 * it fails the moment another one is declared and left unwired.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const V3 = resolve(__dirname, "..");
const src = (rel: string) => readFileSync(resolve(V3, rel), "utf8");
const ZONES = src("components/flow/DesignLoopZones.tsx");
const THE_LINE = src("components/flow/TheLine.tsx");

/** Comments are prose, and prose names props it is explaining. Strip them first so the
 *  scan reads DECLARATIONS, and the doc-comment above `interface Props` (which names
 *  `onQuestion` on purpose) cannot resurrect the very prop it is recording as gone. */
const uncommented = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** The `on*` props `DesignLoopZones` declares, optional or not. */
const declaredHandlers = (): string[] => {
  const m = /\binterface Props \{([\s\S]*?)\n\}/.exec(uncommented(ZONES));
  if (!m) throw new Error("DesignLoopZones no longer declares `interface Props`");
  return [...m[1].matchAll(/^\s*(on[A-Z]\w*)\??\s*:/gm)].map((x) => x[1]);
};

/** The props TheLine actually hands it, read off the JSX element. */
const passedHandlers = (): string[] => {
  const m = /<DesignLoopZones\b([\s\S]*?)\/>/.exec(uncommented(THE_LINE));
  if (!m) throw new Error("TheLine no longer renders <DesignLoopZones … />");
  return [...m[1].matchAll(/\b(on[A-Z]\w*)=/g)].map((x) => x[1]);
};

/** Every non-test module under src/v3 that imports the component. */
const importers = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      const abs = resolve(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(abs, r); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      if (readFileSync(abs, "utf8").includes('from "@/v3/components/flow/DesignLoopZones"')) out.push(r);
    }
  };
  walk(V3, "");
  return out.sort();
};

describe("DesignLoopZones declares no handler its caller does not pass", () => {
  it("TheLine is the ONLY caller — so 'unpassed' really does mean 'unreachable'", () => {
    expect(importers()).toEqual(["components/flow/TheLine.tsx"]);
  });

  it("every `on*` prop it declares is supplied at the call site", () => {
    const declared = declaredHandlers();
    const passed = passedHandlers();
    expect(declared.length, "the scan found no props at all — the regex has drifted").toBeGreaterThan(0);
    const unwired = declared.filter((p) => !passed.includes(p));
    expect(
      unwired,
      `DesignLoopZones declares ${unwired.join(", ")} and TheLine never passes it — the affordance behind it cannot be reached in the running app. Wire it or delete it.`,
    ).toEqual([]);
  });

  it("`onQuestion` in particular is gone, along with the button and the CSS that dressed it", () => {
    // Named because it is the one this test was written for; the general guard above is
    // what keeps the next one out.
    expect(declaredHandlers()).not.toContain("onQuestion");
    expect(uncommented(ZONES)).not.toContain("onQuestion");
    expect(uncommented(ZONES)).not.toMatch(/aria-label=\{`Question the /);
    expect(src("components/flow/theLine.css")).not.toContain(".v3dl-mini.ghost{");
  });

  it("the tile still SAYS where a question routes — the fact survived the verb", () => {
    // Removing the button must not remove the information. The note is unconditional now.
    expect(ZONES).toContain('<span className="v3dl-question-note">questionable');
    expect(ZONES).toContain("routes to {role}");
    expect(src("components/flow/theLine.css")).toContain(".v3dl-question-note{");
  });
});
