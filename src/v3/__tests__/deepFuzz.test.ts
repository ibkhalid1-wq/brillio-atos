/**
 * CHECK 4 — RENDERER FUZZ (deep validation, 2026-08-11).
 *
 * INVARIANT: for EVERY element name a programme can carry — the longest, and the
 * strangest (unicode/accents, quotes, punctuation, ampersands, single character,
 * all-caps acronyms, names carrying `#` or `:`, and the maximal-length name present)
 * — the ONE renderer (`renderQuestion.ts`) produces a whole question: it does not
 * throw, the name appears VERBATIM AND COMPLETE, no truncation artifact, no arrow
 * notation, original casing, and the locus round-trips (`elementIdOf`/`slotOf`
 * recover exactly the id and slot the question was asked for).
 *
 * Truncation for LAYOUT is a display concern (CSS + full text on hover). It must
 * never happen in the STRING, so every assertion below is on the string.
 *
 * SYNTHETIC vs PRESENT. Neither programme actually carries every strange class —
 * Laila has ampersands (5), one all-caps acronym ("SOW") and heavy punctuation, but
 * ZERO accented/unicode names, ZERO single-character names and ZERO names carrying
 * `#` or `:`; the surgery mirror carries none of them. Those classes are SYNTHESISED
 * into a scratch snapshot (`strangeSnapshot`, migrated into a throwaway store) so the
 * class is genuinely exercised rather than silently skipped. Every synthetic case is
 * tagged `[synthetic]` in its test name. No real snapshot is mutated.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue } from "@/v3/lib/ledger/projections";
import { renderQuestion } from "@/v3/lib/ledger/renderQuestion";
import { createLedgerStore, type LedgerStore } from "@/v3/lib/ledger/store";
import { aboutOf, elementIdOf, slotOf, type LedgerElement } from "@/v3/lib/ledger/types";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const laila = (): LedgerStore => migrate({
  ontology: snap("domain-ontology.json"),
  atlas: snap("current-state-atlas.json"),
  overrides: snap("operator-overrides.json"),
} as Snapshot);

// The synthetic surgery mirror — the same shape the existing suites use (the LIVE
// surgery programme is DB-only in this environment).
const surgerySnapshot = (): Snapshot => ({
  ontology: {
    entities: [
      { name: "Case", area: "Surgical Operations", systemOfRecord: "EHR", attributes: ["status", "priority", "acuity"] },
      { name: "Anesthesia Record", area: "Anesthesiology", systemOfRecord: "EHR", attributes: ["type"] },
      { name: "OR Slot", area: "Surgical Scheduling", attributes: ["state"] },
    ],
    relations: [{ from: "Case", to: "Anesthesia Record", relation: "requires", cardinality: "1:1" }],
  },
  atlas: {
    workflows: [{
      name: "Pre-op Authorization", area: "Surgical Operations", owner: "Chief of Surgery", trigger: "case booked",
      steps: [
        { action: "Review the pre-authorization request against the payer's clinical criteria and the surgeon's documented plan before scheduling can proceed", actor: "Pre-Auth Coordinator" },
        { action: "Decide whether to reschedule or cancel the case after payer review", actor: "Surgeon" },
      ],
    }],
  },
  overrides: [],
});

// ── the pass-1 D1 artifact list, reused VERBATIM, plus the needles found this pass ──
// (`undefined`/`null`/`NaN`/`[object Object]` are stringification leaks; the two
// relation placeholders are the renderer's own fabricated endpoint names.)
const ARTIFACTS = [" the be ", " to pre be", " and u —", "…", "..."];
const STRINGIFY_LEAKS = ["undefined", "[object Object]", "NaN"];
const RELATION_PLACEHOLDERS = ["one thing", "another"];

const byId = (store: LedgerStore) => new Map(store.elements().map((e) => [e.id, e] as const));

/** The step normalisation the renderer applies before quoting: trailing whitespace and
 *  a trailing sentence period are dropped so the template can add `."`. That is a
 *  deliberate normalisation, NOT truncation — the body must still be whole. */
const quotedForm = (name: string): string => name.trim().replace(/[.\s]+$/, "");

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * THE per-name assertion. Runs both audiences over one locus.
 * `why` names the class under test so a failure says which one broke.
 */
