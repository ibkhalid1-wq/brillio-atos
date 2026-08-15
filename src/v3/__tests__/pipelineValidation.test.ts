/**
 * PIPELINE VALIDATION (hostile) — the checks scripts/validate-pipeline.sh runs that
 * are not already covered by the dedicated suites. Section tags mirror the
 * full-validation report (docs/aura/full-validation-*.md). Both programs where the
 * check is program-shaped. Read-only over fixtures; mutations on throwaway stores.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue, buildKitView, openOwnerQuestions, dictionaryBucket } from "@/v3/lib/ledger/projections";
import { projectKitQuestions } from "@/v3/lib/ledger/kitProjection";
import { renderQuestion } from "@/v3/lib/ledger/renderQuestion";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { diffFabric } from "@/v3/lib/fabricDelta";
import { deriveRoles } from "@shared/semanticRoles.ts";
import { TYPING_SLOTS } from "@/v3/lib/ledger/dictionary";
import { displayPersonLabel, UNNAMED_SUFFIX_RE } from "@/v3/components/flow/flowStakeholders";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const lailaOntology = () => snap("domain-ontology.json");
const lailaAtlas = () => snap("current-state-atlas.json");
const laila = () => migrate({ ontology: lailaOntology(), atlas: lailaAtlas(), overrides: snap("operator-overrides.json") } as Snapshot);

const surgeryOntology = {
  entities: [
    { name: "Case", area: "Surgical Operations", systemOfRecord: "EHR", attributes: ["status", "priority", "acuity"] },
    { name: "Anesthesia Record", area: "Anesthesiology", systemOfRecord: "EHR", attributes: ["type"] },
    { name: "OR Slot", area: "Surgical Scheduling", attributes: ["state"] },
  ],
  relations: [{ from: "Case", to: "Anesthesia Record", relation: "requires", cardinality: "1:1" }],
};
const surgeryAtlas = {
  workflows: [{ name: "Case Cancellation Review", area: "Surgical Operations", owner: "Chief of Surgery", trigger: "cancel requested",
    steps: [{ action: "Decide whether to reschedule or cancel the case after payer review", actor: "Surgeon" }] }],
};
const surgery = (): Snapshot => ({ ontology: surgeryOntology, atlas: surgeryAtlas, overrides: [] });

// ── A3 (cold re-run): three surfaces, one set — fresh stores per read ──
describe("[A3] three surfaces one set — cold", () => {
  for (const [name, build] of [["Laila", () => laila()], ["surgery", () => migrate(surgery())]] as const) {
    it(`${name}: kit === queue === per-owner union; unit questions; ids open`, () => {
      const s1 = build(); const s2 = build(); // separate stores — no session artifact
      const kit = new Set(projectKitQuestions(s1).map((k) => k.about));
      const open = buildUnknownQueue(s2).items.filter((i) => i.status === "open");
      expect(kit).toEqual(new Set(open.map((i) => i.about)));
      // per-owner union (roster-chip source) === whole set
      const byOwner = new Map<string, number>();
      for (const i of open) byOwner.set(i.ownerLabel, (byOwner.get(i.ownerLabel) ?? 0) + 1);
      expect([...byOwner.values()].reduce((a, b) => a + b, 0)).toBe(open.length);
    });
  }
});

// ── B3: partition both directions ──
describe("[B3] owner-queue / dictionary partition", () => {
  for (const [name, build] of [["Laila", () => laila()], ["surgery", () => migrate(surgery())]] as const) {
    it(`${name}: zero PHASE/DECISION in dictionary; zero typing in owner queue`, () => {
      const q = buildUnknownQueue(build());
      expect(dictionaryBucket(q).filter((i) => i.slot === "phase" || i.slot === "decision")).toHaveLength(0);
      expect(openOwnerQuestions(q).filter((i) => TYPING_SLOTS.has(i.slot))).toHaveLength(0);
    });
  }
});

// ── E1 (operator disposition leg) + E2 conservation around it ──
describe("[E1/E2] disposition closure moves burn-down; conservation holds around the mutation", () => {
  it("scratch store: disposition close → open−1, conservation before and after", () => {
    const store = migrate(surgery());
    const conserve = () => {
      const open = buildUnknownQueue(store).items.filter((i) => i.status === "open");
      const q = buildUnknownQueue(store);
      const dict = dictionaryBucket(q).length;
      const owner = openOwnerQuestions(q).length;
      const roleOwned = open.filter((i) => !TYPING_SLOTS.has(i.slot) && i.owner.kind === "role").length;
      const joint = open.filter((i) => !TYPING_SLOTS.has(i.slot) && i.owner.kind === "joint").length;
      // owner-queue is the unowned non-typing slice; role/joint-owned are the rest
      expect(dict + owner + roleOwned + joint).toBe(open.length);
      return open.length;
    };
    const before = conserve();
    const target = buildUnknownQueue(store).items.find((i) => i.status === "open")!;
    const bd0 = buildKitView(store).burnDown;
    // The store's own disposition API — an owner ACCEPTS a value (weak). NOTE
    // (judgment call, logged): a bare `na` disposition does NOT supersede an open
    // unknown (supersession requires a substantive value); decide-fate is the
    // overlay for out-of-scope. A valued disposition is the closing path.
    store.disposition(target.about, { kind: "scalar", value: "per current policy" }, "to-be", "domain", { kind: "unowned" }, "operator");
    const after = conserve();
    expect(after).toBe(before - 1);
    expect(buildKitView(store).burnDown.open).toBe(bd0.open - 1);
    expect(projectKitQuestions(store).some((k) => k.about === target.about)).toBe(false);
  });
});

// ── G2: unknown role → explicit generic component; the epistemic gap stays live ──
describe("[G2] unknown-role fallback is honest-generic, question stays open", () => {
  it("an untyped attribute has no rich role AND renders in the assembly AND its dataType question is live", () => {
    const roles = deriveRoles(surgeryOntology as Record<string, unknown>);
    const acuity = roles.attributeRoles.find((r) => r.attribute === "acuity");
    // 'acuity' matches no role heuristic → undefined/plain (never a guessed rich component)
    const rich = new Set(["monetary", "status", "health", "priority", "boolean", "parent-ref", "cross-ref"]);
    expect(acuity === undefined || !rich.has(String(acuity.role))).toBe(true);
    const { html } = assemblePrototype(surgeryOntology as Record<string, unknown>, surgeryAtlas as Record<string, unknown>);
    expect(html).toContain("acuity"); // rendered — plainly, not hidden
    // the open type question survives the styling layer
    const open = buildUnknownQueue(migrate(surgery())).items.filter((i) => i.status === "open");
    expect(open.some((i) => i.about === "el:attr:case.acuity#dataType")).toBe(true);
  });
});

// ── G3: both programs, one mapping table, Meridian tokens, no source-app leakage ──
describe("[G3] both prototypes Meridian-styled from the SAME table; generic naming; AA tokens", () => {
  for (const [name, on, at] of [
    ["Laila", lailaOntology(), lailaAtlas()],
    ["surgery", surgeryOntology, surgeryAtlas],
  ] as const) {
    it(`${name}: assembled output carries Meridian tokens + .m-* components; zero "laila"`, () => {
      const { html, regionCount } = assemblePrototype(on as Record<string, unknown>, at as Record<string, unknown>);
      expect(html).toContain("--m-warn:#9c5c0e");            // the AA-corrected warn token
      expect(html).toMatch(/class="m-/);                     // Meridian components in use
      expect(/laila/i.test(html), `${name} output leaks the source-app name`).toBe(false); // zero — even Laila's own output stays generic
      expect(regionCount).toBeGreaterThan(0);
    });
  }
  it('mapping code + Meridian carry zero "laila" (generically named end to end)', () => {
    for (const f of ["prototypeAssembly.ts", "prototypeDesignSystem.ts", "semanticRoles.ts", "fabric.ts", "seedData.ts", "ontologyGraph.ts", "prototypeRefine.ts", "valueVocabulary.ts"]) {
      // The cluster lives in the Deno-importable shared layer — ONE copy, imported
      // by the studio (client) and by flow-portal (edge). Read from there, not from
      // src/v3/lib, so this check keeps covering the file that actually runs.
      const path = resolve(__dirname, `../../../supabase/functions/_shared/${f}`);
      const src = readFileSync(path, "utf8");
      expect(/laila/i.test(src), `${f} mentions the source app`).toBe(false);
    }
  });
});

// ── G4: incremental — one attribute change re-renders only touched nodes, styling intact ──
describe("[G4] diffFabric incremental keeps Meridian on the re-emitted nodes", () => {
  it("one-attribute change: small re-emit fraction; changed regions still Meridian-classed", () => {
    const before = deriveFabric(lailaOntology(), lailaAtlas());
    const changedOntology = JSON.parse(JSON.stringify(lailaOntology())) as { entities: Array<{ name: string; attributes: unknown[] }> };
    const acct = changedOntology.entities.find((e) => e.name === "Account")!;
    acct.attributes = [...acct.attributes, "riskTier"];      // one new attribute
    const after = deriveFabric(changedOntology as unknown as Record<string, unknown>, lailaAtlas());
    const delta = diffFabric(before, after);
    const total = after.nodes.length;
    const touched = delta.added.length + delta.changed.length;
    expect(touched).toBeGreaterThan(0);
    expect(touched / total).toBeLessThan(0.05);              // incremental, not a rebuild
    // the re-rendered assembly still styles the touched entity with Meridian
    const { html } = assemblePrototype(changedOntology as unknown as Record<string, unknown>, lailaAtlas());
    // The new attribute reaches the render — asserted through BOTH the human
    // label and the stable fabric id. It used to be asserted as the raw key
    // `riskTier`, which only held while the assembly printed schema names
    // straight onto the page; that was the `BUYINGROLE` defect, so the raw key
    // no longer appearing is the fix working, not the attribute going missing.
    expect(html).toContain("Risk Tier");
    expect(html).toContain("field:account:risktier");
    expect(html).toContain("--m-warn:#9c5c0e");
  });
});

// ── D2 spot: unknown kind never renders nothing ──
describe("[D2] unknown kind falls back visibly", () => {
  it("an unrecognized slot still renders a full question + free-text affordance", () => {
    const store = migrate(surgery());
    store.assert({ about: "el:entity:case#slaWindow", value: { kind: "unknown" }, world: "to-be", layer: "domain",
      source: "generated", ownerWhileOpen: { kind: "unowned" }, status: "open" });
    const r = renderQuestion(store, "el:entity:case#slaWindow", "stakeholder");
    expect(r.question.trim().length).toBeGreaterThan(0);
    expect(r.affordance.kind).toBe("free-text");
  });
});

// ── TBC is a stored machine token, never what a person reads ──
describe("[UI] unnamed-voice label", () => {
  it("translates the stored ' — TBC' token for humans; leaves named people alone", () => {
    expect(displayPersonLabel("Fulfilment SME — TBC")).toBe("Fulfilment SME — no one named yet");
    expect(displayPersonLabel("Regulatory Affairs SME – TBC")).toBe("Regulatory Affairs SME — no one named yet");
    expect(displayPersonLabel("Ibrahim Khalid")).toBe("Ibrahim Khalid");
    expect(displayPersonLabel("")).toBe("");
  });
  it("the DETECTION regex still matches the stored token (bind-a-name keeps working)", () => {
    expect(UNNAMED_SUFFIX_RE.test("Fulfilment SME — TBC")).toBe(true);
    expect(UNNAMED_SUFFIX_RE.test("Fulfilment SME")).toBe(false);
  });
});
