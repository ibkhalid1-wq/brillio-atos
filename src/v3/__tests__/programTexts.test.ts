import { describe, it, expect } from "vitest";
import {
  splitExternalTexts,
  mergeExternalTexts,
  hasInlineExternalText,
  MIN_EXTERNAL_LEN,
} from "@/v3/lib/programTexts";

const bigTranscript = "— Raj Mamodia —\n" + "word ".repeat(MIN_EXTERNAL_LEN); // well over the threshold

const sampleInner = () => ({
  transformationCharter: { businessObjective: "x" },
  phaseInputs: {
    frame: {
      sponsor: "Raj Mamodia",
      businessObjective: "Improve sales velocity",
      sponsorConversation: bigTranscript,
      _roleBindings: JSON.stringify({ "Solution Architect": { name: "Priya" } }),
    },
    listen: {
      interviewTranscripts: bigTranscript + " listen",
      interviewRoster: JSON.stringify([{ name: "Smitha" }]),
      contradictionLog: "[]",
    },
  },
});

describe("transcript externalization — split/merge core", () => {
  it("split pulls the large transcripts out and shrinks the blob", () => {
    const { inner, texts } = splitExternalTexts(sampleInner());
    // both transcripts extracted
    expect(texts.map((t) => t.fieldKey).sort()).toEqual(["interviewTranscripts", "sponsorConversation"]);
    expect(texts.find((t) => t.fieldKey === "sponsorConversation")?.movementId).toBe("frame");
    // removed from the blob
    expect((inner.phaseInputs as any).frame.sponsorConversation).toBeUndefined();
    expect((inner.phaseInputs as any).listen.interviewTranscripts).toBeUndefined();
    // everything else untouched
    expect((inner.phaseInputs as any).frame.sponsor).toBe("Raj Mamodia");
    expect((inner.phaseInputs as any).frame._roleBindings).toBeTruthy();
    expect((inner.phaseInputs as any).listen.contradictionLog).toBe("[]");
    // the split blob is dramatically smaller
    expect(JSON.stringify(inner).length).toBeLessThan(JSON.stringify(sampleInner()).length / 2);
  });

  it("merge(split(x)) restores every value — the correctness gate", () => {
    // Deep value-equality (order-independent): merge re-adds the field at the
    // end of the bucket, but readers access fields by name and
    // movementInputsFingerprint sorts keys before hashing, so field ORDER is
    // irrelevant — only the values must round-trip exactly.
    const original = sampleInner();
    const { inner, texts } = splitExternalTexts(original);
    const restored = mergeExternalTexts(inner, texts);
    expect(restored).toEqual(original);
    // and the transcript content is preserved to the byte
    expect((restored.phaseInputs as any).frame.sponsorConversation)
      .toBe((original.phaseInputs as any).frame.sponsorConversation);
  });

  it("small values below the threshold stay inline (not worth a row)", () => {
    const inner = { phaseInputs: { frame: { sponsorConversation: "a short note" } } };
    const { texts, inner: out } = splitExternalTexts(inner);
    expect(texts).toHaveLength(0);
    expect((out.phaseInputs as any).frame.sponsorConversation).toBe("a short note");
  });

  it("merge never overwrites a fresher inline value (inline wins during dual-read)", () => {
    const fresherInline = bigTranscript + " EDITED INLINE";
    const inner = { phaseInputs: { frame: { sponsorConversation: fresherInline } } };
    const staleText = [{ fieldKey: "sponsorConversation", movementId: "frame", content: bigTranscript }];
    const merged = mergeExternalTexts(inner, staleText);
    expect((merged.phaseInputs as any).frame.sponsorConversation).toBe(fresherInline);
  });

  it("hasInlineExternalText detects un-split blobs", () => {
    expect(hasInlineExternalText(sampleInner())).toBe(true);
    const { inner } = splitExternalTexts(sampleInner());
    expect(hasInlineExternalText(inner)).toBe(false);
  });
});
