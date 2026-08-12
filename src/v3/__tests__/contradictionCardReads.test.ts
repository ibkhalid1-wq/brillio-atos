/**
 * THE OPERATOR WAS ASKED TO CONFIRM A CLAIM THEY COULD NOT PARSE.
 *
 * A contradiction card surfaced this as the thing to decide on:
 *
 *   "Audit/previous-value fields dropped 9 Use proper change-history tracking in
 *    new system"
 *
 * Three columns of a spreadsheet row with a bare count wedged in the middle.
 * Evidence extracted from a workbook arrives TAB-separated — one line per row,
 * one tab per column — and HTML collapses tabs to a single space, so the row
 * reassembled itself into a run-on sentence somewhere between the extractor and
 * the card. Nothing was wrong with the data; the separator simply stopped
 * existing on the way to the screen.
 *
 * Two smaller things on the same card read as noise for the same reason — the
 * words were doing a job the reader could not see them doing:
 *
 *   "1 open row file — …"    `file` is the verb, and it landed directly after a
 *                            noun, so it read as a compound noun (a row-file).
 *   "File 1 contradiction…"  `File` is the imperative verb, on a card whose
 *                            evidence IS an attached file.
 */
import { describe, it, expect } from "vitest";
import { readableEvidenceLine, negatedClaimProposal } from "@/v3/components/flow/flowWatchers";
import { flowMovements } from "@/v3/components/flow/flowShellData";
import type { ProgramSummary } from "@/new/types";

describe("an extracted spreadsheet row still reads as a row", () => {
  it("REGRESSION: columns keep a visible separator", () => {
    const raw = "Audit/previous-value fields dropped\t9\tUse proper change-history tracking in new system";
    const out = readableEvidenceLine(raw);
    expect(out).toBe("Audit/previous-value fields dropped · 9 · Use proper change-history tracking in new system");
    // the specific failure: the count silently joined to the words on either side
    expect(out, "the columns ran together again").not.toContain("dropped 9 Use");
  });

  it("a run of tabs is one separator, not several", () => {
    expect(readableEvidenceLine("Field\t\t\tType")).toBe("Field · Type");
    expect(readableEvidenceLine("A\tB\t\tC")).toBe("A · B · C");
  });

  it("ordinary prose is untouched", () => {
    // The commonest evidence is an interview sentence, and it must not acquire
    // punctuation it never had.
    const prose = "The finance team says invoices are raised weekly, not monthly.";
    expect(readableEvidenceLine(prose)).toBe(prose);
  });

  it("collapses runaway spacing without inventing separators", () => {
    expect(readableEvidenceLine("Stage     name")).toBe("Stage name");
    expect(readableEvidenceLine("  padded  ")).toBe("padded");
  });

  it("an empty or separator-only line does not become a lone bullet", () => {
    expect(readableEvidenceLine("")).toBe("");
    expect(readableEvidenceLine("\t\t")).toBe("·");
  });
});

/**
 * THE CARD ITSELF, not just the helper.
 *
 * Testing `readableEvidenceLine` alone proved nothing about the screen: deleting
 * its call site left every case above green, because they exercised the tool and
 * never its use. What the operator reads is what the DETECTOR emits.
 */
describe("the statement the detector actually emits", () => {
  /** A programme with a standing charter claim and one tab-separated evidence row. */
  const withSpreadsheetEvidence = (): ProgramSummary => {
    const listen = flowMovements().find((m) => m.id === "listen")!;
    const field = (listen.inputFields ?? []).find((f) => f.type === "transcript" || f.type === "document");
    expect(field, "Listen has no evidence field — re-anchor this fixture").toBeTruthy();
    return {
      id: "p1", name: "T",
      rawData: {
        data: {
          transformationCharter: {
            approach: "The programme keeps audit and previous-value fields for change history throughout.",
          },
          phaseInputs: {
            listen: {
              [field!.id]: [
                "— Dana Patel, RevOps, 2026-08-12 —",
                "Audit/previous-value fields dropped\t9\tUse proper change-history tracking in new system",
              ].join("\n"),
            },
          },
        },
      },
    } as unknown as ProgramSummary;
  };

  it("REGRESSION: the emitted statement keeps its columns apart", () => {
    const proposal = negatedClaimProposal(withSpreadsheetEvidence());
    expect(proposal, "the detector found nothing — this case would prove nothing").toBeTruthy();
    const entries = (proposal!.payload as { contradictionEntries: Array<{ statement: string }> }).contradictionEntries;
    expect(entries.length).toBeGreaterThan(0);
    const statement = entries[0].statement;
    expect(statement, "the columns ran together on the card").not.toContain("dropped 9 Use");
    expect(statement).toContain(" · ");
  });

  it("and so does the quoted evidence in its positions line", () => {
    const proposal = negatedClaimProposal(withSpreadsheetEvidence())!;
    const entries = (proposal.payload as { contradictionEntries: Array<{ positions: string }> }).contradictionEntries;
    expect(entries[0].positions).not.toContain("dropped 9 Use");
  });
});

describe("the card's words say what they do", () => {
  const SRC = (f: string) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:fs").readFileSync(require("node:path").resolve(__dirname, `../components/flow/${f}`), "utf8") as string;

  it("REGRESSION: the effect line reads as a sentence about its target", () => {
    const s = SRC("flowDecisions.ts");
    expect(s, "'N open rows file' reads as a compound noun").not.toContain("open row${entries.length === 1 ? \"\" : \"s\"} file");
    expect(s).toContain("gains ${entries.length} open row");
  });

  it("REGRESSION: the title's verb cannot be read as the noun", () => {
    const s = SRC("flowWatchers.ts");
    expect(s, "'File N contradictions' on a card whose evidence is a file").not.toMatch(/title: `File \$\{found\.length\} contradiction/);
    expect(s).toMatch(/title: `Log \$\{found\.length\} contradiction/);
  });

  it("the recommended action names the act, not the destination", () => {
    expect(SRC("flowWatchers.ts")).toContain('action: "Log the contradiction"');
  });
});
