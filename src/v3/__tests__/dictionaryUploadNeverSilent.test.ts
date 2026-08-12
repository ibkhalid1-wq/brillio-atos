/**
 * "I CLICKED UPLOAD, ATTACHED A FILE, AND NOTHING HAPPENED."
 *
 * Reported from the running app, and reproducible. Three independent defects in
 * one path, each of which alone produces total silence:
 *
 *  1. `readDictionaryFile` was `async` with NO try/catch, and its only caller
 *     invoked it as `void readDictionaryFile(...)`. Every throw on that path —
 *     `file.arrayBuffer()`, the dynamic `import("xlsx")`, `XLSX.read` on a
 *     corrupt or password-protected workbook, `text()` on a binary blob — became
 *     a discarded promise rejection. No preview, no error, no console line.
 *
 *  2. The preview rendered ONLY in the row whose `sor` matched
 *     (`dictPreview.sor === sor`), and `pendingSor` is a ref that was never
 *     reset — not on discard, not on commit. A stale or null value routed the
 *     preview to a row the operator was not looking at, or to no row at all.
 *
 *  3. There was no error state to render even if something had been caught.
 *
 * WHY SILENCE IS THE WORST OUTCOME: the operator's next move is to attach the
 * file again and watch nothing happen again. A visible failure costs them one
 * read; an invisible one costs them their confidence in the surface.
 *
 * These assertions are structural (the component is a 700-line inline render
 * with refs), but each names the exact line that failed, and the mutation proof
 * restores the original spelling.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(__dirname, "../components/flow/OperatorInbox.tsx");
const source = () => readFileSync(SRC, "utf8");

describe("the dictionary upload can never fail silently", () => {
  it("still HAS an upload path (the scan is not vacuous)", () => {
    const src = source();
    expect(src).toContain("readDictionaryFile");
    // `readDictionaryWorkbook`, not `pickDictionarySheet`: a real master workbook
    // splits its dictionary across tabs (types on the field list, allowed values on
    // a picklist tab), so choosing one "best" sheet loses half the file whichever it
    // picks. The reader merges every sheet.
    expect(src).toContain("readDictionaryWorkbook");
    expect(src).toContain("parseDictionaryCsv");
  });

  it("every throw on the read path is caught", () => {
    const src = source();
    const start = src.indexOf("const readDictionaryFile");
    const body = src.slice(start, src.indexOf("const readDictionaryFileUnsafe", start));
    expect(body, "readDictionaryFile has no try/catch — a rejection is discarded by `void`").toContain("try {");
    expect(body).toContain("catch");
  });

  it("a failure sets an error the operator can read", () => {
    const src = source();
    expect(src, "no error state exists, so a caught failure would still be silent").toContain("setDictError(");
    expect(src, "the error is never rendered").toContain("v3ib-dict-err");
    expect(src, "the error is not announced").toMatch(/role="alert"/);
  });

  it("a preview whose system has no row on screen still renders somewhere", () => {
    // The orphan fallback. Without it, a stale `pendingSor` sends the preview to
    // a row that does not exist and the operator sees nothing.
    const src = source();
    expect(src).toContain("chaseSors");
    expect(src, "no orphan fallback — a preview can still be routed into the void").toMatch(/orphan/);
  });

  it("the pending refs are cleared on BOTH discard and commit", () => {
    // A ref that outlives its dialog is what made the routing stale. Both exits
    // must reset it or the NEXT upload inherits the last one's system.
    const src = source();
    const resets = src.match(/pendingSor\.current = null/g) ?? [];
    expect(resets.length, "pendingSor is reset on fewer than both exits").toBeGreaterThanOrEqual(2);
    const scopeResets = src.match(/pendingScope\.current = \[\]/g) ?? [];
    expect(scopeResets.length).toBeGreaterThanOrEqual(2);
  });

  it("opening the dialog clears a stale error from a previous attempt", () => {
    const src = source();
    const btn = src.slice(src.indexOf("pendingSor.current = sor"));
    expect(src.slice(Math.max(0, src.indexOf("pendingSor.current = sor") - 120), src.indexOf("pendingSor.current = sor")))
      .toContain("setDictError(null)");
    expect(btn.length).toBeGreaterThan(0);
  });
});

/**
 * SEVERAL FILES, ONE ASK.
 *
 * A system of record exports one workbook per OBJECT, so "the CRM dictionary" is
 * three files. The input took one at a time and each stored write replaced the
 * last, so uploading three left the operator with the third and no sign the other
 * two had ever been read.
 */
describe("the upload takes more than one file", () => {
  const src = () => readFileSync(SRC, "utf8");

  it("the file input accepts a multiple selection", () => {
    const input = src().slice(src().indexOf("ref={dictRef}"), src().indexOf("ref={dictRef}") + 400);
    expect(input, "the dictionary input is single-file again").toContain("multiple");
  });

  it("every selected file is read, not just the first", () => {
    const s = src();
    const handler = s.slice(s.indexOf("ref={dictRef}"), s.indexOf("uploadRow(null"));
    expect(handler, "only files[0] is read — the rest of the selection is dropped")
      .not.toMatch(/files\?\.\[0\]/);
    expect(handler).toContain("for (const f of files)");
  });

  it("the preview merges through the SAME rule the stored field uses", () => {
    // Or the count shown before committing is not the count that lands.
    expect(src()).toContain("mergeDictionaryCsv");
  });

  it("a file that fails does not discard the ones already read", () => {
    const s = src();
    const start = s.indexOf("const readDictionaryFile ");
    const body = s.slice(start, s.indexOf("const readDictionaryFileUnsafe", start));
    expect(body).toContain("return carry;");
  });
});
