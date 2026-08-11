/**
 * "0% closed" and "0 conflicts" mean NOTHING HAS BEEN HEARD, and the surface must say so.
 *
 * A claim closes on a stakeholder ANSWER, and that write path is not wired in the browser,
 * so on a live programme `burnDown.closed` is 0 BY CONSTRUCTION — not because the work is
 * outstanding. Everything downstream inherits it, including the Inbox's "0 conflicts to
 * adjudicate", which reads as "nothing is wrong" when it partly means "nobody has answered".
 *
 * The caveat used to live beside that Inbox panel and was lost when zero-count sections were
 * hidden by request — it disappeared in exactly the state that needed explaining. It now sits
 * on the convergence readout, which is always drawn, and qualifies the number it belongs to.
 *
 * Rendered, not source-scanned: a caveat that is present in the file but never reaches the
 * DOM is the same defect over again.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConvergenceReadout } from "@/v3/components/flow/studio/ledgerPrimitives";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const burn = (closed: number, total = 100) =>
  ({ closed, weak: 10, open: total - closed - 10, total, pctClosed: Math.round((closed / total) * 100), pctSettled: 50 });

const render = (b: ReturnType<typeof burn>) =>
  act(() => { root.render(createElement(ConvergenceReadout, { burnDown: b as never, perAreaProvisional: false })); });

describe("the nothing-heard caveat", () => {
  it("APPEARS when no claim has really closed — the live-programme case", () => {
    render(burn(0));
    const el = host.querySelector(".v3lc-conv-nh");
    expect(el, "no caveat rendered while closed === 0").not.toBeNull();
    expect(el!.textContent).toMatch(/nothing heard yet/i);
    // and it explains WHY, so the number is not merely decorated with a shrug
    expect(el!.getAttribute("title") ?? "").toMatch(/write path is not wired/i);
    expect(el!.getAttribute("title") ?? "").toMatch(/adjudicate/i);
  });

  it("DISAPPEARS as soon as one real closure exists — it is a caveat, not a banner", () => {
    render(burn(1));
    expect(host.querySelector(".v3lc-conv-nh")).toBeNull();
  });

  it("does not fire on an EMPTY programme, where 0 of 0 says nothing", () => {
    render(burn(0, 0));
    expect(host.querySelector(".v3lc-conv-nh")).toBeNull();
  });

  it("the headline figure is still rendered — the caveat sits beside it, never replaces it", () => {
    render(burn(0));
    expect(host.textContent).toContain("0%");
    expect(host.textContent).toContain("closed");
  });
});
