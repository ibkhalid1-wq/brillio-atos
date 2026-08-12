/**
 * DISCOVER CARDS — three defects, all of them "the surface said something the record
 * does not". Pinned here against the REAL Laila record, and against the RENDERED card,
 * because every one of them was invisible to a projection-only test.
 *
 * F6 · ONE CARD, THREE UNRECONCILED NUMBERS.
 *   The "Head of Sales" row showed a button reading "10 owned questions", a sub-line
 *   reading "9 open on loci they own", and minted a link that carried 8. Each number was
 *   individually defensible — the pack caps the ask, blocked loci cannot be asked, typing
 *   loci route to the data dictionary — and NOTHING on the card said so, which left the
 *   operator with "which one is true?" on a card whose entire job is to be trusted.
 *   The fix is not a fourth derivation: `ownedLoad.ts` partitions what an owner owns ONCE
 *   into buckets that ADD UP to the headline, and the button, the breakdown line, the
 *   expanded list and the minted link all read that one object.
 *   THE LOAD-BEARING ASSERTION is the last one: the "on this link" number printed on the
 *   card is compared against the questions `onMintFollowUp` is actually called with. A
 *   card that promises more than the mint sends is the defect, restated.
 *
 * · THE RAW "— TBC" TOKEN LEAKED ONTO DISCOVER CARDS.
 *   `"<Role> — TBC"` is the stored machine token for "no one named yet". The Inbox renders
 *   it as human copy through `displayPersonLabel`; Discover printed it verbatim, as though
 *   TBC were somebody's surname. One helper, applied — not a second one written.
 *
 * · ROLE OWNERS WITH NOBODY BEHIND THEM WERE INVISIBLE.
 *   The ledger owns loci by ROLE LABEL. A label no roster person answers for owns open
 *   questions with literally nobody to ask — and read as covered, because no surface said
 *   otherwise. `TheLine.tsx` even carried a comment promising "the unbound-owners strip
 *   below"; there was no strip. Every number in it is soloByOwner's own count: no person
 *   is invented to fill the gap, and the miss stays visible.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue, type QueueItem } from "@/v3/lib/ledger/projections";
import { TYPING_SLOTS } from "@/v3/lib/ledger/dictionary";
import {
  LINK_QUESTION_CAP, assertOwnedLoad, ownedLoadBreakdown, ownedLoadFor, sendableCount,
  unboundOpenTotal, unboundOwners, type OwnedLoadReads,
} from "@/v3/lib/ledger/ownedLoad";
import TheLine from "@/v3/components/flow/TheLine";

// ── the real programme ──────────────────────────────────────────────────────────────
const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const LAILA_BLOB = {
  domainOntology: snap("domain-ontology.json") as Record<string, unknown>,
  currentStateAtlas: snap("current-state-atlas.json") as Record<string, unknown>,
  flowOperatorOverrides: snap("operator-overrides.json") as unknown[],
};
const store = migrate({
  ontology: LAILA_BLOB.domainOntology,
  atlas: LAILA_BLOB.currentStateAtlas,
  overrides: LAILA_BLOB.flowOperatorOverrides as Array<Record<string, unknown>>,
} as Snapshot);
const queue = buildUnknownQueue(store);

/**
 * useProgramLedger's own three partitions, rebuilt here from the QUEUE ITEMS in that
 * loop's order — the independent witness. Nothing below reads a number back out of
 * `ownedLoad.ts`, so a bug that moved a locus between buckets cannot move both sides.
 */
const soloByOwner = new Map<string, QueueItem[]>();
const typingLoci: QueueItem[] = [];
for (const it of queue.items) {
  if (it.status === "open" && TYPING_SLOTS.has(it.slot)) { typingLoci.push(it); continue; }
  if (it.owner.kind !== "role" || it.status !== "open") continue;
  (soloByOwner.get(it.ownerLabel) ?? soloByOwner.set(it.ownerLabel, []).get(it.ownerLabel)!).push(it);
}
const LEDGER: OwnedLoadReads = { soloByOwner, typingLoci, queue };
const OWNER_LABELS = [...soloByOwner.keys()];
/** The heaviest real owner on the record — 29 solo, 4 blocked, 35 typing. The cap bites. */
const HEAVY = [...soloByOwner.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];

