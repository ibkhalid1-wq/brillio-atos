/**
 * GAP 1 — A ROUND LINK FOR A NAMED PERSON SHIPPED NO DEMO SCRIPT.
 *
 * Found on a live Design Review Round. `flow-portal`'s `scriptSlice()` and
 * `recipientAreaSlice()` matched a programme's demo scripts to the recipient by
 * `pack.stakeholder` — the person's NAME. But `demoScripts.scripts[]` are filed
 * under whatever the generator wrote: on Laila CRM they are "Sales reps -
 * Markets" and "Leader - Marketing", i.e. ROLES. A round minted for the named
 * person "Ibrahim Khalid" therefore matched nothing, and the review page
 * rendered with no script and no explanation: the stakeholder was asked to
 * approve a design and shown none of the walkthrough written for them.
 *
 * What is pinned here:
 *   1. the match resolves on NAME first and ROLE second, and a role match is
 *      EXACT on the normalised key — this repo has already shipped a fuzzy match
 *      that read "Surgical Operations" as Sales Ops, and handing one person
 *      another person's walkthrough is the same failure wearing a demo's face;
 *   2. `recipientAreaSlice()` resolves through the SAME match — it had the same
 *      hole, and an area scoped off a script the recipient never matched is a
 *      second silent no-op;
 *   3. when nothing matches the page SAYS SO. A stakeholder looking at an empty
 *      space cannot tell "nobody wrote me a walkthrough" from "this page is
 *      broken", and they are being asked to approve what they can see.
 *
 * The edge is Deno and cannot be imported, so the matching block is TRANSPILED
 * OUT OF ITS OWN SOURCE and executed here — the `edgeLockstep` idiom. The
 * functions under test are the deployed ones, character for character.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { stripUnnamedSuffix } from "@shared/unnamedSuffix";
import { DesignRoundReviewSurface } from "@/v3/components/flow/FlowReviewSurface";

const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/flow-portal/index.ts"), "utf8");

/** Cut a named span out of the edge source. Fails loudly rather than silently
 *  testing an empty string if the anchors ever move. */
function span(from: string, to: string): string {
  const a = EDGE.indexOf(from);
  const b = EDGE.indexOf(to, a + 1);
  expect(a, `edge anchor not found: ${from}`).toBeGreaterThan(-1);
  expect(b, `edge anchor not found: ${to}`).toBeGreaterThan(a);
  return EDGE.slice(a, b);
}

interface Slices {
  holderRole: string;
  scriptMatch: () => { entry: Record<string, unknown>; by: "name" | "role" } | null;
  scriptSlice: () => Record<string, unknown> | undefined;
  scriptGapSlice: () => string;
  recipientAreaSlice: () => string;
}