function assertWholeQuestion(store: LedgerStore, about: string, why: string): void {
  const els = byId(store);
  for (const audience of ["stakeholder", "operator"] as const) {
    let r: ReturnType<typeof renderQuestion>;
    expect(() => { r = renderQuestion(store, about, audience); }, `${why}: renderer threw on ${about}`).not.toThrow();
    r = renderQuestion(store, about, audience);
    const q = r.question;
    const ctx = `${why} · ${audience} · ${about} · "${q}"`;

    // — the locus ROUND-TRIPS: what came back is the id and slot that were asked for —
    expect(r.id, ctx).toBe(about);
    expect(r.elementId, ctx).toBe(elementIdOf(about));
    expect(r.kind, ctx).toBe(slotOf(about));
    expect(`${r.elementId}#${r.kind}`, `${ctx}: locus did not reassemble`).toBe(about);

    // — a question is never empty, never truncated, never arrow notation —
    expect(q.trim().length, ctx).toBeGreaterThan(0);
    for (const bad of ARTIFACTS) expect(q.includes(bad), `${ctx} contains truncation artifact "${bad}"`).toBe(false);
    for (const bad of STRINGIFY_LEAKS) expect(q.includes(bad), `${ctx} leaks "${bad}"`).toBe(false);
    expect(q.includes("→"), `${ctx} uses arrow notation`).toBe(false);

    const el = els.get(r.elementId);
    if (el?.kind === "relation") {
      // A relation names its ENDPOINTS in plain language; its own element name is the
      // arrow form and must never reach the text. Both endpoints resolve here, so the
      // renderer's fabricated placeholders must not appear either.
      const from = els.get(el.refs?.from ?? "")?.name;
      const to = els.get(el.refs?.to ?? "")?.name;
      if (from) expect(q.includes(from), `${ctx} dropped endpoint "${from}"`).toBe(true);
      if (to) expect(q.includes(to), `${ctx} dropped endpoint "${to}"`).toBe(true);
      if (from && to) {
        // Both endpoints resolve, so the renderer's own placeholder names must not appear.
        for (const p of RELATION_PLACEHOLDERS) {
          if (from.includes(p) || to.includes(p)) continue;
          expect(q.includes(p), `${ctx} fabricated the endpoint placeholder "${p}"`).toBe(false);
        }
      }
      continue;
    }

    // — the name appears VERBATIM AND COMPLETE (this is also the no-truncation proof) —
    const needle = el?.kind === "step" ? quotedForm(r.elementName) : r.elementName;
    expect(needle.length, ctx).toBeGreaterThan(0);
    expect(q.includes(needle), `${ctx} does not carry the full name "${needle}"`).toBe(true);

    // — ORIGINAL CASING: strip every verbatim occurrence; the lowercased form must not
    //   survive anywhere else in the string (the old mid-template lowercasing bug) —
    const lowered = needle.toLowerCase();
    if (lowered !== needle) {
      const residue = q.split(needle).join(" ");
      // WORD-BOUNDED: a one-letter name like "X" lowercases to "x", which occurs inside
      // ordinary words ("exactly"). Only a standalone lowercased occurrence is the bug.
      const bounded = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(lowered)}([^A-Za-z0-9]|$)`);
      expect(bounded.test(residue), `${ctx} lowercased the name mid-template`).toBe(false);
    }

    // — the elementName FIELD itself is the untruncated display name —
    if (el?.kind === "step") {
      const action = store.resolve(`${r.elementId}#action`).live
        .find((c) => c.value.kind === "scalar") as { value: { value: unknown } } | undefined;
      if (action) expect(r.elementName, `${ctx}: elementName is not the full action`).toBe(String(action.value.value));
    }
  }
}

/** Every element that carries at least one OPEN locus, with its rendered display name. */
function namedElements(store: LedgerStore): Array<{ elementId: string; name: string; abouts: string[]; kind: string }> {
  const open = buildUnknownQueue(store).items.filter((i) => i.status === "open");
  const els = byId(store);
  const acc = new Map<string, { elementId: string; name: string; abouts: string[]; kind: string }>();
  for (const i of open) {
    const eid = elementIdOf(i.about);
    const row = acc.get(eid);
    if (row) { row.abouts.push(i.about); continue; }
    acc.set(eid, {
      elementId: eid,
      name: renderQuestion(store, i.about, "stakeholder").elementName,
      abouts: [i.about],
      kind: els.get(eid)?.kind ?? "unknown",
    });
  }
  return [...acc.values()];
}