// ── PART A · the shape, on the real record ──────────────────────────────────────────
describe("ownedLoad — ONE partition whose buckets add up to the headline", () => {
  it("the record is worth testing on (pre-condition: a real owner the cap actually bites)", () => {
    expect(OWNER_LABELS.length).toBeGreaterThan(3);
    expect(soloByOwner.get(HEAVY)!.length).toBeGreaterThan(LINK_QUESTION_CAP);
  });

  it("owned === onLink + nextLink + blocked + toDictionary, for EVERY owner on the record", () => {
    for (const label of OWNER_LABELS) {
      const load = ownedLoadFor(LEDGER, [label]);
      expect(assertOwnedLoad(load), `${label} does not reconcile`).toBe(true);
      // …and against the independent witness, bucket by bucket.
      const solo = soloByOwner.get(label)!.length;
      const typing = typingLoci.filter((i) => i.ownerLabel === label && i.owner.kind === "role").length;
      const blocked = queue.items.filter((i) => i.status === "blocked" && i.owner.kind === "role" && i.ownerLabel === label).length;
      expect(sendableCount(load), `${label} sendable`).toBe(solo);
      expect(load.toDictionary.length, `${label} dictionary`).toBe(typing);
      expect(load.blocked.length, `${label} blocked`).toBe(blocked);
      expect(load.owned.length, `${label} headline`).toBe(solo + typing + blocked);
    }
  });

  it("a locus is in exactly ONE bucket — no double-count across a person's two owner-labels", () => {
    const both = ownedLoadFor(LEDGER, [HEAVY, HEAVY, ` ${HEAVY} `]);   // the same label three ways
    expect(both.owned.length).toBe(ownedLoadFor(LEDGER, [HEAVY]).owned.length);
    const pair = ownedLoadFor(LEDGER, OWNER_LABELS);
    expect(new Set(pair.owned.map((i) => i.about)).size).toBe(pair.owned.length);
  });

  // The source-text lockstep that used to live here — a regex over flowPortal.ts hunting
  // its bare `8` — is GONE. Both mints now import `LINK_QUESTION_CAP`, so there is one
  // declaration and nothing to keep in step; `linkQuestionCapOneDefinition.test.ts` proves
  // the mint reads THAT export by substituting it. What is left here is the card's half.
  it("the cap is the PACK's cap — a card can never promise a send the mint will truncate", () => {
    const load = ownedLoadFor(LEDGER, [HEAVY]);
    expect(load.onLink.length).toBe(LINK_QUESTION_CAP);
    expect(load.nextLink.length).toBe(soloByOwner.get(HEAVY)!.length - LINK_QUESTION_CAP);
  });

  it("the breakdown SENTENCE is arithmetic an operator can check — its parts sum to its head", () => {
    const load = ownedLoadFor(LEDGER, [HEAVY]);
    const text = ownedLoadBreakdown(load);
    const head = Number(/^(\d+) owned/.exec(text)![1]);
    const parts = [...text.slice(text.indexOf("=") + 1).matchAll(/(\d+)/g)].map((x) => Number(x[1]));
    expect(head).toBe(load.owned.length);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(head);
    expect(text).toContain(`${LINK_QUESTION_CAP} on this link`);
  });
});

describe("unboundOwners — owned by nobody on the roster, stated not swallowed", () => {
  it("every unbound label's count is soloByOwner's own; binding one removes exactly it", () => {
    const all = unboundOwners(LEDGER, []);
    expect(all.map((o) => o.label).sort()).toEqual([...OWNER_LABELS].sort());
    for (const o of all) expect(o.open).toBe(soloByOwner.get(o.label)!.length);
    expect(unboundOpenTotal(all)).toBe([...soloByOwner.values()].reduce((n, v) => n + v.length, 0));
    const bound = unboundOwners(LEDGER, [` ${HEAVY.toUpperCase()} `]);   // matched case- and space-insensitively
    expect(bound.map((o) => o.label)).not.toContain(HEAVY);
    expect(unboundOpenTotal(bound)).toBe(unboundOpenTotal(all) - soloByOwner.get(HEAVY)!.length);
  });
});

