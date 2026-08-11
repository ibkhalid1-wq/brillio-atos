/**
 * DISCOVER · "＋ add to the record" — attaching a FILE, not only typing.
 *
 * The dialog captured typed text only. An operator holding the thing the
 * stakeholder actually sent — the pricing export, the process deck, the emailed
 * PDF — had to open it, select it, paste it, and lose both the filename and the
 * original. The attach affordance now sits in that same dialog, and everything
 * below is about the three ways an attach path goes wrong:
 *
 *  1 · IT LANDS AS THE WRONG PERSON'S EVIDENCE. The file is attributed to the
 *      person the dialog is capturing FOR — the "Who said it" select — never to
 *      the operator who happened to be holding it, and never to the roster's
 *      first name because that is what the state defaulted to.
 *  2 · IT LANDS WITHOUT BEING READ. Extraction is not evidence. The text is held
 *      in the dialog, editable, until Capture is pressed — the same contract the
 *      typed box and the transcript already carry.
 *  3 · IT SILENTLY DOES NOTHING. This is the defect 441492b fixed in the
 *      dictionary uploader: a swallowed rejection meant "I attached a file and
 *      nothing happened". Two tests below hold the edge's failure and the edge's
 *      empty-extraction to the operator's eye.
 *
 * The header written is the one the record ALREADY parses —
 * "— Document: <title>, provided by <person>, <stamp> —" with the optional
 * "[source: <key>]" pointer — so the Library reads these as documents and offers
 * the original back as a download. No new evidence format was invented.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";

/** The edge, under the test's control. flow-extract answers what each case
 *  needs; flow-transcribe answers 501 so TranscribeButton self-hides and cannot
 *  be confused for the control under test. */
const edge = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; body: Record<string, unknown> }>,
  extract: null as null | (() => { data: unknown; error: unknown }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  isSupabaseConfigured: true,
  supabase: {
    functions: {
      invoke: async (name: string, opts?: { body?: Record<string, unknown> }) => {
        edge.calls.push({ name, body: opts?.body ?? {} });
        if (name === "flow-transcribe") return { data: null, error: { context: { status: 501 } } };
        if (name === "flow-extract") return edge.extract ? edge.extract() : { data: { text: "" }, error: null };
        return { data: null, error: null };
      },
    },
  },
}));

const TheLine = (await import("@/v3/components/flow/TheLine")).default;

// ── fixture ────────────────────────────────────────────────────────────────
const PERSON = "Asha Rao";
const PERSON_ROLE = "Head of Sales";
const OTHER = "Dan Reyes";
const OTHER_ROLE = "Fulfilment Lead";
/** Evidence already on the record — an attach must APPEND to it, never replace it. */
const EXISTING = "— Prior Voice, Ops, 2026-07-01 —\nwe reconcile the pipeline by hand";
const FIELD = "interviewTranscripts";

const PROGRAM = {
  id: "prog-attach", name: "Attach Co", client: "Attach Co", methodology: "atos-flow",
  rawData: {
    data: {
      discoveryKit: {
        interviews: [
          { stakeholder: PERSON, role: PERSON_ROLE, questions: ["Walk us through your part of the process."] },
          { stakeholder: OTHER, role: OTHER_ROLE, questions: ["Where does an order stall?"] },
        ],
      },
      phaseInputs: { listen: { [FIELD]: EXISTING } },
    },
  },
} as unknown as ProgramSummary;

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
/** Every write the dialog makes — the record as it would actually be stored. */
let saves: Array<{ movementId: string; inputs: Record<string, string>; opts?: { attest?: { action: string; detail?: string } } }>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  saves = [];
  edge.calls = [];
  edge.extract = null;
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/**
 * Mount, land on Discover, open the capture dialog. Async because
 * TranscribeButton probes flow-transcribe on mount: awaiting that settle keeps
 * every case free of an out-of-act state update it did not ask for.
 */
const openDialog = async () => {
  act(() => {
    root.render(createElement(TheLine, {
      program: PROGRAM,
      onSaveInputs: async (movementId: string, inputs: Record<string, string>, opts?: { attest?: { action: string; detail?: string } }) => {
        saves.push({ movementId, inputs, opts });
      },
    } as never));
  });
  const discover = [...host.querySelectorAll('[role="tab"]')]
    .find((b) => text(b).startsWith("Discover")) as HTMLButtonElement;
  act(() => { discover.click(); });
  const add = [...host.querySelectorAll("button")].find((b) => text(b).includes("add to the record"));
  if (!add) throw new Error("no '＋ add to the record' control on Discover");
  act(() => { (add as HTMLButtonElement).click(); });
  const dialog = host.querySelector('[role="dialog"][aria-label="Add to the record"]');
  if (!dialog) throw new Error("the capture dialog did not open");
  await act(async () => {});
  return dialog as HTMLElement;
};

