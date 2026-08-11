/**
 * HARNESS REGRESSION — the guards behind the FINAL GATE, fed the exact strings that
 * slipped past them.
 *
 * A source sentry is only worth its line count if it fails on the thing it forbids.
 * Three of the FINAL GATE's sentries did not:
 *
 *  H1 · `expect(shell).not.toContain("operatorQueueCount(")` was meant to stop FlowShell
 *       re-acquiring its own copy of the operator-queue count. The exported symbol is the
 *       PLURAL `operatorQueueCounts`, and "operatorQueueCounts(ledger)".includes(
 *       "operatorQueueCount(") is FALSE — the guard was bypassable by the one spelling a
 *       developer would actually type.
 *
 *  H3 · the fabricated-owner scan iterated a hardcoded 12-file array while the ledger
 *       directory held 20 modules. readModel.ts — imported by useProgramLedger and
 *       pgStore, so squarely on the live path — was never read.
 *
 *  H5 · dictionary.ts's "System Owner" was exempt from that scan on the STRING ALONE.
 *       Its sibling pin makes migrate.ts's `ownerFor("sales")` prove it only lands on
 *       weak claims; the dictionary exemption demanded nothing, so the same literal on
 *       an OPEN claim would have kept the scan green.
 *
 * Each `it` below is red against the previous spelling of its guard (the counterfactual
 * is stated in the test) and green against the current one.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readdirSync } from "node:fs";
import { importsModule, literalRoleOwners, constOwnerIsInert, filesToScan, FROZEN_CORE, enclosingExport } from "./helpers/sourceGuards";

const LEDGER_DIR = resolve(__dirname, "../lib/ledger");

describe("H1 — the FlowShell guard catches the plural spelling", () => {
  const PLURAL = `import { operatorQueueCounts } from "@/v3/lib/ledger/operatorQueue";\nconst n = operatorQueueCounts(ledger).total;\n`;

  it("the OLD guard misses it — this is the bypass, stated as a fact about the string", () => {
    expect(PLURAL.includes("operatorQueueCount(")).toBe(false); // the guard said: therefore fine
  });

  it("the NEW guard catches it, because it forbids the MODULE, not one arrangement of letters", () => {
    expect(importsModule(PLURAL, "@/v3/lib/ledger/operatorQueue")).toBe(true);
  });

  it("...and catches the singular, the relative path, and single quotes too", () => {
    expect(importsModule(`import { operatorQueueCount } from "@/v3/lib/ledger/operatorQueue";`, "@/v3/lib/ledger/operatorQueue")).toBe(true);
    expect(importsModule(`import x from '../../lib/ledger/operatorQueue';`, "../../lib/ledger/operatorQueue")).toBe(true);
    expect(importsModule(`import x from "@/v3/lib/ledger/operatorQueueOther";`, "@/v3/lib/ledger/operatorQueue")).toBe(false);
  });

  it("it does not fire on a module that merely mentions the name in prose", () => {
    expect(importsModule(`// operatorQueue owns the ledger half of the count\n`, "@/v3/lib/ledger/operatorQueue")).toBe(false);
  });
});

describe("H3 — the fabricated-owner scan reads the directory, not a hand-kept list", () => {
  const OLD_HARDCODED = ["adapters.ts", "dictionary.ts", "migrate.ts", "curation.ts", "operatorActions.ts",
    "operatorQueue.ts", "artifactAsks.ts", "kitProjection.ts", "renderQuestion.ts", "useProgramLedger.ts",
    "phrasing.ts", "merge.ts"];

  it("the OLD list left live-path modules unscanned — readModel is imported by useProgramLedger and pgStore", () => {
    for (const missed of ["readModel.ts", "pgStore.ts", "kitAgendaCache.ts", "useOperatorCommits.ts"]) {
      expect(OLD_HARDCODED).not.toContain(missed);
      expect(readdirSync(LEDGER_DIR)).toContain(missed); // it was on disk the whole time
    }
  });

  it("the NEW scan covers every one of them", () => {
    const scanned = filesToScan(readdirSync(LEDGER_DIR));
    for (const f of ["readModel.ts", "pgStore.ts", "kitAgendaCache.ts", "useOperatorCommits.ts"]) {
      expect(scanned).toContain(f);
    }
  });

  it("a module added tomorrow is covered the day it lands — no edit to the test required", () => {
    expect(filesToScan([...readdirSync(LEDGER_DIR), "brandNewModule.ts"])).toContain("brandNewModule.ts");
  });

  it("exactly the four frozen-core files are excluded, and nothing else is", () => {
    const all = readdirSync(LEDGER_DIR).filter((f) => f.endsWith(".ts"));
    const scanned = filesToScan(all);
    expect(FROZEN_CORE.length).toBe(4);
    expect(all.filter((f) => !scanned.includes(f)).sort()).toEqual([...FROZEN_CORE].sort());
  });

  it("non-TypeScript entries are ignored (a stray .md or .json is not source to scan)", () => {
    expect(filesToScan(["a.ts", "notes.md", "fixture.json"])).toEqual(["a.ts"]);
  });
});

describe("H5 — the dictionary's owner exemption is conditional, like migrate's", () => {
  // The real shape, reduced: a const bound once, spent once, on a claim born weak.
  const INERT = [
    `const OWNER: Owner = { kind: "role", role: "System Owner" };`,
    `const add = (about: string, value: ClaimValue) =>`,
    `  batch.push({ about, value, source: "code-derived", ownerWhileOpen: OWNER, status: "weak", closedBy });`,
  ].join("\n");

  it("the literal is present in both the inert and the dangerous shape — the STRING alone tells you nothing", () => {
    const OPEN = INERT.replace(`status: "weak"`, `status: "open"`);
    expect(literalRoleOwners(INERT)).toEqual(["System Owner"]);
    expect(literalRoleOwners(OPEN)).toEqual(["System Owner"]);
    // ...which is precisely why exempting on the string was a hole.
  });

  it("inert while every use site is born weak or closed", () => {
    expect(constOwnerIsInert(INERT, "System Owner")).toBe(true);
    expect(constOwnerIsInert(INERT.replace(`status: "weak"`, `status: "closed"`), "System Owner")).toBe(true);
  });

  it("NOT inert the moment a use site mints an OPEN claim — the hole this closes", () => {
    expect(constOwnerIsInert(INERT.replace(`status: "weak"`, `status: "open"`), "System Owner")).toBe(false);
  });

  it("NOT inert if a SECOND site spends the binding without a weak/closed status", () => {
    const second = `${INERT}\nbatch.push({ about, value, ownerWhileOpen: OWNER, status: "blocked" });`;
    expect(constOwnerIsInert(second, "System Owner")).toBe(false);
  });

  it("NOT inert if the binding leaks anywhere other than an ownerWhileOpen site", () => {
    // A reference we cannot see the status of is a reference we cannot vouch for.
    expect(constOwnerIsInert(`${INERT}\nexport const defaultOwner = OWNER;`, "System Owner")).toBe(false);
  });

  it("NOT inert if the exemption is vacuous — a literal nobody spends earns nothing", () => {
    expect(constOwnerIsInert(`const OWNER: Owner = { kind: "role", role: "System Owner" };`, "System Owner")).toBe(false);
  });

  it("NOT inert if the literal is sprayed inline rather than bound once", () => {
    expect(constOwnerIsInert(`push({ ownerWhileOpen: { kind: "role", role: "System Owner" }, status: "weak" });`, "System Owner")).toBe(false);
  });

  it("the exemption is for this ONE role — a different literal is never inert by association", () => {
    expect(constOwnerIsInert(INERT, "Sales Ops")).toBe(false);
  });
});

describe("literalRoleOwners matches constants only", () => {
  it("a derived owner is not a fabrication and is not reported", () => {
    expect(literalRoleOwners(`{ kind: "role", role: fn }`)).toEqual([]);
    expect(literalRoleOwners(`{ kind: "role", role: a.owner.label }`)).toEqual([]);
  });

  it("a typed-in owner is reported, wherever it sits", () => {
    expect(literalRoleOwners(`{ kind: "role", role: "Sales Ops" }`)).toEqual(["Sales Ops"]);
    expect(literalRoleOwners(`role:"Finance"`)).toEqual(["Finance"]);
  });

  // ── H6 · the bypasses that walked past THIS predicate, fed to it ───────────────────
  // Each string below was PLANTED into src/v3/lib/ledger/useProgramLedger.ts — the live
  // path — during the refutation pass. Under the old `/role:\s*"([^"]+)"/` the whole (b)
  // invariant stayed green: finalGateInvariants 13/13, sourceGuards 19/19, and
  // validate-pipeline printed PASS F4/F5/F6 over a fabricated constant owner on a live
  // module. That is the defect 0a023c9 fixed in adapters.ts, walking straight back in.
  it("H6a: one const hop does not launder a fabricated owner", () => {
    expect(literalRoleOwners([
      `const FALLBACK_ROLE = "Sales Ops";`,
      `const PLANTED_OWNER = { kind: "role", role: FALLBACK_ROLE };`,
    ].join("\n"))).toEqual(["Sales Ops"]);
  });

  it("H6b: the quote style does not matter — single, double or template", () => {
    expect(literalRoleOwners(`{ kind: "role", role: 'Sales Ops' }`)).toEqual(["Sales Ops"]);
    expect(literalRoleOwners("{ kind: \"role\", role: `Sales Ops` }")).toEqual(["Sales Ops"]);
    expect(literalRoleOwners([
      `const FALLBACK_ROLE = 'Sales Ops';`,
      `const O = { kind: "role", role: FALLBACK_ROLE };`,
    ].join("\n"))).toEqual(["Sales Ops"]);
  });

  it("H6c: object shorthand is a fabrication too when the binding is a literal", () => {
    expect(literalRoleOwners([
      `const role = "Sales Ops";`,
      `const O = { kind: "role", role };`,
    ].join("\n"))).toEqual(["Sales Ops"]);
  });

  it("H6d: a NAME is never reported on its own — only a resolved typed string", () => {
    // The hop exists to catch a CONSTANT, not to flag every identifier. A role computed
    // from the record has no string binding in the file, so it stays unreported — which
    // is what keeps this guard from going red on every honest derivation.
    expect(literalRoleOwners([
      `const O = { kind: "role", role: derivedLabel };`,
      `const P = { kind: "role", role };`,
    ].join("\n"))).toEqual([]);
    expect(literalRoleOwners([
      `const label = functionOf(id);`,
      `const O = { kind: "role", role: label };`,
    ].join("\n"))).toEqual([]);
  });

  it("H6e: constOwnerIsInert reads the same quote class, so the exemption cannot be smuggled", () => {
    // A single-quoted band is now judged on its merits (here: no `ownerWhileOpen: OWNER`
    // site at all → not inert) instead of failing to parse and returning the safe answer
    // for the wrong reason.
    expect(constOwnerIsInert(`const OWNER: Owner = { kind: "role", role: 'System Owner' };`, "System Owner")).toBe(false);
    expect(constOwnerIsInert([
      `const OWNER: Owner = { kind: "role", role: 'System Owner' };`,
      `push({ about, ownerWhileOpen: OWNER, status: "weak" });`,
    ].join("\n"), "System Owner")).toBe(true);
  });
});

// ── H7 · the bypasses the one-hop regex could not see, fed to the predicate ──────────
/**
 * Every string below is a CONSTANT role owner — a role somebody typed — reaching a claim.
 * Each walked past the previous spelling of this guard, so F5/F6 printed PASS over the
 * exact defect 0a023c9 fixed. They are resolved now by parsing rather than matching.
 *
 * The last case runs the other way: a guard that fires on the COMMENT explaining it is a
 * guard nobody can live with, and in this codebase the fix and its rationale sit side by
 * side, so that collision is the normal case rather than a corner one.
 */