// ── PART B · the RENDERED Discover card ─────────────────────────────────────────────
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** A named person whose ROLE the ledger maps to the heaviest owner-label, plus an
 *  UNNAMED voice stored in the "<Role> — TBC" convention. Nothing else. */
const PERSON = "Asha Rao";
const PERSON_ROLE = "Head of Sales";          // → owner-label "Sales Leaders" (ownerRoleLabelForArea)
const TBC_NAME = "Fulfilment SME — TBC";
const PROGRAM = {
  id: "laila", name: "Laila CRM", client: "Laila",
  rawData: {
    data: {
      ...LAILA_BLOB,
      discoveryKit: { interviews: [{ stakeholder: PERSON, role: PERSON_ROLE, questions: ["Walk us through your part of the process."] }] },
      phaseInputs: {
        listen: {
          _directoryPeople: JSON.stringify([{ id: "dp-1", name: TBC_NAME, role: "Fulfilment", movementId: "listen" }]),
        },
      },
    },
  },
} as unknown as ProgramSummary;

let host: HTMLDivElement;
let root: Root;
/** Every `onMintFollowUp` call the card makes — the link as it is ACTUALLY minted. */
let mints: Array<{ who: string; questions: string[]; loci?: string[]; scripted?: boolean }>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mints = [];
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const mount = () => {
  act(() => {
    root.render(createElement(TheLine, {
      program: PROGRAM,
      onSaveInputs: async () => {},
      onMintFollowUp: async (input) => {
        mints.push({ who: input.who, questions: input.questions, loci: input.loci, scripted: input.scripted });
        return "https://example.test/?flowRespond=laila.tok";
      },
    }));
  });
  const discover = [...host.querySelectorAll('[role="tab"]')]
    .find((b) => text(b).startsWith("Discover")) as HTMLButtonElement;
  act(() => { discover.click(); });
};

/** The card for one person, found the way an operator finds it — by the name on it. */
const cardFor = (name: string): HTMLElement => {
  const row = [...host.querySelectorAll(".v3ln-cr")]
    .find((el) => text(el.querySelector(".v3ln-cr-who b")) === name);
  if (!row) throw new Error(`no Discover card for ${name}: ${[...host.querySelectorAll(".v3ln-cr-who b")].map((b) => text(b)).join(" | ")}`);
  return row as HTMLElement;
};

/** The three numbers, read off the card exactly as they are printed. */
const readCard = (name: string) => {
  const card = cardFor(name);
  const button = Number(/(\d+) owned question/.exec(text(card.querySelector(".v3ln-cr-qbtn")))![1]);
  const line = [...card.querySelectorAll(".v3ln-eng-why")].map(text).find((t) => /owned/.test(t)) ?? "";
  const head = Number(/(\d+) owned/.exec(line)![1]);
  const onLink = Number(/(\d+) on this link/.exec(line)?.[1] ?? 0);
  const parts = [...line.slice(line.indexOf("=") + 1).matchAll(/(\d+)/g)].map((x) => Number(x[1]));
  return { card, button, line, head, onLink, parts };
};

