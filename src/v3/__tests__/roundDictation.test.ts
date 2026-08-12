/**
 * GAP 2 — THE DESIGN ROUND WAS SPECIFIED AS FEEDBACK "TEXT OR RECORDED", AND
 * THE RECORD COULD NOT TELL THE TWO APART.
 *
 * `DesignRoundResponse` models a `recordingRef` and nothing produces one. The
 * round review page did offer the microphone — the SAME `DictationButton` the
 * ordinary interview page ("Speak it") and the visual review surfaces use, so
 * there is one dictation control in this product and not two. What was missing
 * is the half that makes a transcript honest evidence:
 *
 *   (a) THE TRANSCRIPT IS NOT EVIDENCE UNTIL ITS AUTHOR CONFIRMS IT. Dictation
 *       lands in the same editable box the stakeholder types into, and nothing
 *       leaves the page until they press send — the Discover attach rule, applied
 *       to speech. A mis-transcription of someone's own words must be correctable
 *       by them, not by an operator reading it back weeks later.
 *
 *   (b) THE RECORD SAYS WHICH IT WAS. A transcript is a machine's reading of what
 *       someone said. Filed as if they had written it, it claims a precision it
 *       does not have — and the whole point of the round's attestation split is
 *       that the record never overstates whose words these are.
 *
 * `capture` is "typed" | "dictated" | "mixed"; `mixed` is dictation the person
 * then corrected, which is the strongest form of the evidence and deliberately
 * distinguishable from a raw transcript.
 *
 * The stub below installs a Web Speech API on `window` and only THEN imports the
 * page: FlowDictation reads the constructor once, at module load, so a browser
 * that can dictate has to exist before the import or the control renders nothing.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement, type FunctionComponent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DESIGN_ROUND_REVIEW_KIND } from "@/v3/components/flow/flowDesignRound";

/** A browser that can dictate, under test control. */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() { FakeRecognition.last = this; }
  stop() { this.onend?.(); }
  /** The browser handing back one finished sentence. */
  say(transcript: string) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript } }] });
  }
}

let FlowRespond: FunctionComponent<{ token: string }>;
beforeAll(async () => {
  (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
  FlowRespond = (await import("@/v3/components/flow/FlowRespond")).default as FunctionComponent<{ token: string }>;
});

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const AT = "2026-08-01T00:00:00Z";
const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/flow-portal/index.ts"), "utf8");
const SURFACE = readFileSync(resolve(__dirname, "../components/flow/FlowReviewSurface.tsx"), "utf8");

const servedRoundPack = (over: Record<string, unknown> = {}) => ({
  kind: "interview", programme: "Laila CRM", stakeholder: "Ibrahim Khalid",
  role: `review:${DESIGN_ROUND_REVIEW_KIND}`, movementId: "show",
  intro: "Round 1 of the design review.", questions: ["Do you approve this design?"],
  objective: "Cut quote turnaround from a week to a day",
  reviewKind: DESIGN_ROUND_REVIEW_KIND,
  review: { kind: DESIGN_ROUND_REVIEW_KIND, roundId: "round-1", ordinal: 1, designVersion: AT, prototypeTitle: "Laila CRM pilot" },
  pilotHtml: "<main>the built pilot</main>", pilotSource: "assembled",
  script: { openingQuote: "Quotes take a week.", matchedBy: "role", steps: [{ beat: "Open the deal" }] },
  responded: false, closed: false, answered: false,
  ...over,
});

const realFetch = globalThis.fetch;
let host: HTMLDivElement;
let root: Root;
let posted: Array<Record<string, unknown>>;

const typeInto = (el: HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const field = () => host.querySelector(".v3fs-rvw-bq textarea") as HTMLTextAreaElement;
const mic = () => host.querySelector(".v3fs-mic") as HTMLButtonElement;
const send = () => host.querySelector(".v3fs-rvw-send") as HTMLButtonElement;
const text = () => host.textContent ?? "";
const sent = () => posted.filter((p) => typeof p.answers === "string");

const mountLink = async (pack: Record<string, unknown> = servedRoundPack()) => {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { posted.push(JSON.parse(String(init.body))); return { ok: true, json: async () => ({ ok: true }) }; }
    return { ok: true, json: async () => pack };
  }) as unknown as typeof fetch;
  await act(async () => { root.render(createElement(FlowRespond, { token: "p1.deadbeef" })); });
};
/** Speak one sentence into whatever field the mic is attached to. */
const speak = (sentence: string) => {
  act(() => { mic().click(); });
  act(() => { FakeRecognition.last!.say(sentence); });
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  posted = [];
  localStorage.clear();
  FakeRecognition.last = null;
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true, configurable: true });
});
afterEach(() => { act(() => root.unmount()); host.remove(); globalThis.fetch = realFetch; });

describe("a stakeholder can speak their feedback on the round page", () => {
  it("the microphone is there, and it is the SAME control the interview page offers", async () => {
    await mountLink();
    expect(mic(), "no dictation control on the round's feedback field").toBeTruthy();
    // One pattern, not two: the round surface reaches for `FlowDictation`, the
    // module `FlowRespond`'s "Speak it" affordance already uses. `flowCapture`'s
    // TranscribeButton is the operator-side attach control and stays there.
    expect(SURFACE).toMatch(/import \{ DictationButton, joinDictation \} from "@\/v3\/components\/flow\/FlowDictation"/);
    expect(SURFACE).not.toContain("TranscribeButton");
  });

  it("REGRESSION: what they say lands in the EDITABLE box, and nothing is sent from the microphone", async () => {
    await mountLink();
    speak("partner tiers are missing from the quote screen");
    expect(field().value).toBe("Partner tiers are missing from the quote screen");
    expect(field().disabled, "a transcript the stakeholder cannot correct is not their word").toBe(false);
    expect(sent(), "dictation must file nothing — only pressing send does").toHaveLength(0);
  });

  it("the page TELLS them to read it back before it becomes evidence", async () => {
    await mountLink();
    expect(text()).not.toContain("read it back");
    speak("looks right to me");
    expect(text()).toContain("read it back and correct anything before you send");
  });
});