// ════════════════════════════════════════════════════════════════════════════════
// 4a · THE 20 LONGEST NAMES — both programmes, every open locus on each
// ════════════════════════════════════════════════════════════════════════════════
for (const [program, build] of [["Laila (real snapshot)", laila], ["surgery (synthetic mirror)", () => migrate(surgerySnapshot())]] as const) {
  describe(`[4a] longest element names — ${program}`, () => {
    const store = build();
    const rows = namedElements(store).sort((a, b) => b.name.length - a.name.length);
    const longest = rows.slice(0, 20);

    it("there is something to fuzz (the fixture actually loaded)", () => {
      expect(rows.length).toBeGreaterThan(0);
      expect(longest[0].name.length).toBeGreaterThan(20);
    });

    it("the MAXIMAL-length name present renders whole, on every one of its open loci", () => {
      const max = longest[0];
      expect(max.abouts.length).toBeGreaterThan(0);
      for (const about of max.abouts) assertWholeQuestion(store, about, `maximal-length (${max.name.length} chars)`);
    });

    it("the 20 longest names render whole, on every one of their open loci, both audiences", () => {
      expect(longest.length).toBeGreaterThan(0);
      for (const row of longest) {
        for (const about of row.abouts) assertWholeQuestion(store, about, `longest#${row.name.length}`);
      }
    });

    it("a step's 60-char migration cut never reaches the text — the FULL action does", () => {
      const steps = rows.filter((r) => r.kind === "step" && r.name.length > 60);
      // Laila carries these; the surgery mirror's long action is deliberate.
      expect(steps.length).toBeGreaterThan(0);
      for (const s of steps.slice(0, 20)) {
        const q = renderQuestion(store, s.abouts[0], "stakeholder").question;
        expect(q.includes(quotedForm(s.name))).toBe(true);
        // the cut, followed by the closing quote, would be the truncation signature
        expect(q.includes(`${s.name.slice(0, 60)}."`), `truncated at the 60-char cut: "${q}"`).toBe(false);
      }
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// 4b · THE STRANGE CLASSES — which are PRESENT, which are SYNTHESISED
// ════════════════════════════════════════════════════════════════════════════════

/** The classes this check must cover, as predicates over a display name. */
const CLASSES: Array<[string, (n: string) => boolean]> = [
  ["unicode/accents", (n) => [...n].some((ch) => ch.charCodeAt(0) > 127)],
  ["quotes", (n) => /["'‘’“”]/.test(n)],
  ["punctuation", (n) => /[(),;:!?/\\[\]{}]/.test(n)],
  ["ampersand", (n) => n.includes("&")],
  ["single character", (n) => n.trim().length === 1],
  ["all-caps acronym", (n) => /^[A-Z0-9]{2,8}$/.test(n.trim())],
  ["hash or colon in the name", (n) => /[#:]/.test(n)],
];

describe("[4b] which strange classes each programme actually carries (census, not an assertion of health)", () => {
  for (const [program, build] of [["Laila", laila], ["surgery", () => migrate(surgerySnapshot())]] as const) {
    it(`${program}: census is stable and NON-empty classes are covered from real data`, () => {
      const rows = namedElements(build());
      const names = rows.map((r) => r.name);
      const census = Object.fromEntries(CLASSES.map(([label, p]) => [label, names.filter(p).length]));
      // Pinned so a fixture change that silently removes a covered class is visible.
      expect(Object.keys(census)).toHaveLength(CLASSES.length);
      if (program === "Laila") {
        expect(census["ampersand"]).toBeGreaterThan(0);          // "…Strategy & Deal Shaping"
        expect(census["punctuation"]).toBeGreaterThan(0);
        // The ONLY non-ASCII in Laila's display names is the `→` inside a RELATION's own
        // element name (`Account→Opportunity`). No human-authored accent exists in the
        // record, so the accent class is synthesised in 4c. Pinned here because it is
        // also the evidence for finding F-4.2: relation element names carry arrow
        // notation in `RenderedQuestion.elementName` even though the QUESTION never does.
        const unicodeRows = rows.filter((r) => CLASSES[0][1](r.name));
        expect(unicodeRows.length).toBe(35);
        expect(unicodeRows.every((r) => r.kind === "relation" && r.name.includes("→"))).toBe(true);
        // NOT present among the names that reach a question → synthesised in 4c below.
        // NOTE on "all-caps acronym": Laila DOES hold one ("SOW"), but it is an ENTITY
        // with no open locus, so it never becomes a rendered display name. The class is
        // therefore covered synthetically ("EHR"/"FHIR" in 4c), not skipped.
        expect(census["quotes"]).toBe(0);
        expect(census["single character"]).toBe(0);
        expect(census["all-caps acronym"]).toBe(0);
        expect(census["hash or colon in the name"]).toBe(0);
      }
    });
  }
});

/**
 * FINDING F-4.2, pinned as a test so it cannot regress silently in either direction.
 *
 * The no-arrow rule is enforced on `question` and holds everywhere. It is NOT enforced
 * on `RenderedQuestion.elementName`, which for a RELATION is the element's own name —
 * `Account→Opportunity`. `kitProjection.projectKitQuestions` copies that field into
 * `KitQuestion.locusName`, i.e. into the stakeholder-facing kit payload. No surface
 * renders `locusName` today (grep: the field has no consumer), so this is LATENT, not
 * live. The test asserts both halves: the arrow IS in elementName/locusName, and it is
 * NOT in the question.
 */
describe("[4b] LATENT: arrow notation survives in elementName/locusName, never in the question", () => {
  it("a relation's elementName carries `→` while its question does not", () => {
    const store = laila();
    const rel = buildUnknownQueue(store).items
      .find((i) => i.status === "open" && i.about.startsWith("el:rel"));
    expect(rel, "the Laila fixture holds no open relation locus").toBeTruthy();
    const r = renderQuestion(store, rel!.about, "stakeholder");
    expect(r.elementName).toContain("→");     // the leak (latent — no surface reads it)
    expect(r.question).not.toContain("→");    // the invariant that IS enforced
  });
});

describe("[4b] the classes Laila DOES carry, fuzzed on the real snapshot (not synthetic)", () => {
  const store = laila();
  const rows = namedElements(store);
  for (const [label, pred] of CLASSES) {
    const hits = rows.filter((r) => pred(r.name));
    if (!hits.length) continue;    // synthesised in 4c instead
    it(`${label}: ${hits.length} real name(s) render whole`, () => {
      for (const row of hits.slice(0, 20)) {
        for (const about of row.abouts.slice(0, 6)) assertWholeQuestion(store, about, `${label} (real)`);
      }
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// 4c · SYNTHESISED strange names — scratch snapshot, migrated into a throwaway store
// ════════════════════════════════════════════════════════════════════════════════

/** 240 chars — deliberately longer than anything either programme holds (Laila's
 *  maximum display name is 136), so "the maximal-length name" is also fuzzed BEYOND
 *  what the record happens to contain today. */
const MAXIMAL = "Reconcile the payer's pre-authorisation determination against the surgeon's documented operative plan, the anaesthesia record, the theatre slot reservation and the patient's financial-clearance status before the case may be released for scheduling";

/** SYNTHETIC. Every name here is invented for this check — see the header note. */
const strangeSnapshot = (): Snapshot => ({
  ontology: {
    entities: [
      { name: "Dossier Médical Partagé", area: "Sales", attributes: ["état"] },                       // accents
      { name: "Ürgent Case (Ø-priority)", area: "Finance", attributes: ["status"] },                  // unicode + punctuation
      { name: "Payer’s “Clinical Criteria”", area: "Legal", attributes: ["type"] },                   // curly quotes + apostrophe
      { name: "Billing & Coding / Claims; Denials", area: "Finance", attributes: ["category"] },       // ampersand, slash, semicolon
      { name: "X", area: "Sales", attributes: ["state"] },                                            // single character
      { name: "EHR", area: "Delivery", attributes: ["tier"] },                                        // all-caps acronym
      { name: "FHIR", area: "Delivery", attributes: ["priority"] },                                   // all-caps acronym
      { name: "Case #7: Priority", area: "Sales", attributes: ["severity"] },                          // `#` AND `:` in the NAME
      { name: "el:entity:case#semantics", area: "Legal", attributes: ["status"] },                     // a name shaped like a LOCUS
      { name: MAXIMAL, area: "Sales", attributes: ["outcome"] },                                       // maximal length
    ],
    relations: [
      { from: "Dossier Médical Partagé", to: "Case #7: Priority", relation: "requires", cardinality: "1:N" },
      { from: "X", to: "EHR", relation: "produces" },
    ],
    // An ambiguity opens a `#semantics` locus on the ENTITY itself, which is the only
    // way an entity's own name (rather than "Entity.attribute") becomes a rendered
    // display name — that is how the single-character and all-caps-acronym classes get
    // exercised on the name in isolation.
    ambiguities: [
      { term: "Case #7: Priority", conflictingMeanings: ["a théâtre booking", "a “billing episode”"], resolution: "unresolved" },
      { term: "X", conflictingMeanings: ["the unnamed placeholder entity"], resolution: "unresolved" },
      { term: "EHR", conflictingMeanings: ["the clinical record", "the billing record"], resolution: "unresolved" },
      { term: "Dossier Médical Partagé", conflictingMeanings: ["le dossier national"], resolution: "unresolved" },
      { term: "el:entity:case#semantics", conflictingMeanings: [], resolution: "unresolved" },
    ],
  },
  atlas: {
    workflows: [{
      name: "Ürgent Review & Release",
      area: "Surgical Operations",
      owner: "Chief of Surgery",
      trigger: "case booked",
      steps: [
        { action: MAXIMAL, actor: "Pre-Auth Coordinator" },
        { action: "Review “Case #7: Priority” against el:entity:case#semantics — approve, or route to Billing & Coding / Claims; Denials", actor: "Surgeon" },
        { action: "X", actor: "Surgeon" },
      ],
    }],
  },
  overrides: [],
});

describe("[4c] SYNTHETIC strange names — every class the two programmes lack", () => {
  const store = migrate(strangeSnapshot());
  const rows = namedElements(store);

  it("[synthetic] the scratch store actually holds each class (the fixture is doing its job)", () => {
    const names = rows.map((r) => r.name);
    for (const [label, pred] of CLASSES) {
      expect(names.some(pred), `[synthetic] no name covers the class "${label}"`).toBe(true);
    }
    expect(names.some((n) => n.length >= 200), "[synthetic] the maximal name did not survive migration").toBe(true);
  });

  it("[synthetic] EVERY open locus in the strange store renders whole, both audiences", () => {
    const open = buildUnknownQueue(store).items.filter((i) => i.status === "open");
    expect(open.length).toBeGreaterThan(20);
    for (const i of open) assertWholeQuestion(store, i.about, "[synthetic] whole-store sweep");
  });

  for (const [label, pred] of CLASSES) {
    it(`[synthetic] ${label} renders verbatim, complete, original casing`, () => {
      const hits = rows.filter((r) => pred(r.name));
      expect(hits.length, `[synthetic] class "${label}" not represented`).toBeGreaterThan(0);
      for (const row of hits) for (const about of row.abouts) assertWholeQuestion(store, about, `[synthetic] ${label}`);
    });
  }

  it("[synthetic] a 240-char name is carried WHOLE — no ellipsis, no cut, in either audience", () => {
    const max = rows.find((r) => r.name.length >= 200);
    expect(max, "[synthetic] maximal-length element missing").toBeTruthy();
    for (const about of max!.abouts) {
      for (const audience of ["stakeholder", "operator"] as const) {
        const q = renderQuestion(store, about, audience).question;
        expect(q.includes(quotedForm(MAXIMAL))).toBe(true);
        expect(q.includes("…")).toBe(false);
        expect(q.length).toBeGreaterThan(MAXIMAL.length);
      }
    }
  });

  it("[synthetic] a name containing `#` and `:` survives verbatim in the QUESTION and does not corrupt its locus", () => {
    const row = rows.find((r) => r.name === "Case #7: Priority");
    expect(row, "[synthetic] the `#`/`:` name is missing").toBeTruthy();
    for (const about of row!.abouts) {
      // the id was slugged, so the locus itself is unambiguous…
      expect(about.split("#")).toHaveLength(2);
      expect(elementIdOf(about)).toBe(row!.elementId);
      // …and the punctuation lives in the NAME, which is reproduced verbatim
      expect(renderQuestion(store, about, "stakeholder").question).toContain("Case #7: Priority");
    }
  });

  it("[synthetic] a name shaped like a LOCUS (`el:entity:case#semantics`) is text, not a locus — it never re-parses", () => {
    const row = rows.find((r) => r.name === "el:entity:case#semantics");
    expect(row).toBeTruthy();
    expect(row!.elementId).not.toContain("#");
    const q = renderQuestion(store, row!.abouts[0], "stakeholder").question;
    expect(q).toContain("el:entity:case#semantics");
  });

  it("[synthetic] the meaning question names unicode/quoted rival readings verbatim", () => {
    const about = `${rows.find((r) => r.name === "Case #7: Priority")!.elementId}#semantics`;
    const q = renderQuestion(store, about, "stakeholder").question;
    expect(q).toContain("a théâtre booking");
    expect(q).toContain("a “billing episode”");
    expect(q).not.toContain("…");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 4d · THE LOCUS FORMAT ITSELF — `<elementId>#<slot>` under hostile ids
// ════════════════════════════════════════════════════════════════════════════════
describe("[4d] locus round-trip under ids that collide with the `#` separator", () => {
  it("EXTRA COLONS in an element id round-trip cleanly (the separator is `#`, not `:`)", () => {
    const el: LedgerElement = { id: "el:entity:acme:emea:case:v2", kind: "entity", name: "Case (EMEA, v2)" };
    const store = createLedgerStore({ elements: [el] });
    const about = aboutOf(el.id, "semantics");
    store.assert({ about, value: { kind: "unknown" }, world: "to-be", layer: "domain", source: "generated", ownerWhileOpen: { kind: "unowned" }, status: "open" });
    expect(elementIdOf(about)).toBe(el.id);
    expect(slotOf(about)).toBe("semantics");
    const r = renderQuestion(store, about, "stakeholder");
    expect(r.elementId).toBe(el.id);
    expect(r.kind).toBe("semantics");
    expect(r.question).toContain("Case (EMEA, v2)");
  });

  it("a slot name containing a DOT round-trips (`touches.foo`, `semantics.reading.x` are real slots)", () => {
    const el: LedgerElement = { id: "el:entity:case", kind: "entity", name: "Case" };
    const store = createLedgerStore({ elements: [el] });
    for (const slot of ["touches.anesthesia-record", "semantics.reading.a-billing-episode", "alias.case-file"]) {
      const about = aboutOf(el.id, slot);
      expect(elementIdOf(about)).toBe(el.id);
      expect(slotOf(about)).toBe(slot);
      const r = renderQuestion(store, about, "operator");
      expect(r.elementId).toBe(el.id);
      expect(r.kind).toBe(slot);
      expect(r.question).toContain("Case");
    }
  });

  /**
   * THE GUARD IS THE PRODUCER, NOT THE PARSER — stated as an assertion so it cannot
   * silently stop being true.
   *
   * `elementIdOf`/`slotOf` split on the FIRST `#` (types.ts:124-125). An element id
   * containing `#` would therefore mis-split SILENTLY — the parser has no refusal path.
   * It is safe today only because every id producer slugs the name first
   * (`migrate.ts` slug, `dictionary.ts` slug, `curation.ts` PROPOSED_ID_PREFIX), and
   * slug strips `#`. This test pins BOTH halves: the guard holds, and the mis-split it
   * is guarding against is real. See the report finding "F-4.1".
   */
  it("NO producer can emit an element id containing `#` — the slug is the guard", () => {
    const store = migrate(strangeSnapshot());
    for (const e of store.elements()) expect(e.id.includes("#"), `id carries the separator: ${e.id}`).toBe(false);
    for (const c of store.claims()) expect(c.about.split("#"), `about is not a clean pair: ${c.about}`).toHaveLength(2);
  });

  it("DEMONSTRATED DEFECT (unreachable today): a hand-built id containing `#` mis-splits SILENTLY", () => {
    const hostile = "el:entity:case#note";
    const about = aboutOf(hostile, "semantics");           // "el:entity:case#note#semantics"
    // The parser neither round-trips nor refuses — it takes the FIRST `#`:
    expect(elementIdOf(about)).toBe("el:entity:case");     // NOT the element that was asked for
    expect(slotOf(about)).toBe("note#semantics");          // NOT the slot that was asked for
    expect(elementIdOf(about)).not.toBe(hostile);
    // And the renderer follows the parser: it renders a question about an element that
    // does not exist, with a name reverse-engineered from the id, rather than refusing.
    const store = createLedgerStore({ elements: [{ id: hostile, kind: "entity", name: "Case Note" }] });
    const r = renderQuestion(store, about, "stakeholder");
    expect(r.elementId).toBe("el:entity:case");
    expect(r.question).not.toContain("Case Note");         // the real name is lost
    expect(r.question.trim().length).toBeGreaterThan(0);   // …and nothing warns
  });
});