describe("F6 — one Discover card, ONE number, and a breakdown that reconciles it", () => {
  it("the headline button and the breakdown line are the SAME number, and the parts sum to it", () => {
    mount();
    const { button, head, parts, line } = readCard(PERSON);
    expect(button).toBeGreaterThan(LINK_QUESTION_CAP);            // pre-condition: a real load
    expect(head).toBe(button);                                    // was 10 vs 9 — two derivations
    expect(parts.reduce((a, b) => a + b, 0)).toBe(head);          // …and nothing is unaccounted for
    expect(line).toMatch(/on this link/);
  });

  it("THE LINK CARRIES WHAT THE CARD PROMISES — the card's 'on this link' count is the mint's", async () => {
    mount();
    const { card, onLink, head } = readCard(PERSON);
    expect(onLink).toBeLessThan(head);                            // pre-condition: the gap the card must explain
    const link = [...card.querySelectorAll("button")].find((b) => text(b).includes("link"))!;
    await act(async () => { link.click(); });
    expect(mints).toHaveLength(1);
    expect(mints[0].who).toBe(PERSON);
    expect(mints[0].questions.length).toBe(onLink);               // the defect: 8 sent under a "10"/"9" card
    expect(mints[0].questions.length).toBe(LINK_QUESTION_CAP);
    // locus-backed, so an answer names the point it closes — and NOT marked scripted
    expect(mints[0].loci!.every((a) => !!a && a.startsWith("el:"))).toBe(true);
    expect(mints[0].scripted).toBeUndefined();
  });

  it("the loci a link CANNOT carry stay visible in the drawer, each under a heading that says why", () => {
    mount();
    const { card } = readCard(PERSON);
    act(() => { (card.querySelector(".v3ln-cr-qbtn") as HTMLButtonElement).click(); });
    const drawer = cardFor(PERSON);

    // The seam pointer is a POINTER, not an owned question, so it sits outside the
    // sections rather than as a last row inside one. It must still be there: before
    // the seam-label fix (B3d) this person's seam wore a raw-token label their
    // identity never matched, so the one piece of work that needs a joint session
    // was invisible on their card. Its appearance is the fix.
    const seamNote = [...drawer.querySelectorAll(".v3ln-cr-seamnote")]
      .filter((el) => /seam questions .* session queue/.test(text(el)));
    expect(seamNote, "the seam pointer vanished — this person owns a seam and is not told")
      .toHaveLength(1);

    // Compare the drawer against the number THE CARD ITSELF claims, read from its
    // own headline — not against a load rebuilt here from a hand-written label
    // list. Those were two different computations that happened to agree: the
    // component derives a person's owner labels from the ledger, and once the
    // seam-label fix (B3d) made "Practices ⋈ Sales Leaders" match this person,
    // the hand-written `["Sales Leaders"]` fell one short and the drawer was
    // accused of over-rendering. The invariant that actually matters is that the
    // drawer lists exactly what the headline promises, and it is immune to how
    // the label set is derived.
    const groups = [...drawer.querySelectorAll(".v3ln-cr-qgroup")];
    const rowsIn = (g: Element) => [...g.querySelectorAll(".v3ln-cr-qs.owned > li")];
    const items = groups.flatMap(rowsIn);
    const headline = Number(/^(\d+)/.exec(text(drawer.querySelector(".v3ln-cr-qbtn")!))?.[1]);
    expect(headline, "the card's headline count is unreadable").toBeGreaterThan(0);
    expect(items.length, "the drawer must list every locus the headline counts").toBe(headline);

    // The link's payload is exactly the on-link section — the bucket the breakdown
    // named and the mint will send.
    const onLinkGroup = groups.find((g) => g.classList.contains("on-link"))!;
    expect(onLinkGroup, "no on-link section — the sendable questions lost their heading").toBeTruthy();
    expect(rowsIn(onLinkGroup)).toHaveLength(LINK_QUESTION_CAP);

    // Everything that cannot ride is still ACCOUNTED FOR, and its reason is stated
    // where the reason belongs — once, on the group.
    for (const g of groups) {
      const heading = text(g.querySelector(".v3ln-cr-qgroup-h")!);
      const note = text(g.querySelector(".v3ln-cr-qgroup-note")!);
      expect(heading.trim().length, "a section with no heading").toBeGreaterThan(0);
      expect(note.trim().length, "a section with no reason").toBeGreaterThan(0);
      expect(heading, "the heading must carry its own count").toContain(String(rowsIn(g).length));
      expect(rowsIn(g).length, "an empty section was rendered").toBeGreaterThan(0);
    }
    // A bucket that isn't on this card doesn't get a heading over nothing.
    expect(groups.length).toBeLessThanOrEqual(4);
  });

  it("REGRESSION: the reason a bucket can't ride is stated ONCE, not on every row", () => {
    // The Head of Marketing card printed "answered by the data dictionary, not by
    // them" ten times — once per typing question — down the side of the drawer. One
    // fact, restated until it read as noise, crowding out the questions themselves.
    mount();
    const { card } = readCard(PERSON);
    act(() => { (card.querySelector(".v3ln-cr-qbtn") as HTMLButtonElement).click(); });
    const drawer = cardFor(PERSON);

    for (const g of [...drawer.querySelectorAll(".v3ln-cr-qgroup")]) {
      const rows = [...g.querySelectorAll(".v3ln-cr-qs.owned > li")];
      expect(rows.length).toBeGreaterThan(0);
      // Not one row repeats the bucket's reason.
      const echoed = rows.filter((li) => /answered by the data dictionary|next link|unstick|dictionary upload/i.test(text(li)));
      expect(echoed, "the group's reason is repeated on its rows").toHaveLength(0);
    }
    // COLLAPSE IS NOT CONCEALMENT. The dictionary section starts closed, but every
    // row is still in the document and still counted by the headline — a card that
    // dropped them to look tidy is the defect this whole file exists to prevent.
    const dict = drawer.querySelector(".v3ln-cr-qgroup.dictionary") as HTMLDetailsElement | null;
    if (dict) {
      expect(dict.open, "the dictionary wall is open by default again").toBe(false);
      expect(dict.querySelectorAll(".v3ln-cr-qs.owned > li").length).toBeGreaterThan(0);
      expect(dict.querySelector("summary"), "a disclosure with no summary cannot be opened").toBeTruthy();
    }
    for (const g of [...drawer.querySelectorAll(".v3ln-cr-qgroup")] as HTMLDetailsElement[]) {
      if (g === dict) continue;
      expect(g.open, "a section addressed to this person is hidden behind a click").toBe(true);
    }

    // And the dictionary sentence appears at most once in the whole drawer.
    const occurrences = text(drawer).match(/data dictionary/gi) ?? [];
    expect(occurrences.length, "the dictionary fact is stated more than once").toBeLessThanOrEqual(1);
  });
});

