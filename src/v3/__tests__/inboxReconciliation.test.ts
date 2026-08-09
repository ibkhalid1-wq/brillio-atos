/**
 * One unit, one definition: "need a human owner" and the data-dictionary bucket, computed
 * once (projections.openOwnerQuestions / dictionaryBucket). Conservation + post-conditions,
 * proven on the migrated Laila ledger (the CRM domain — the 12-vs-18 / type-flood case).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue, openOwnerQuestions, dictionaryBucket } from "@/v3/lib/ledger/projections";
import { TYPING_SLOTS } from "@/v3/lib/ledger/dictionary";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const store = migrate({ ontology: snap("domain-ontology.json"), atlas: snap("current-state-atlas.json"), overrides: snap("operator-overrides.json") } as Snapshot);
const q = buildUnknownQueue(store);

describe("need-an-owner vs dictionary bucket — one definition, computed once", () => {
  const allUnownedOpen = q.items.filter((i) => i.owner.kind === "unowned" && i.status === "open");
  const owner = openOwnerQuestions(q);
  const dict = dictionaryBucket(q);
  const dictUnowned = dict.filter((i) => i.owner.kind === "unowned");

  it("CONSERVATION: all unowned-open = need-an-owner + the unowned slice of the dictionary bucket (nothing vanishes)", () => {
    expect(owner.length + dictUnowned.length).toBe(allUnownedOpen.length);
  });

  it("no double-count: the owner queue and the dictionary bucket are disjoint", () => {
    const dictSet = new Set(dict.map((i) => i.about));
    expect(owner.filter((i) => dictSet.has(i.about))).toHaveLength(0);
  });

  it("post-condition: the dictionary bucket contains ZERO phase/decision questions", () => {
    expect(dict.filter((i) => i.slot === "phase" || i.slot === "decision")).toHaveLength(0);
  });

  it("post-condition: the owner queue contains ZERO typing questions (values/type/optionality)", () => {
    expect(owner.filter((i) => TYPING_SLOTS.has(i.slot))).toHaveLength(0);
  });

  it("unit is QUESTIONS: every owner-queue item is a single locus (question), not an element", () => {
    expect(new Set(owner.map((i) => i.about)).size).toBe(owner.length);
    // the dictionary bucket absorbs the CRM type-flood (dataType/valueSet) — the ~244 wall
    expect(dict.length).toBeGreaterThan(150);
  });
});