describe("H7 — constants that reached a claim through more than one hop", () => {
  it("H7a: TWO const hops — the chain the old note recorded as invisible", () => {
    expect(literalRoleOwners([
      `const BASE = "Sales Ops";`,
      `const FALLBACK = BASE;`,
      `const O = { kind: "role", role: FALLBACK };`,
    ].join("\n"))).toEqual(["Sales Ops"]);
  });

  it("H7b: an `as` cast — the lookahead stopped at the cast and saw nothing", () => {
    expect(literalRoleOwners([
      `const FALLBACK = "Sales Ops";`,
      `const O = { kind: "role", role: FALLBACK as string };`,
    ].join("\n"))).toEqual(["Sales Ops"]);
  });

  it("H7c: a trailing comment — same lookahead, same blindness", () => {
    expect(literalRoleOwners([
      `const FALLBACK = "Sales Ops";`,
      `const O = { kind: "role", role: FALLBACK /* why */ };`,
    ].join("\n"))).toEqual(["Sales Ops"]);
  });

  it("H7d: a lookup into a constant table, by member AND by index", () => {
    const table = `const OWNERS = { sales: "Sales Ops", finance: "Finance" };`;
    expect(literalRoleOwners([table, `const O = { kind: "role", role: OWNERS.sales };`].join("\n")))
      .toEqual(["Sales Ops"]);
    expect(literalRoleOwners([table, `const O = { kind: "role", role: OWNERS["finance"] };`].join("\n")))
      .toEqual(["Finance"]);
  });

  it("H7e: a constant imported from another module, once the scan can read modules", () => {
    const source = [
      `import { FALLBACK_ROLE } from "./roles";`,
      `const O = { kind: "role", role: FALLBACK_ROLE };`,
    ].join("\n");
    // without a reader the identifier is unknowable, so it stays unreported — the guard
    // does not invent a finding it cannot substantiate
    expect(literalRoleOwners(source)).toEqual([]);
    expect(literalRoleOwners(source, {
      readModule: (spec) => spec === "./roles" ? `export const FALLBACK_ROLE = "Sales Ops";` : null,
    })).toEqual(["Sales Ops"]);
  });

  it("H7f: a derivation is still not a fabrication, however it is spelled", () => {
    expect(literalRoleOwners([
      `const OWNERS = { sales: computeLabel() };`,
      `const A = { kind: "role", role: OWNERS.sales };`,   // table entry is a call
      `const B = { kind: "role", role: lookup(id) as string };`,
      `const C = { kind: "role", role: rec.owner.label };`,
    ].join("\n"))).toEqual([]);
  });

  it("H7g: a cyclic binding terminates instead of hanging", () => {
    expect(literalRoleOwners([
      `const a = b;`, `const b = a;`, `const O = { kind: "role", role: a };`,
    ].join("\n"))).toEqual([]);
  });

  it("H7h: THE OTHER DIRECTION — a comment quoting the pattern must not trip the guard", () => {
    // finalGateInvariants (b) scanned raw source, so documenting the fix in prose turned
    // F5 red for a comment. Parsing never sees comments; the regex pass is fed codeOnly.
    expect(literalRoleOwners(`// the old bug stamped role: "Sales Ops" on every claim`)).toEqual([]);
    expect(literalRoleOwners(`/* a constant owner, e.g. role: "Finance", is a fabrication */`)).toEqual([]);
    // …but the same text as CODE is still caught
    expect(literalRoleOwners(`const O = { kind: "role", role: "Finance" };`)).toEqual(["Finance"]);
  });
});

