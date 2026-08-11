/**
 * THE TEST ENVIRONMENT'S OWN base64, pinned.
 *
 * jsdom 29's `btoa`/`atob` delegate to the bare global of the same name, which
 * vitest's jsdom environment has already overwritten with those very wrappers —
 * so each call recurses into itself, burns ~17,600 stack frames over 15-30
 * seconds, and then reports `InvalidCharacterError` on perfectly valid input.
 * src/test/setupBase64.ts repairs that for the whole suite; this file is the
 * guard that the repair is in place and behaves the way a browser does.
 *
 * This is not a cosmetic slowdown. Every browser-side upload path base64-encodes
 * inside a try/catch — `fileToBase64` in flowCapture.tsx, PortalAttach,
 * FlowDictation, the dictionary and CoPilot uploaders. Unrepaired, a test that
 * believes it is exercising a successful upload is really exercising "Could not
 * read that file", and passes for the wrong reason. If this file goes red, treat
 * every upload assertion in the suite as unproven.
 */
import { describe, it, expect } from "vitest";

/** 0xFF, NUL, "A" — spelled by code point so the source stays ASCII and the
 *  intent (the edges of the latin1 range, including a NUL) is legible. */
const LATIN1_EDGES = String.fromCharCode(0xff, 0x00, 0x41);
/** The first code point base64 CANNOT carry. */
const ABOVE_LATIN1 = String.fromCharCode(0x100);

describe("the jsdom environment's base64 is the spec's base64", () => {
  it("encodes and decodes ASCII", () => {
    expect(btoa("abc")).toBe("YWJj");
    expect(atob("YWJj")).toBe("abc");
  });

  it("covers the WHOLE latin1 range, not just ASCII — bytes are what uploads carry", () => {
    expect(btoa(LATIN1_EDGES)).toBe("/wBB");
    expect(atob("/wBB")).toBe(LATIN1_EDGES);
  });

  it("THROWS above U+00FF rather than silently corrupting the input", () => {
    // The trap in the obvious `Buffer.from(s, "latin1")` shim: it returns "AA=="
    // here, quietly truncating the character. An uploader relies on this throw
    // to reject a payload it cannot encode.
    expect(() => btoa(ABOVE_LATIN1)).toThrow();
    expect(() => atob("!!!")).toThrow();
  });

  it("returns PROMPTLY — the recursion bug showed up as ~30s for a single call", () => {
    const started = Date.now();
    for (let i = 0; i < 1000; i++) btoa("the quick brown fox");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("repairs `window.btoa` too — PortalAttach and FlowDictation reach for it there", () => {
    expect(window.btoa("abc")).toBe("YWJj");
    expect(window.atob("YWJj")).toBe("abc");
  });
});
