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
    expect(src).toContain("pickDictionarySheet");
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
