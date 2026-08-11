/**
 * F3 — THE STAKEHOLDER LINK MUST NOT BURN ON THE FIRST SUBMIT.
 *
 * Driving the deployed portal: an interview pack with 8 questions, ONE answered,
 * "Send my changes" pressed. The page came back "Thank you — your answers are in.
 * This link is now closed", and the remaining 7 questions were unreachable by
 * that stakeholder — recovery required the operator to notice and re-mint. That
 * contradicts the pack's own documented design ("the DURABLE per-stakeholder link
 * — one stable token", `loadPack` in `supabase/functions/flow-portal/index.ts`),
 * and the edge already stored it durably; only the BEHAVIOUR was one-shot.
 *
 * What is pinned here:
 *   1. the state machine (`@shared/portalLinkState`) — a partial send leaves the
 *      link open, only an explicit "I'm done" or an operator `closedAt` finishes
 *      it, and a legacy one-shot link keeps its old semantics;
 *   2. the edge honours it — the POST guard is that one function, and `closedAt`
 *      is stamped only on `final` (lockstep, text-parsed: the Deno boundary
 *      forbids importing the entrypoint);
 *   3. quarantine and attributability survive — a second send APPENDS a separate
 *      inbox item and a separate recap row; it never overwrites the first;
 *   4. the page renders the form again on return, with the already-answered asks
 *      shown as on-record instead of asked again as if nothing was sent.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  portalLinkState, acceptsSubmission, sanitiseAnsweredKeys, packAskKeys,
} from "@shared/portalLinkState";
import FlowRespond, { withoutAnsweredAsks } from "@/v3/components/flow/FlowRespond";
import { portalQuestionModel } from "@/v3/components/flow/portalQuestionModel";

const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/flow-portal/index.ts"), "utf8");

const EIGHT = Array.from({ length: 8 }, (_, i) => `Question ${i + 1}?`);
/** The pack as the blob stores it: eight asks, minted, nothing sent yet. */
const freshPack = (over: Record<string, unknown> = {}) => ({
  token: "abc", stakeholder: "Dan Reyes", role: "Sales Lead",
  questions: EIGHT, createdAt: "2026-08-01T09:00:00.000Z",
  askUpdatedAt: "2026-08-01T09:00:00.000Z",
  ...over,
});
/** One submission as the edge writes it. */
const sub = (ts: string, over: Record<string, unknown> = {}) =>
  ({ ts, kind: "interview", preview: "…", movementId: "listen", ...over });

describe("F3 — a partial submit files the answers and keeps the link usable", () => {
  it("REGRESSION: one answer out of eight does NOT close the link", () => {
    const pack = freshPack({ respondedAt: "2026-08-02T10:00:00.000Z",
      submissions: [sub("2026-08-02T10:00:00.000Z", { answered: ["Question 1?"] })] });
    const state = portalLinkState(pack);
    expect(state.answered).toBe(true);            // the answer IS on the record
    expect(state.closed).toBe(false);             // …and the link is still theirs
    expect(state.responded).toBe(false);          // so the page renders the form, not a recap
    expect(acceptsSubmission(pack)).toEqual({ ok: true });   // and it takes the next seven
  });

  it("a SECOND partial send is accepted too — they can return as often as they like", () => {
    const pack = freshPack({ submissions: [
      sub("2026-08-02T10:00:00.000Z", { answered: ["Question 1?"] }),
      sub("2026-08-03T11:00:00.000Z", { answered: ["Question 2?", "Question 3?"] }),
    ] });
    expect(acceptsSubmission(pack)).toEqual({ ok: true });
    expect(portalLinkState(pack).answeredAsks).toEqual(["Question 1?", "Question 2?", "Question 3?"]);
  });

  it("only an explicit 'I'm done' finishes it — and then the link IS closed", () => {
    const pack = freshPack({ submissions: [
      sub("2026-08-02T10:00:00.000Z", { answered: ["Question 1?"] }),
      sub("2026-08-04T12:00:00.000Z", { final: true }),
    ] });
    const state = portalLinkState(pack);
    expect(state.closed).toBe(true);
    expect(state.responded).toBe(true);
    const gate = acceptsSubmission(pack);
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.status).toBe(409);
  });

  it("the OPERATOR's own closing action still closes it", () => {
    const pack = freshPack({
      closedAt: "2026-08-05T08:00:00.000Z",
      submissions: [sub("2026-08-02T10:00:00.000Z")],
    });
    expect(portalLinkState(pack).closed).toBe(true);
    expect(acceptsSubmission(pack).ok).toBe(false);
  });

  it("a NEW ask posted after the last answer re-opens even a finished link", () => {
    const pack = freshPack({
      askUpdatedAt: "2026-08-06T09:00:00.000Z",
      submissions: [sub("2026-08-04T12:00:00.000Z", { final: true })],
    });
    const state = portalLinkState(pack);
    expect(state.closed).toBe(true);        // they did finish…
    expect(state.followUp).toBe(true);      // …but there is something new to answer
    expect(state.responded).toBe(false);
    expect(acceptsSubmission(pack)).toEqual({ ok: true });
  });

  it("a LEGACY one-shot link (bare respondedAt, no history) keeps its old semantics", () => {
    // We hold no record of WHICH asks it covered, so re-opening it would re-ask
    // everything as if the person had never answered — worse than the recap.
    const pack = freshPack({ respondedAt: "2026-08-02T10:00:00.000Z" });
    const state = portalLinkState(pack);
    expect(state.answered).toBe(true);
    expect(state.closed).toBe(true);
    expect(state.responded).toBe(true);
    expect(acceptsSubmission(pack).ok).toBe(false);
  });

  it("an unminted/empty pack is not 'answered' and is not closed", () => {
    expect(portalLinkState(freshPack())).toMatchObject({ answered: false, closed: false, responded: false });
    expect(portalLinkState(undefined)).toMatchObject({ answered: false, closed: false, responded: false });
  });
});