/** The shared attach control, found the way an operator finds it — by its words. */
const attachButton = (dialog: HTMLElement): HTMLButtonElement => {
  const button = [...dialog.querySelectorAll("button")].find((b) => /Attach a file/.test(text(b)));
  if (!button) throw new Error(`no attach control in the capture dialog: ${[...dialog.querySelectorAll("button")].map((b) => text(b)).join(" | ")}`);
  return button as HTMLButtonElement;
};

/**
 * Pick a file the way the browser does: the hidden input receives it and fires
 * `change`. jsdom has no file picker, so `files` is defined directly — the React
 * handler under test is reached identically.
 */
const pickFile = async (dialog: HTMLElement, name: string, body = "sheet contents") => {
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  if (!input) throw new Error("the attach control rendered no file input");
  const file = new File([body], name, { type: "" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
};

const capture = async (dialog: HTMLElement) => {
  const button = [...dialog.querySelectorAll("button")].find((b) => text(b) === "Capture") as HTMLButtonElement;
  await act(async () => { button.click(); });
  return button;
};

const captureButton = (dialog: HTMLElement) =>
  [...dialog.querySelectorAll("button")].find((b) => text(b) === "Capture") as HTMLButtonElement;

const chooseWho = (dialog: HTMLElement, label: string) => {
  const select = dialog.querySelector("select") as HTMLSelectElement;
  act(() => {
    select.value = label;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const DOC_HEADER = /^— Document: (.+?), provided by (.+?), (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) —$/m;

// ═══════════════════════════════════════════════════════════════════════════
describe("Discover · add to the record — a file is a road into the record", () => {
  // The base64 every attach below depends on is repaired for the whole suite by
  // src/test/setupBase64.ts, and pinned to the spec's answer by
  // base64Environment.test.ts. This file no longer patches it locally.

  it("the capture dialog offers the SHARED attach control, with a real file input", async () => {
    const dialog = await openDialog();
    expect(text(attachButton(dialog))).toMatch(/Attach a file/);
    expect(dialog.querySelector('input[type="file"]')).toBeTruthy();
  });

  it("attaching sends the file to flow-extract and STORES the original for the programme", async () => {
    edge.extract = () => ({ data: { text: "Q2 pricing: 14 SKUs repriced", sourceKey: "prog-attach/abc-q2.xlsx" }, error: null });
    const dialog = await openDialog();
    await pickFile(dialog, "q2-pricing.xlsx");
    const call = edge.calls.find((c) => c.name === "flow-extract");
    expect(call, "flow-extract was never called").toBeTruthy();
    expect(call!.body.filename).toBe("q2-pricing.xlsx");
    expect(call!.body.store).toBe(true);
    expect(call!.body.programId).toBe(PROGRAM.id);
    expect(typeof call!.body.file).toBe("string");
  });

  it("EXTRACTION IS NOT EVIDENCE: the text is held for review, and nothing is written until Capture", async () => {
    edge.extract = () => ({ data: { text: "the extracted body" }, error: null });
    const dialog = await openDialog();
    await pickFile(dialog, "notes.pdf");
    expect(saves, "an attach wrote to the record before the operator pressed Capture").toHaveLength(0);
    const area = [...dialog.querySelectorAll("textarea")]
      .find((t) => (t.getAttribute("aria-label") ?? "").includes("notes.pdf")) as HTMLTextAreaElement;
    expect(area, "the extraction is not shown for review").toBeTruthy();
    expect(area.value).toBe("the extracted body");
    expect(text(dialog)).toContain("notes.pdf");
  });

  it("the held extraction is EDITABLE, and the edit is what lands", async () => {
    edge.extract = () => ({ data: { text: "raw dump with a stray footer" }, error: null });
    const dialog = await openDialog();
    await pickFile(dialog, "deck.pptx");
    const area = [...dialog.querySelectorAll("textarea")]
      .find((t) => (t.getAttribute("aria-label") ?? "").includes("deck.pptx")) as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(area, "trimmed by the operator");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await capture(dialog);
    expect(saves).toHaveLength(1);
    expect(saves[0].inputs[FIELD]).toContain("trimmed by the operator");
    expect(saves[0].inputs[FIELD]).not.toContain("stray footer");
  });

  it("removing a held file before Capture leaves NO trace on the record", async () => {
    edge.extract = () => ({ data: { text: "never wanted this" }, error: null });
    const dialog = await openDialog();
    await pickFile(dialog, "wrong.docx");
    const remove = [...dialog.querySelectorAll("button")]
      .find((b) => (b.getAttribute("aria-label") ?? "") === "Remove wrong.docx") as HTMLButtonElement;
    expect(remove, "an attached file cannot be taken back").toBeTruthy();
    act(() => { remove.click(); });
    expect(text(dialog)).not.toContain("wrong.docx");
    expect(captureButton(dialog).disabled, "Capture is live with nothing to capture").toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("attribution — the file belongs to the person the dialog is capturing for", () => {
  it("lands as a Document block naming the SELECTED person, in the record's own header format", async () => {
    edge.extract = () => ({ data: { text: "14 SKUs repriced in Q2", sourceKey: "prog-attach/abc-q2.xlsx" }, error: null });
    const dialog = await openDialog();
    chooseWho(dialog, OTHER);
    await pickFile(dialog, "q2-pricing.xlsx");
    await capture(dialog);

    expect(saves).toHaveLength(1);
    const written = saves[0].inputs[FIELD];
    const header = DOC_HEADER.exec(written);
    expect(header, `no parseable document header in:\n${written}`).toBeTruthy();
    expect(header![1]).toBe("q2-pricing");                 // the extension is not part of the title
    expect(header![2]).toBe(OTHER);                        // ← the selected person, not the roster's first
    expect(header![2]).not.toBe(PERSON);
    expect(written).toContain("[source: prog-attach/abc-q2.xlsx]");
    expect(written).toContain("14 SKUs repriced in Q2");
    // …and it APPENDS: the evidence already on the record survives.
    expect(written.startsWith(EXISTING)).toBe(true);
    expect(saves[0].movementId).toBe("listen");
  });

  it("the record PARSES it back as a document, attributed to that person, with the original downloadable", async () => {
    // The proof that the header was not reinvented: the shipped evidence parser
    // reads what the dialog wrote, without being told this is a Line capture.
    const { movementEvidence, flowMovements } = await import("@/v3/components/flow/flowShellData");
    const listen = flowMovements().find((m) => m.id === "listen")!;
    edge.extract = () => ({ data: { text: "the supplier terms, verbatim", sourceKey: "prog-attach/k-terms.pdf" }, error: null });
    const dialog = await openDialog();
    await pickFile(dialog, "supplier-terms.pdf");
    await capture(dialog);

    const after = {
      ...PROGRAM,
      rawData: { data: { ...(PROGRAM.rawData as { data: Record<string, unknown> }).data, phaseInputs: { listen: saves[0].inputs } } },
    } as unknown as ProgramSummary;
    const entries = movementEvidence(after, listen);
    const doc = entries.find((e) => e.kind === "document");
    expect(doc, `no document entry parsed back out of:\n${saves[0].inputs[FIELD]}`).toBeTruthy();
    expect(doc!.who).toBe("supplier-terms");
    expect(doc!.meta).toContain(PERSON);                   // "provided by" — the attribution reads back
    expect(doc!.sourceKey).toBe("prog-attach/k-terms.pdf");
    expect(doc!.text).toContain("the supplier terms, verbatim");
    expect(doc!.text).not.toContain("[source:");           // the pointer is metadata, never reading text
    // the pre-existing voice is still on the record beside it
    expect(entries.some((e) => e.kind === "transcript" && /Prior Voice/.test(e.who))).toBe(true);
  });

  it("the attestation records a DOCUMENT and who provided it — not an anonymous capture", async () => {
    edge.extract = () => ({ data: { text: "body" }, error: null });
    const dialog = await openDialog();
    await pickFile(dialog, "q2-pricing.xlsx");
    await capture(dialog);
    expect(saves[0].opts?.attest?.action).toBe("Document added — q2-pricing");
    expect(saves[0].opts?.attest?.detail).toBe(`provided by ${PERSON}`);
  });

  it("typed text AND a file in one capture: two blocks, one write, one person", async () => {
    edge.extract = () => ({ data: { text: "the attached body" }, error: null });
    const dialog = await openDialog();
    const typed = [...dialog.querySelectorAll("textarea")][0] as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(typed, "what they said in the room");
      typed.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await pickFile(dialog, "handout.docx");
    await capture(dialog);

    expect(saves, "an attach plus a typed capture must be ONE write").toHaveLength(1);
    const written = saves[0].inputs[FIELD];
    expect(written).toMatch(new RegExp(`^— ${PERSON}, ${PERSON_ROLE}, `, "m"));   // the typed voice header
    expect(written).toContain("what they said in the room");
    expect(DOC_HEADER.exec(written)![2]).toBe(PERSON);                            // and the document, same person
    expect(written).toContain("the attached body");
    expect(saves[0].opts?.attest?.detail).toBe(`provided by ${PERSON} · with a typed capture`);
  });

  it("a typed-only capture is untouched by any of this", async () => {
    const dialog = await openDialog();
    const typed = [...dialog.querySelectorAll("textarea")][0] as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(typed, "just what they said");
      typed.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await capture(dialog);
    expect(saves).toHaveLength(1);
    expect(saves[0].inputs[FIELD]).not.toContain("— Document:");
    expect(saves[0].opts?.attest?.action).toBe(`Captured — ${PERSON}`);
    expect(saves[0].opts?.attest?.detail).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
/**
 * The 441492b defect, restated for this path: a file that cannot be read must
 * SAY SO where the operator is looking. Silence is the bug.
 */
describe("a failed extraction is surfaced, never swallowed", () => {
  it("the edge's own error message is shown IN THE DIALOG, and nothing is written", async () => {
    edge.extract = () => ({
      data: null,
      error: { context: { status: 415, json: async () => ({ error: "That workbook is password-protected." }) } },
    });
    const dialog = await openDialog();
    await pickFile(dialog, "locked.xlsx");

    expect(text(dialog), "the extraction failure never reached the operator")
      .toContain("That workbook is password-protected.");
    expect(saves).toHaveLength(0);
    expect(captureButton(dialog).disabled, "Capture offered to write a file that failed to extract").toBe(true);
    // and no ghost attachment was left behind
    expect([...dialog.querySelectorAll("textarea")]
      .some((t) => (t.getAttribute("aria-label") ?? "").includes("locked.xlsx"))).toBe(false);
  });

  it("an edge failure with no readable detail still says something the operator can act on", async () => {
    edge.extract = () => ({ data: null, error: { context: { status: 500 } } });
    const dialog = await openDialog();
    await pickFile(dialog, "mystery.bin");
    expect(text(dialog)).toMatch(/Could not read that file/);
    expect(saves).toHaveLength(0);
  });

  it("a file that extracts to NOTHING says so rather than pretending it landed", async () => {
    edge.extract = () => ({ data: { text: "" }, error: null });
    const dialog = await openDialog();
    await pickFile(dialog, "scan.pdf");
    expect(text(dialog)).toContain("The file produced no readable text.");
    expect(saves).toHaveLength(0);
    expect(captureButton(dialog).disabled).toBe(true);
  });

  it("the control recovers: a failure, then a good file, and the good one lands", async () => {
    edge.extract = () => ({ data: null, error: { context: { status: 500 } } });
    const dialog = await openDialog();
    await pickFile(dialog, "bad.xlsm");
    expect(text(dialog)).toMatch(/Could not read that file/);
    edge.extract = () => ({ data: { text: "readable at last" }, error: null });
    await pickFile(dialog, "good.docx");
    expect(text(dialog)).not.toMatch(/Could not read that file/);
    await capture(dialog);
    expect(saves).toHaveLength(1);
    expect(saves[0].inputs[FIELD]).toContain("readable at last");
    expect(saves[0].inputs[FIELD]).not.toContain("bad");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the affordance is the SHARED one, and it respects the same gate", () => {
  const source = readFileSync(resolve(__dirname, "../components/flow/TheLine.tsx"), "utf8");

  it("TheLine mounts AttachFileButton — it does not grow a second uploader", () => {
    expect(source).toContain("<AttachFileButton");
    expect(source).toContain('from "@/v3/components/flow/flowCapture"');
    // No private file input, no private call to the extraction edge.
    expect(source).not.toMatch(/type="file"/);
    expect(source).not.toMatch(/invoke\(\s*"flow-extract"/);
  });

  it("no attach without the write gate: a read-only Line offers no capture at all", () => {
    // `onSaveInputs` is the authoring gate the surrounding controls use. Without
    // it there is no "add to the record" button, so there is no attach either.
    act(() => { root.render(createElement(TheLine, { program: PROGRAM } as never)); });
    const discover = [...host.querySelectorAll('[role="tab"]')]
      .find((b) => text(b).startsWith("Discover")) as HTMLButtonElement;
    act(() => { discover.click(); });
    expect([...host.querySelectorAll("button")].some((b) => text(b).includes("add to the record"))).toBe(false);
    expect(host.querySelector('input[type="file"]')).toBeNull();
  });
});