/** The deployed matching block, run over a `hit` we control. */
const slicesFor: (hit: unknown) => Slices = (() => {
  const keys = span("const cmpKey = ", "// The INTERPRETIVE PROTOTYPE slice");
  const match = span("const scriptMatch = ", "// The prototype the pilot validates is EITHER");
  const js = ts.transpileModule(
    `const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
     function slicesFor(hit) {
       ${keys}
       ${match}
       return { holderRole, scriptMatch, scriptSlice, scriptGapSlice, recipientAreaSlice };
     }
     return { slicesFor };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } },
  ).outputText;
  const build = new Function("stripUnnamedSuffix", js) as (s: unknown) => { slicesFor: (hit: unknown) => Slices };
  return build(stripUnnamedSuffix).slicesFor;
})();

/** A demo script as the generator writes it. */
const script = (over: Record<string, unknown>) => ({
  stakeholder: "", role: "", area: "", openingQuote: "", scenario: "",
  acceptanceAsk: "", steps: [], ...over,
});

/** A served link: who holds it, what the pack says their role is, who the kit
 *  roster says they are, and what scripts the programme has. */
const hitFor = (over: {
  stakeholder?: string; role?: string; recipientArea?: string;
  roster?: Array<{ stakeholder: string; role: string }>;
  scripts?: Array<Record<string, unknown>> | null;
}) => ({
  pack: {
    stakeholder: over.stakeholder ?? "Ibrahim Khalid",
    // A DESIGN-ROUND link stores the review KIND here, never a business role —
    // which is precisely why the name was the only key the old code had.
    role: over.role ?? "review:design-round",
    ...(over.recipientArea ? { recipientArea: over.recipientArea } : {}),
  },
  inner: {
    discoveryKit: { interviews: over.roster ?? [{ stakeholder: "Ibrahim Khalid", role: "Sales reps - Markets" }] },
    ...(over.scripts === null ? {} : { demoScripts: { scripts: over.scripts ?? [] } }),
  },
});

/** The Laila CRM shape: every script filed under a ROLE. */
const LAILA_SCRIPTS = [
  script({ stakeholder: "Leader - Marketing", area: "Marketing", openingQuote: "Campaign spend is a black box." }),
  script({ stakeholder: "Sales reps - Markets", area: "Sales", openingQuote: "Quotes take a week.", acceptanceAsk: "Do you approve this?" }),
];

describe("the recipient's ROLE resolves their demo script, not just their name", () => {
  it("REGRESSION: a script filed under a ROLE reaches the person the round asked", () => {
    const s = slicesFor(hitFor({ stakeholder: "Ibrahim Khalid", scripts: LAILA_SCRIPTS }));
    expect(s.holderRole, "the round link's role is the review kind — the roster holds the real one")
      .toBe("Sales reps - Markets");
    const out = s.scriptSlice();
    expect(out, "a named person matched no role-filed script — the live bug").toBeTruthy();
    expect(out!.openingQuote).toBe("Quotes take a week.");
    expect(out!.matchedBy).toBe("role");
  });

  it("a NAME match still wins — it is the more specific claim about this person", () => {
    const s = slicesFor(hitFor({
      scripts: [
        script({ role: "Sales reps - Markets", openingQuote: "Written for the role." }),
        script({ stakeholder: "Ibrahim Khalid", openingQuote: "Written for me." }),
      ],
    }));
    const out = s.scriptSlice()!;
    expect(out.openingQuote).toBe("Written for me.");
    expect(out.matchedBy).toBe("name");
  });

  it("a role match is EXACT — 'Surgical Operations' never collects the Sales Operations script", () => {
    const s = slicesFor(hitFor({
      stakeholder: "Dana Ruiz",
      roster: [{ stakeholder: "Dana Ruiz", role: "Surgical Operations" }],
      scripts: [script({ stakeholder: "Sales Operations", openingQuote: "Not hers." })],
    }));
    expect(s.holderRole).toBe("Surgical Operations");
    expect(s.scriptMatch(), "a loose match hands one person another person's walkthrough").toBeNull();
    expect(s.scriptSlice()).toBeUndefined();
  });

  it("a shared first word is not a shared identity", () => {
    // The old rule compared first tokens, so a recipient labelled "Sales
    // Director" collected the "Sales reps - Markets" script on the word "sales".
    const s = slicesFor(hitFor({
      stakeholder: "Sales Director",
      roster: [{ stakeholder: "Sales Director", role: "Head of Field Sales" }],
      scripts: LAILA_SCRIPTS,
    }));
    expect(s.scriptMatch()).toBeNull();
  });

  it("punctuation and case are folded, so the same role spelt differently still matches", () => {
    const s = slicesFor(hitFor({
      roster: [{ stakeholder: "Ibrahim Khalid", role: "sales reps — markets" }],
      scripts: LAILA_SCRIPTS,
    }));
    expect(s.scriptSlice()!.openingQuote).toBe("Quotes take a week.");
  });

  it("a first name still finds the person it belongs to", () => {
    const s = slicesFor(hitFor({
      stakeholder: "Priya Nair",
      roster: [{ stakeholder: "Priya Nair", role: "Head of Revenue Operations" }],
      scripts: [script({ stakeholder: "Priya", openingQuote: "Hers." })],
    }));
    expect(s.scriptSlice()!.matchedBy).toBe("name");
  });

  it("a pack that carries a REAL role uses it without consulting the roster", () => {
    const s = slicesFor(hitFor({
      stakeholder: "Someone Not On The Roster",
      role: "Leader - Marketing",
      roster: [],
      scripts: LAILA_SCRIPTS,
    }));
    expect(s.scriptSlice()!.openingQuote).toBe("Campaign spend is a black box.");
  });
});

describe("the recipient's AREA resolves through the same match", () => {
  it("a role-matched script scopes the walk to that script's area", () => {
    const s = slicesFor(hitFor({ scripts: LAILA_SCRIPTS }));
    expect(s.recipientAreaSlice()).toBe("Sales");
  });

  it("an area stamped on the invite still wins", () => {
    const s = slicesFor(hitFor({ recipientArea: "Alliances", scripts: LAILA_SCRIPTS }));
    expect(s.recipientAreaSlice()).toBe("Alliances");
  });

  it("General and no-match both scope nothing — a graceful no-op, never a wrong area", () => {
    expect(slicesFor(hitFor({ scripts: [script({ stakeholder: "Sales reps - Markets", area: "General" })] })).recipientAreaSlice()).toBe("");
    expect(slicesFor(hitFor({ scripts: [script({ stakeholder: "Nobody At All", area: "Sales" })] })).recipientAreaSlice()).toBe("");
  });
});

describe("when nothing matches, the absence is STATED", () => {
  it("scripts exist but none is theirs — the gap says which of the two happened", () => {
    const s = slicesFor(hitFor({ stakeholder: "Nobody Here", roster: [], scripts: LAILA_SCRIPTS }));
    expect(s.scriptSlice()).toBeUndefined();
    expect(s.scriptGapSlice()).toContain("for your role");
  });

  it("no scripts were ever written — a different sentence, because it is a different fact", () => {
    const s = slicesFor(hitFor({ scripts: null }));
    expect(s.scriptGapSlice()).toContain("No demo script has been written");
    expect(s.scriptGapSlice()).not.toBe(slicesFor(hitFor({ stakeholder: "Nobody Here", roster: [], scripts: LAILA_SCRIPTS })).scriptGapSlice());
  });

  it("both sentences tell the stakeholder what to do instead — the answer still counts", () => {
    for (const s of [slicesFor(hitFor({ scripts: null })), slicesFor(hitFor({ stakeholder: "Nobody Here", roster: [], scripts: LAILA_SCRIPTS }))]) {
      expect(s.scriptGapSlice()).toContain("your answer counts the same");
    }
  });

  it("the edge SHIPS the gap on both link kinds that were meant to carry a walk", () => {
    // Demo invites, and the Show interview links a design round is minted on.
    expect(EDGE).toContain("...(script ? { script } : { scriptGap: scriptGapSlice() })");
    expect(EDGE).toContain("...(interviewScript ? { script: interviewScript } : (wantsDesign ? { scriptGap: scriptGapSlice() } : {}))");
  });
});

/* ------------------------------------------------------------------ *
 * The PAGE — an empty block is indistinguishable from a broken page
 * ------------------------------------------------------------------ */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const STAMP = { kind: "design-round", roundId: "round-1", ordinal: 1, prototypeTitle: "Laila CRM pilot" };
const mount = (props: Record<string, unknown>) => act(() => {
  root.render(createElement(DesignRoundReviewSurface, {
    stamp: STAMP, stakeholder: "Ibrahim Khalid", programme: "Laila CRM",
    submitting: false, error: null, onSubmit: () => {}, ...props,
  } as never));
});

describe("the round review page and the missing script", () => {
  it("REGRESSION: no script renders the STATED absence, not silence", () => {
    mount({ scriptGap: "No walkthrough was written for your role, so there is no script to follow here. Take the prototype in whatever order makes sense for your work — your answer counts the same." });
    const text = host.textContent ?? "";
    expect(text).toContain("Your demo script");
    expect(text).toContain("No walkthrough was written for your role");
    expect(host.querySelector(".v3fs-dr-scriptgap"), "the gap block never renders as an empty section").toBeTruthy();
  });

  it("the page still says something when the edge is older than this and sends no gap", () => {
    mount({});
    expect(host.textContent ?? "").toContain("no script to follow here");
  });

  it("a script matched by ROLE is labelled as the role's walk, not as theirs personally", () => {
    mount({ script: { openingQuote: "Quotes take a week.", matchedBy: "role", steps: [{ beat: "Open the deal" }] } });
    const text = host.textContent ?? "";
    expect(text).toContain("The walk we cut for your role");
    expect(text).not.toContain("for your workflow");
    expect(host.querySelector(".v3fs-dr-scriptgap"), "a matched script must not also draw the gap").toBeNull();
  });

  it("a script matched by NAME keeps the stronger claim", () => {
    mount({ script: { openingQuote: "Quotes take a week.", matchedBy: "name", steps: [{ beat: "Open the deal" }] } });
    expect(host.textContent ?? "").toContain("The walk we cut for your workflow");
  });
});
