/**
 * THE SAME QUESTION, FORTY-SEVEN TIMES, OPEN-ENDED.
 *
 * The typing wall presented as rows of "What type of value is Account.X?" — one
 * per field, each demanding a typed answer. Measured on Laila New, every one of
 * the 30 that survived the derivation ALREADY had a reading; they were only below
 * the confidence at which a guess may be asserted. The knowledge was being thrown
 * away at the moment it was most useful.
 *
 * The grid turns that around: the reading becomes the DEFAULT, the rows group by
 * the answer (because that is the unit the operator is deciding), and a group is
 * confirmed in one act.
 *
 * The rules that keep it honest, and what each guards against:
 *   · a suggestion is never written — only a confirmation is, and it is recorded
 *     as the OPERATOR'S statement through the same dictionary path an upload uses;
 *   · a row left unanswered stays an open question;
 *   · the fields Aura could not read are separated out, because those are the
 *     only ones genuinely owed a real answer.
 */
import { describe, it, expect } from "vitest";
import { typingRows, confirmedCsv, type TypingRow } from "@/v3/components/flow/TypingGrid";
import { parseDictionaryCsv } from "@/v3/lib/ledger/dictionary";
import { attrLocusId } from "@/v3/lib/ledger/dictionary";

const row = (entity: string, attribute: string, suggested = "", confidence = 0): TypingRow => ({
  about: `${attrLocusId(entity, attribute)}#dataType`, entity, attribute, suggested, confidence,
});

describe("what a confirmation writes", () => {
  const rows = [row("Account", "segment", "picklist", 0.6), row("Account", "GST number", "code", 0.65)];

  it("REGRESSION: it emits the exact shape an uploaded dictionary does", () => {
    // The whole point of routing through the dictionary path: no new write
    // mechanism, no new precedence, and a later real dictionary corrects it row
    // for row. If this stopped parsing, confirmations would land nowhere.
    const parsed = parseDictionaryCsv(confirmedCsv(rows, {}));
    expect(parsed.fields).toHaveLength(2);
    expect(parsed.fields[0]).toMatchObject({ entity: "Account", field: "segment", dataType: "picklist" });
  });

  it("and the rows key back to the loci they answer", () => {
    // The names must survive the round trip: entity/attribute → CSV → slug → locus.
    const parsed = parseDictionaryCsv(confirmedCsv(rows, {}));
    for (const f of parsed.fields) {
      expect(rows.some((r) => r.about === `${attrLocusId(f.entity, f.field)}#dataType`)).toBe(true);
    }
  });

  it("REGRESSION: an unanswered row writes nothing — it stays a question", () => {
    const csv = confirmedCsv([row("Account", "mystery")], {});
    expect(csv, "a field with no type was recorded as having one").toBe("");
  });

  it("the operator's choice beats the suggestion", () => {
    const csv = confirmedCsv(rows, { [rows[0].about]: "text" });
    const parsed = parseDictionaryCsv(csv);
    expect(parsed.fields.find((f) => f.field === "segment")!.dataType).toBe("text");
  });

  it("a name with a comma survives the CSV it is written into", () => {
    const parsed = parseDictionaryCsv(confirmedCsv([row("Account", "name, legal", "text")], {}));
    expect(parsed.fields[0].field).toBe("name, legal");
  });

  it("confirming a SUBSET writes only that subset", () => {
    // Confirm-per-group must never quietly record the rows in other groups.
    const csv = confirmedCsv([rows[0]], {});
    expect(parseDictionaryCsv(csv).fields.map((f) => f.field)).toEqual(["segment"]);
  });
});

describe("the rows it offers", () => {
  const ledger = (typingLoci: Array<{ about: string }>, elements: Array<Record<string, unknown>>, suggestions: unknown[] = []) =>
    ({ typingLoci, typeSuggestions: suggestions, store: { elements: () => elements } }) as never;

  it("resolves the NAMES a person recognises, not the slugs", () => {
    const rows = typingRows(ledger(
      [{ about: "el:attr:account.gst-number#dataType" }],
      [{ id: "el:entity:account", kind: "entity", name: "Account" },
        { id: "el:attr:account.gst-number", kind: "attribute", name: "GST number", of: "el:entity:account" }],
    ));
    expect(rows).toEqual([expect.objectContaining({ entity: "Account", attribute: "GST number" })]);
  });

  it("carries the suggestion and its strength", () => {
    const rows = typingRows(ledger(
      [{ about: "el:attr:account.segment#dataType" }],
      [{ id: "el:entity:account", kind: "entity", name: "Account" },
        { id: "el:attr:account.segment", kind: "attribute", name: "segment", of: "el:entity:account" }],
      [{ about: "el:attr:account.segment#dataType", dataType: "picklist", confidence: 0.6 }],
    ));
    expect(rows[0]).toMatchObject({ suggested: "picklist", confidence: 0.6 });
  });

  it("a locus with no suggestion is still offered, with no default", () => {
    // These are the ones genuinely owed an answer — they must not be dropped.
    const rows = typingRows(ledger(
      [{ about: "el:attr:account.mystery#dataType" }],
      [{ id: "el:entity:account", kind: "entity", name: "Account" },
        { id: "el:attr:account.mystery", kind: "attribute", name: "mystery", of: "el:entity:account" }],
    ));
    expect(rows[0].suggested).toBe("");
  });

  it("non-dataType typing loci are not offered here", () => {
    // valueSet and optionality are different questions; a type control cannot
    // answer "which values can this take?".
    expect(typingRows(ledger(
      [{ about: "el:attr:account.segment#valueSet" }],
      [{ id: "el:entity:account", kind: "entity", name: "Account" },
        { id: "el:attr:account.segment", kind: "attribute", name: "segment", of: "el:entity:account" }],
    ))).toHaveLength(0);
  });

  it("an attribute whose entity is unknown is skipped, never guessed", () => {
    expect(typingRows(ledger(
      [{ about: "el:attr:ghost.field#dataType" }],
      [{ id: "el:attr:ghost.field", kind: "attribute", name: "field", of: "el:entity:ghost" }],
    ))).toHaveLength(0);
  });
});