describe("F3 — nothing a respondent claims is trusted beyond the pack's own asks", () => {
  const pack = freshPack({ questionLoci: ["el-1#owner", "el-2#trigger"] });

  it("packAskKeys is the stored questions AND their loci", () => {
    expect(packAskKeys(pack).has("Question 1?")).toBe(true);
    expect(packAskKeys(pack).has("el-2#trigger")).toBe(true);
  });

  it("an ask the pack never carried is dropped, and duplicates collapse", () => {
    expect(sanitiseAnsweredKeys(
      ["Question 1?", "Question 1?", "el-1#owner", "Something I invented", ""], pack,
    )).toEqual(["Question 1?", "el-1#owner"]);
  });

  it("a non-array claim yields nothing rather than throwing", () => {
    expect(sanitiseAnsweredKeys("Question 1?", pack)).toEqual([]);
    expect(sanitiseAnsweredKeys(undefined, pack)).toEqual([]);
  });
});

describe("F3 — the edge enforces the same rule (client ↔ edge lockstep)", () => {
  it("the POST interview branch gates on acceptsSubmission, not on 'has answered once'", () => {
    expect(EDGE).toMatch(/const gate = acceptsSubmission\(hit\.pack\)/);
    expect(EDGE).toMatch(/if \(!gate\.ok\) return jsonResponse\(\{ error: gate\.error \}, gate\.status\)/);
    // the old rule — ANY prior submission with no newer ask was refused — is gone
    expect(EDGE).not.toMatch(/prior\.length > 0 && \(!lastTs \|\| askAt <= lastTs\)/);
  });

  it("`closedAt` is stamped ONLY on an explicit final send", () => {
    expect(EDGE).toMatch(/const finalSend = isRecord\(body\) && body\.final === true/);
    expect(EDGE).toMatch(/\.\.\.\(finalSend \? \{ closedAt: now \} : \{\}\)/);
  });

  it("a submission APPENDS — the recap concats, and the inbox item is its own record", () => {
    // Never `submissions: [ ... ]` wholesale, never an update-in-place of an
    // existing row: the second send must not overwrite or merge over the first.
    expect(EDGE).toMatch(/\(Array\.isArray\(entry\.submissions\) \? entry\.submissions\.filter\(isRecord\) : \[\]\)\s*\n\s*\.concat\(/);
    expect(EDGE).toMatch(/inbox\.push\(\{[\s\S]{0,200}?kind: "interview",[\s\S]{0,200}?receivedAt: now/);
    // and the quarantine channel is unchanged — still the operator's inbox
    expect(EDGE).toMatch(/nextInner\.flowPortalInbox = inbox\.slice\(-INBOX_CAP\)/);
  });

  it("GET reports closure from the shared state, not from 'has submitted'", () => {
    expect(EDGE).toMatch(/const linkState = portalLinkState\(hit\.pack\)/);
    expect(EDGE).toMatch(/responded: linkState\.responded/);
    expect(EDGE).toMatch(/closed: linkState\.closed/);
    expect(EDGE).toMatch(/answeredAsks: linkState\.answeredAsks/);
    expect(EDGE).not.toMatch(/responded: interviewSubmissions\.length > 0 && !interviewFollowUp/);
  });

  it("the edge imports the ONE definition rather than restating the rule", () => {
    expect(EDGE).toMatch(/from "\.\.\/_shared\/portalLinkState\.ts"/);
  });
});

describe("F3 — an ask already on the record is not asked again", () => {
  const model = portalQuestionModel({ questions: EIGHT }, null);

  it("the answered ones leave the form and are handed back to be SHOWN as on-record", () => {
    const { model: open, onRecord } = withoutAnsweredAsks(model, ["Question 1?"]);
    expect(model.count).toBe(8);
    expect(open.count).toBe(7);
    expect(open.strings.map((s) => s.question)).not.toContain("Question 1?");
    expect(onRecord).toEqual(["Question 1?"]);
    // the surviving rows keep their ORIGINAL indices — answers/attachments are keyed by them
    expect(open.strings[0]).toEqual({ index: 1, question: "Question 2?" });
  });

  it("no answered asks ⇒ the model is handed back untouched", () => {
    expect(withoutAnsweredAsks(model, undefined)).toEqual({ model, onRecord: [] });
    expect(withoutAnsweredAsks(model, []).model).toBe(model);
  });
});

/**
 * THE PAGE ITSELF — the surface the stakeholder actually met. The unit tests
 * above pin the rule; this pins that the rule reaches the DOM, because the
 * defect was reported as page text ("This link is now closed"), not as a state
 * flag. The pack is served exactly as the edge serves it.
 */
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const realFetch = globalThis.fetch;

/** The edge's GET payload for a link that took ONE partial answer out of eight. */
const servedPack = (over: Record<string, unknown> = {}) => ({
  kind: "interview", programme: "Flow Pilot", stakeholder: "Dan Reyes",
  role: "Sales Lead", intro: "A few questions.", questions: EIGHT,
  submissions: [{ ts: "2026-08-02T10:00:00.000Z", kind: "interview", preview: "Answered the first one" }],
  answered: true, followUp: false, responded: false, closed: false,
  answeredAsks: ["Question 1?"],
  ...over,
});

const mount = async (pack: Record<string, unknown>) => {
  globalThis.fetch = (async () => ({
    ok: true, json: async () => pack,
  })) as unknown as typeof fetch;
  await act(async () => { root.render(createElement(FlowRespond, { token: "p1.deadbeef" })); });
};
const text = () => host.textContent ?? "";

describe("F3 — the respond PAGE lets them come back and finish", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    localStorage.clear();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    globalThis.fetch = realFetch;
  });

  it("REGRESSION: a returning stakeholder gets the FORM, not 'this link is now closed'", async () => {
    await mount(servedPack());
    expect(text()).not.toContain("This link is now closed");
    // the seven they never reached are on the page, as fields they can answer
    expect(host.querySelectorAll(".v3fs-portal-card textarea").length).toBeGreaterThanOrEqual(7);
    expect(text()).toContain("Question 8?");
    expect(text()).toContain("Welcome back");
  });

  it("the ask they already answered is shown as ON RECORD, not asked again", async () => {
    await mount(servedPack());
    const cards = [...host.querySelectorAll(".v3fs-portal-card")].map((c) => c.textContent ?? "");
    expect(cards.some((c) => c.includes("Question 1?"))).toBe(false);   // not re-asked…
    expect(cards.some((c) => c.includes("Question 2?"))).toBe(true);
    const onRecord = host.querySelector(".v3fs-portal-onrecord")?.textContent ?? "";
    expect(onRecord).toContain("Question 1?");                          // …but not vanished either
    expect(onRecord).toContain("already answered");
  });

  it("both sends are offered, and the page states which one closes the link", async () => {
    await mount(servedPack());
    const labels = [...host.querySelectorAll(".v3fs-portal-sendgroup button")].map((b) => b.textContent ?? "");
    expect(labels.some((l) => l.includes("Send my answers"))).toBe(true);
    expect(labels.some((l) => l.includes("I have nothing more to add"))).toBe(true);
    expect(text()).toContain("Sending keeps this link open");
  });

  it("a link the person FINISHED still shows the recap — closure is honoured", async () => {
    await mount(servedPack({ responded: true, closed: true }));
    expect(text()).toContain("Thank you, Dan");
    expect(host.querySelectorAll(".v3fs-portal-card textarea").length).toBe(0);
  });
});