describe("the '— TBC' machine token never reaches a Discover card", () => {
  it("the roster placeholder reads as human copy, through the ONE existing helper", () => {
    mount();
    const discover = text(host.querySelector('[aria-label="Discover"]'));
    expect(discover).not.toMatch(/—\s*TBC\b/);
    expect(discover).toContain("Fulfilment SME — no one named yet");
    // …and the stored token is still the write key: the capture dialog's option VALUE.
    const add = [...host.querySelectorAll("button")].find((b) => text(b).includes("add to the record"))!;
    act(() => { add.click(); });
    const opt = [...host.querySelectorAll("option")].find((o) => (o as HTMLOptionElement).value === TBC_NAME);
    expect(opt, "the stored label must remain the option value").toBeTruthy();
    expect(text(opt!)).toContain("no one named yet");
  });
});

describe("role owners with nobody behind them are VISIBLE on Discover", () => {
  it("the strip states the miss, with soloByOwner's own counts and no invented person", () => {
    mount();
    const strip = host.querySelector('[aria-label="Owned by nobody on the roster"]');
    expect(strip, "no unbound-owner strip rendered").toBeTruthy();
    const pills = [...strip!.querySelectorAll(".v3ln-engpill")].slice(1).map(text);
    const listed = pills.map((t) => {
      const m = /^(.*) · (\d+)$/.exec(t)!;
      return { label: m[1].trim(), open: Number(m[2]) };
    });
    expect(listed.length).toBeGreaterThan(0);
    // Every count is the ledger's own, and the roster-bound owner is NOT in here.
    for (const o of listed) expect(o.open, o.label).toBe(soloByOwner.get(o.label)?.length);
    expect(listed.map((o) => o.label)).not.toContain("Sales Leaders");
    expect(listed.map((o) => o.label)).toContain("Talent Acquisition");
    // The headline is the sum of the roles it lists — one number, not a second count.
    const total = Number(/(\d+) open question/.exec(text(strip))![1]);
    expect(total).toBe(listed.reduce((n, o) => n + o.open, 0));
  });
});
