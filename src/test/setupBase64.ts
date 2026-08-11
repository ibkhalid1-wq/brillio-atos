/**
 * SUITE-WIDE REPAIR OF A BROKEN `btoa` / `atob`.
 *
 * THE BUG. jsdom 29 does not implement base64 itself any more — it delegates to
 * the Node built-in and only re-wraps the error (jsdom/lib/jsdom/browser/Window.js):
 *
 *     window.btoa = function (str) {
 *       try { return btoa(str); }                       // ← the BARE global
 *       catch { throw DOMException.create(window, [ "…invalid characters.", "InvalidCharacterError" ]); }
 *     };
 *
 * That bare `btoa` is meant to resolve to Node's own `globalThis.btoa`. But
 * vitest's jsdom environment copies the jsdom window's keys onto the real
 * `globalThis`, so `globalThis.btoa` becomes this very wrapper — and the call
 * resolves to ITSELF. Every `btoa` is then unbounded recursion: measured at
 * ~17,600 frames deep before the stack blows, and because each unwinding frame
 * catches the RangeError and constructs a fresh DOMException, a single
 * `btoa("abc")` burns 15–30 SECONDS of CPU and then reports
 * `InvalidCharacterError: The string to be encoded contains invalid characters.`
 * on input that is unambiguously valid. `atob` is broken identically.
 *
 * WHY IT MATTERS BEYOND SLOWNESS. Every browser-side upload path base64-encodes
 * the file before posting it to an edge function — `fileToBase64` in
 * flowCapture.tsx, plus the dictionary, CoPilot and portal uploaders. All of them
 * wrap that call in a try/catch. Left unrepaired, the tests do not merely run
 * slowly: an "upload succeeds" test silently exercises the "Could not read that
 * file" branch instead, and passes for the wrong reason.
 *
 * THE FIX. Hand back the exact implementation jsdom was reaching for. Node
 * exports its spec-compliant pair from `node:buffer`, so this restores a
 * primitive the browser supplies rather than substituting any code under test —
 * the same move vitest.config.ts already makes for fflate's URL import.
 *
 * Note this is strictly better than the obvious `Buffer.from(s, "latin1")`
 * one-liner, which is NOT spec-correct: it silently truncates code points above
 * U+00FF (`btoa("Ā")` would yield "AA==") where the spec — and the real
 * browser — must throw InvalidCharacterError. Upload paths depend on that throw
 * to reject input they cannot encode.
 *
 * REMOVE THIS FILE when vitest is upgraded. Verified on vitest 4.1.10 against
 * this same jsdom 29.1.1: `btoa("abc")` returns "YWJj" in 0ms. The upgrade is
 * blocked today by vite — vitest ≥1 needs vite 5+ and this repo builds on vite
 * 4.4.5 — so the harness is repaired here instead.
 */
import { atob as nodeAtob, btoa as nodeBtoa } from "node:buffer";

globalThis.btoa = nodeBtoa;
globalThis.atob = nodeAtob;

// vitest copies window's keys onto globalThis, but the two are not guaranteed to
// be the same object — code that reaches for `window.btoa` explicitly (as
// PortalAttach and FlowDictation do) must land on the repaired pair too.
if (typeof window !== "undefined" && (window as unknown) !== globalThis) {
  window.btoa = nodeBtoa;
  window.atob = nodeAtob;
}
