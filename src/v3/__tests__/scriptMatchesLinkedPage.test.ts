/**
 * THE LINKED PAGE ASKS WHAT THE DISCOVERY SCRIPT SAYS — asserted end to end, on the real
 * programme, not on a fixture.
 *
 * Two surfaces show the same question to two different people. The operator reads the
 * DISCOVERY SCRIPT (`projectKitQuestions` — the kit projection); the stakeholder reads the
 * LINKED PAGE (`portalQuestionModel` over a minted pack). If those drift, the operator
 * briefs someone to expect one question and the page asks another — and nothing in the
 * suite would have noticed, because every existing test compares one derivation against
 * another derivation of the same side.
 *
 * They agree today BY CONSTRUCTION: both render through `renderQuestion` with the
 * `"stakeholder"` audience (`kitProjection.ts:48`, `portalQuestionModel.ts:117`). That is
 * exactly why this test is worth writing — a construction guarantee nobody checks is one
 * refactor away from being a coincidence. Flipping the page's audience to `"operator"`
 * diverges all 108 questions ("In *your* world…" → "In *the* world…"), which is invisible
 * to every other assertion in the repo.
 *
 * FIXTURE IS REAL: the Laila snapshot, migrated the way the app migrates it, minted the way
 * `TheLine` mints a follow-up (questions from the kit, loci index-aligned).
 *
 * No DB, no network.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue, type QueueItem } from "@/v3/lib/ledger/projections";
import { projectKitQuestions } from "@/v3/lib/ledger/kitProjection";
import { portalQuestionModel } from "@/v3/components/flow/portalQuestionModel";
import { TYPING_SLOTS } from "@/v3/lib/ledger/dictionary";

const snap = (f: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const store = migrate({
  ontology: snap("domain-ontology.json"),
  atlas: snap("current-state-atlas.json"),
  overrides: snap("operator-overrides.json"),
} as Snapshot);

/** THE DISCOVERY SCRIPT — what the operator is briefed to ask. */
const script = new Map(projectKitQuestions(store).map((k) => [k.about, k.question]));

/** Solo-owned open questions per role, exactly as `useProgramLedger` groups them. */
const soloByOwner = (): Map<string, QueueItem[]> => {
  const out = new Map<string, QueueItem[]>();
  for (const it of buildUnknownQueue(store).items) {
    if (it.status === "open" && TYPING_SLOTS.has(it.slot)) continue;   // typing → dictionary
    if (it.owner.kind !== "role" || it.status !== "open") continue;
    (out.get(it.ownerLabel) ?? out.set(it.ownerLabel, []).get(it.ownerLabel)!).push(it);
  }
  return out;
};

/** Mint the pack the way TheLine does, then read it the way the stakeholder's page does. */
const pageFor = (items: QueueItem[]) => {
  const questionLoci = items.map((i) => i.about);
  const questions = questionLoci.map((a) => script.get(a) ?? "");
  const model = portalQuestionModel({ questions, questionLoci }, store);
  const rows = [...model.groups.flatMap((g) => g.rows), ...model.rows];
  return { model, byAbout: new Map(rows.map((r) => [r.about, r])) };
};

describe("the stakeholder's linked page asks exactly what the discovery script says", () => {
  const owners = soloByOwner();

  it("the fixture is substantial — a vacuous pass would prove nothing", () => {
    expect(owners.size).toBeGreaterThan(5);
    expect([...owners.values()].reduce((n, i) => n + i.length, 0)).toBeGreaterThan(50);
    expect(script.size).toBeGreaterThan(100);
  });

  it("every scripted question REACHES the page — none silently dropped in the mint", () => {
    const absent: string[] = [];
    for (const [owner, items] of owners) {
      const { byAbout } = pageFor(items);
      for (const it of items) if (!byAbout.has(it.about)) absent.push(`${owner}: ${it.about}`);
    }
    expect(absent, `\nScripted questions missing from the linked page:\n${absent.join("\n")}\n`).toEqual([]);
  });

  it("the page's RENDERED text is the script's text, character for character", () => {
    // The one that catches an audience/phrasing drift between the two surfaces.
    const diffs: string[] = [];
    for (const [owner, items] of owners) {
      const { byAbout } = pageFor(items);
      for (const it of items) {
        const row = byAbout.get(it.about); if (!row) continue;
        if (row.rendered.question !== script.get(it.about)) {
          diffs.push(`${owner} · ${it.about}\n  script: ${script.get(it.about)}\n  page  : ${row.rendered.question}`);
        }
      }
    }
    expect(
      diffs.slice(0, 5),
      `\n${diffs.length} question(s) render differently on the page than in the script:\n` +
      `${diffs.slice(0, 5).join("\n")}\n\n` +
      `Both sides must go through renderQuestion with the SAME audience. If one moved, the\n` +
      `operator is briefing a question the stakeholder will not be asked.\n`,
    ).toEqual([]);
  });

  it("what the pack STORED equals the script, so the record of what was asked is honest", () => {
    // `stored` is the text frozen at mint. If it drifts from the script the audit trail
    // ("what did we actually ask?") stops matching the brief.
    const diffs: string[] = [];
    for (const [, items] of owners) {
      const { byAbout } = pageFor(items);
      for (const it of items) {
        const row = byAbout.get(it.about); if (!row) continue;
        if (row.stored !== script.get(it.about)) diffs.push(it.about);
      }
    }
    expect(diffs, `\nStored pack text diverges from the script for: ${diffs.slice(0, 5).join(", ")}\n`).toEqual([]);
  });

  it("every question on these pages is locus-backed — an answer closes something", () => {
    // `unbacked` counts questions rendered beside the locus cards with no locus of their
    // own: answering one carries no [locus: …] tag and closes nothing (L4). A pack minted
    // from live loci must have none.
    for (const [owner, items] of owners) {
      const { model } = pageFor(items);
      expect(model.mode, `${owner} fell back to string mode`).toBe("loci");
      expect(model.unbacked, `${owner} has unbacked questions on the page`).toBe(0);
      expect(model.count).toBe(items.length);
    }
  });
});