// ── H8 · enclosingExport — the two shapes that orphaned a control silently ───────────
/**
 * ed82514's defect was a capture control rendered inside a local nobody calls. The guard
 * that exists to catch it asked "which exported symbol holds this offset?" with a
 * column-zero regex bound to `function|const|class`, which fails OPEN twice over.
 */
describe("H8 — which exported symbol holds an offset", () => {
  const at = (src: string, needle: string) => enclosingExport(src, src.indexOf(needle));

  it("H8a: an exported host is found, however deeply the site is nested inside it", () => {
    const src = [
      `export default function TheLine() {`,
      `  const inner = () => {`,
      `    return <TranscribeButton />;`,
      `  };`,
      `  return inner();`,
      `}`,
    ].join("\n");
    expect(at(src, "<TranscribeButton")).toEqual({ name: "TheLine", isDefault: true });
  });

  it("H8b: a `let` local host closes the export — the alternation missed this entirely", () => {
    const src = [
      `export default function TheLine() { return null; }`,
      `let CaptureDialog = () => <TranscribeButton />;`,
    ].join("\n");
    // the old regex knew only function|const|class, so this local never closed TheLine
    // and the orphaned control was credited to it
    expect(at(src, "<TranscribeButton")).toBeNull();
  });

  it("H8c: an INDENTED local host closes it too — column zero was never the real rule", () => {
    const src = [
      `export default function TheLine() { return null; }`,
      `if (flag) {`,
      `  function CaptureDialog() { return <TranscribeButton />; }`,
      `}`,
    ].join("\n");
    expect(at(src, "<TranscribeButton")).toBeNull();
  });

  it("H8d: …and the recorded interim would have gone RED on correct code", () => {
    // The note proposed relaxing `^` to `^[ \t]*`. Under that rule the ordinary indented
    // `const` below is a declaration that is not exported, so it would close its OWN
    // export and a live render site would resolve to null. It must not.
    const src = [
      `export default function TheLine() {`,
      `  const label = "hi";`,
      `  return <TranscribeButton title={label} />;`,
      `}`,
    ].join("\n");
    expect(at(src, "<TranscribeButton")).toEqual({ name: "TheLine", isDefault: true });
  });

  it("H8e: a named export and a non-default one are distinguished", () => {
    expect(at(`export const Panel = () => <TranscribeButton />;`, "<Transcribe"))
      .toEqual({ name: "Panel", isDefault: false });
    expect(at(`function Local() { return <TranscribeButton />; }`, "<Transcribe")).toBeNull();
  });
});
