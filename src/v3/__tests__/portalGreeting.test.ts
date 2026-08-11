/**
 * F5 — "Hi Head," ON THE MOST CLIENT-FACING PAGE IN THE PRODUCT.
 *
 * `FlowReviewSurface` greeted with `stakeholder.split(/\s+/)[0]`. A durable
 * link's recipient is as often a ROLE as a person, so "Head of Sales" was
 * truncated to its first word and an executive opened their review to "Hi Head,".
 * The same truncation ran on the plain respond page's opener, its recap and its
 * welcome-back banner.
 *
 * The rule now: a first name is taken ONLY when the label actually is a person's
 * name; a role is greeted whole; a role PLACEHOLDER is not greeted at all,
 * because no one has been named yet and inventing a greeting for them is the
 * fabrication this codebase exists to prevent. The stored "— TBC" machine token
 * is translated by the ONE existing definition (`displayPersonLabel`), so it can
 * never reach the page — not even as "Hi Fulfilment,".
 *
 * `flowLibs.test.ts` ("Hi Dan," in a mailto) pins the personal-name case on the
 * other producer; it must keep passing, and the greeting here agrees with it.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import FlowReviewSurface, { greetingName, isPersonLabel } from "@/v3/components/flow/FlowReviewSurface";
import { displayPersonLabel } from "@/v3/components/flow/flowStakeholders";
import type { ListenWorkflowReview } from "@/v3/components/flow/flowReviews";

describe("F5 — the greeting only takes a first name from an actual name", () => {
  it("REGRESSION: a role-shaped recipient is NEVER truncated to its first word", () => {
    expect(greetingName("Head of Sales")).toBe("Head of Sales");
    expect(greetingName("Head of Sales")).not.toBe("Head");
    expect(greetingName("VP Customer Success")).toBe("VP Customer Success");
    expect(greetingName("Chief Financial Officer")).toBe("Chief Financial Officer");
    expect(greetingName("Sales / Alliances Lead")).toBe("Sales / Alliances Lead");
  });

  it("a real personal name still greets by first name — the flowLibs contract", () => {
    expect(greetingName("Dan Reyes")).toBe("Dan");
    expect(greetingName("Sarah Okafor")).toBe("Sarah");
    expect(greetingName("Prakash T M")).toBe("Prakash");
    expect(greetingName("Ada")).toBe("Ada");
  });

  it("an unfilled role placeholder is not greeted at all, and never leaks '— TBC'", () => {
    expect(greetingName("Fulfilment SME — TBC")).toBe("");
    expect(greetingName("Regulatory Affairs SME – TBC")).toBe("");
    // and if any surface DID print the label, it prints the human form
    expect(displayPersonLabel("Fulfilment SME — TBC")).toBe("Fulfilment SME — no one named yet");
  });

  it("blank in, blank out — no greeting is invented from nothing", () => {
    expect(greetingName("")).toBe("");
    expect(greetingName(null)).toBe("");
    expect(greetingName(undefined)).toBe("");
    expect(greetingName("   ")).toBe("");
  });

  it("is idempotent, so a surface may apply it defensively", () => {
    for (const label of ["Dan Reyes", "Head of Sales", "Fulfilment SME — TBC", ""]) {
      expect(greetingName(greetingName(label))).toBe(greetingName(label));
    }
  });

  it("the person/role decision itself: unplaceable labels fall to the SAFE side", () => {
    expect(isPersonLabel("Dan Reyes")).toBe(true);
    expect(isPersonLabel("Head of Sales")).toBe(false);
    expect(isPersonLabel("Sales Operations Manager")).toBe(false);
    expect(isPersonLabel("Fulfilment SME — TBC")).toBe(false);
    expect(isPersonLabel("Sales Lead (Asha Rao)")).toBe(false);
    // an unusually long label is greeted whole rather than truncated
    expect(isPersonLabel("Regional Director Northern Europe Region")).toBe(false);
  });
});

/** The DOM the executive actually opened. */
const review: ListenWorkflowReview = {
  kind: "listen-workflow",
  persona: "Head of Sales",
  intro: "Walk your workflow.",
  workflows: [{ name: "Quote to cash", steps: [{ action: "Draft the quote" }] }],
  terms: [], relations: [], questions: [],
};

describe("F5 — the review surface renders the fixed greeting", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    localStorage.clear();
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const render = (stakeholder: string) => {
    act(() => {
      root.render(createElement(FlowReviewSurface, {
        review, stakeholder, submitting: false, error: null, onSubmit: () => {}, programme: "Flow Pilot",
      }));
    });
    return host.querySelector(".v3fs-rvw-hi")?.textContent ?? "";
  };

  it("REGRESSION: an executive is not greeted 'Hi Head,'", () => {
    expect(render("Head of Sales")).toBe("Hi Head of Sales,");
    expect(host.textContent).not.toContain("Hi Head,");
  });

  it("a person is greeted by first name", () => {
    expect(render("Dan Reyes")).toBe("Hi Dan,");
  });

  it("a placeholder recipient gets no greeting, and no '— TBC' anywhere on the page", () => {
    expect(render("Fulfilment SME — TBC")).toBe("");
    expect(host.textContent).not.toContain("TBC");
  });
});