describe("the record says whether the words were typed or dictated", () => {
  const approveAnd = async (write: () => void) => {
    await mountLink();
    const [approve] = [...host.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
    act(() => { approve.click(); });
    write();
    await act(async () => { send().click(); });
  };

  it("typed feedback claims nothing more than that", async () => {
    await approveAnd(() => typeInto(field(), "Exactly how we quote."));
    expect(sent()).toHaveLength(1);
    expect(sent()[0].capture).toBe("typed");
    expect(String(sent()[0].answers)).not.toContain("Dictated");
  });

  it("REGRESSION: dictated feedback is recorded as DICTATED, not as their writing", async () => {
    await approveAnd(() => speak("this is exactly how we quote"));
    expect(sent()[0].capture).toBe("dictated");
    // NOT written into the answer. It used to be appended as an English sentence
    // ("— Dictated by X, not typed.") because DesignRoundResponse had no field for
    // it and only `text` survived the hop into the round — which made the
    // stakeholder appear to have written a remark about their own dictation. The
    // field carries it now, so the words stay theirs.
    expect(String(sent()[0].answers)).not.toContain("Dictated");
    // their words reach the record intact — the sentence went, the speech did not
    expect(String(sent()[0].answers)).toContain("This is exactly how we quote");
  });

  it("a transcript its author corrected is MIXED — a stronger claim than a raw one", async () => {
    await approveAnd(() => {
      speak("this is exactly how we quota");
      typeInto(field(), "This is exactly how we quote.");
    });
    expect(sent()[0].capture).toBe("mixed");
    expect(String(sent()[0].answers)).not.toContain("Dictated");
  });

  it("the verdict and the QUARANTINE path are untouched by any of it", async () => {
    await approveAnd(() => speak("all good"));
    // Still an ordinary portal response that happens to carry a verdict: it lands
    // in `flowPortalInbox` and reaches the round only when the operator ingests it.
    expect(sent()[0].verdict).toBe("accepted");
    expect(sent()[0].final).toBeUndefined();
    expect(EDGE).toContain("nextInner.flowPortalInbox = inbox.slice(-INBOX_CAP);");
  });

  it("an approval with nothing written claims no capture at all", async () => {
    await approveAnd(() => {});
    expect(sent()[0].capture).toBeUndefined();
  });
});

describe("client ↔ edge lockstep on the capture vocabulary", () => {
  it("the edge accepts exactly the three words the page can send", () => {
    const edgeSet = EDGE.match(/const CAPTURE_MODES = new Set\(\[([^\]]*)\]\)/);
    expect(edgeSet, "edge CAPTURE_MODES not found").toBeTruthy();
    const edgeWords = [...edgeSet![1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort();
    // The vocabulary moved to the MODEL that stores it (flowDesignRound) — the
    // review surface is one producer of several, and a type owned by one producer
    // is a type the others have to guess at. Read it where it is declared.
    const MODEL = readFileSync(resolve(__dirname, "../components/flow/flowDesignRound.ts"), "utf8");
    const clientUnion = MODEL.match(/export type CaptureMode = ([^;]+);/);
    expect(clientUnion, "client CaptureMode not found").toBeTruthy();
    // and the runtime guard beside it must list the same three, or a writer
    // validates against a set the type does not describe
    const guard = MODEL.match(/CAPTURE_MODES: ReadonlySet<string> = new Set<CaptureMode>\(\[([^\]]*)\]\)/);
    expect(guard, "runtime CAPTURE_MODES guard not found").toBeTruthy();
    expect([...guard![1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort())
      .toEqual([...clientUnion![1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort());
    const clientWords = [...clientUnion![1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort();
    expect(edgeWords).toEqual(clientWords);
    expect(edgeWords).toEqual(["dictated", "mixed", "typed"]);
  });

  it("the edge stamps `capture` on the quarantined item ONLY from that set", () => {
    expect(EDGE).toContain('...(isRecord(body) && CAPTURE_MODES.has(String(body.capture)) ? { capture: String(body.capture) } : {})');
  });
});

describe("no dead microphone when the project cannot transcribe", () => {
  const DICT = readFileSync(resolve(__dirname, "../components/flow/FlowDictation.tsx"), "utf8");

  it("the record-and-transcribe fallback probes for 501 and removes ITSELF, exactly as TranscribeButton does", () => {
    // A browser with no live dictation (Firefox) records audio and posts it to
    // flow-transcribe, which answers 501 when the project has no OPENAI_API_KEY.
    // A mic that swallows a spoken answer is worse than no mic: the stakeholder
    // believes they have answered. Typing is always underneath.
    expect(DICT).toMatch(/transcribeAvailable = res\.status !== 501/);
    expect(DICT).toContain('if (state === "unavailable") return null;');
    expect(DICT).toMatch(/if \(res\.status === 501\) \{ transcribeAvailable = false; setState\("unavailable"\); return; \}/);
    // …and a recording that comes back empty is SAID, never silently dropped.
    expect(DICT).toContain("didn’t come back as text — please type it instead.");
    // The one rule, mirrored from the control that already had it.
    const CAPTURE = readFileSync(resolve(__dirname, "../components/flow/flowCapture.tsx"), "utf8");
    expect(CAPTURE).toContain("transcribeAvailable = status !== 501;");
  });
});
