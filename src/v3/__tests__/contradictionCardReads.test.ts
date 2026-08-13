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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readableEvidenceLine, negatedClaimProposal } from "@/v3/components/flow/flowWatchers";
import { flowMovements } from "@/v3/components/flow/flowShellData";
import { contradictionKey, isContradictionHandled } from "@/v3/components/flow/flowDecisions";
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
  /**
   * A programme with a standing charter claim and one line of evidence.
   *
   * `line` is the only variable: a three-column SHEET ROW and a one-tab CLAIM are
   * treated differently on purpose (see "a table row is not a claim" below).
   */
  const withEvidence = (line: string): ProgramSummary => {
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
              [field!.id]: `— Dana Patel, RevOps, 2026-08-12 —\n${line}`,
            },
          },
        },
      },
    } as unknown as ProgramSummary;
  };

  /** A claim somebody asserts, carrying ONE tab — a "label: value" note. */
  const CLAIM = "Audit/previous-value fields dropped\tthe team no longer keeps change history";
  /** A row of an uploaded gap sheet: a gap, a COUNT, a recommendation. */
  const ROW = "Audit/previous-value fields dropped\t9\tUse proper change-history tracking in new system";

  it("REGRESSION: the emitted statement keeps its columns apart", () => {
    const proposal = negatedClaimProposal(withEvidence(CLAIM));
    expect(proposal, "the detector found nothing — this case would prove nothing").toBeTruthy();
    const entries = (proposal!.payload as { contradictionEntries: Array<{ statement: string }> }).contradictionEntries;
    expect(entries.length).toBeGreaterThan(0);
    const statement = entries[0].statement;
    expect(statement, "the columns ran together on the card").not.toContain("dropped the team");
    expect(statement).toContain(" · ");
  });

  it("and so does the quoted evidence in its positions line", () => {
    const proposal = negatedClaimProposal(withEvidence(CLAIM))!;
    const entries = (proposal.payload as { contradictionEntries: Array<{ positions: string }> }).contradictionEntries;
    expect(entries[0].positions).not.toContain("dropped the team");
  });

  /**
   * A TABLE ROW IS NOT A CLAIM (2026-08-12). Reported from the running Inbox:
   * "not clear what the contradiction is". It was not clear because there was no
   * contradiction — the only one on Laila New was one row of an uploaded schema-gap
   * sheet, matched to the charter's objective because both contain "system".
   *
   * This REVERSES the earlier reading of the same row. Rendering it legibly (the
   * helper above, still exercised by CLAIM) was the wrong layer: a row rendered
   * beautifully is still not a proposition, and the operator was being asked to
   * adjudicate a dispute between a spreadsheet and an objective.
   */
  it("a three-column sheet row is not a contradiction at all", () => {
    // MUTATION: drop the `>= 2` tab guard in flowWatchers → a proposal appears.
    expect(negatedClaimProposal(withEvidence(ROW)),
      "a gap/count/recommendation row was filed as a dispute").toBeNull();
  });

  it("but a claim carrying one tab is still heard", () => {
    // The guard must cut ROWS, not evidence that happens to contain a tab. If this
    // passes while the row case passes, the rule discriminates rather than silences.
    expect(negatedClaimProposal(withEvidence(CLAIM))).toBeTruthy();
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

/**
 * THE SAME CONTRADICTION, TWICE, ONE IN EACH SPELLING.
 *
 * Changing how a statement is written re-minted every outstanding card. The
 * handled-check compared statements by substring, so once the extractor began
 * separating spreadsheet columns with " · ", the new text no longer CONTAINED the
 * old and the old no longer contained the new — a formatting change read as a
 * fresh dispute, and the operator was asked to file the same finding again.
 *
 * The lesson is not "that one string": it is that a dedup key must survive the
 * text being written down differently, because it will be.
 */
describe("a reformatted statement is the same contradiction", () => {
  const OLD = "Audit/previous-value fields dropped 9 Use proper change-history tracking in new system";
  const NEW = "Audit/previous-value fields dropped · 9 · Use proper change-history tracking in new system";

  it("REGRESSION: the separator change does not mint a second card", () => {
    expect(isContradictionHandled([OLD.toLowerCase()], NEW), "filed twice, once per spelling").toBe(true);
    expect(isContradictionHandled([NEW.toLowerCase()], OLD)).toBe(true);
  });

  it("and neither does any other punctuation or spacing drift", () => {
    expect(isContradictionHandled([OLD], "audit/previous value fields dropped, 9 — use proper change-history tracking in new system")).toBe(true);
    expect(isContradictionHandled([OLD], "AUDIT PREVIOUS VALUE FIELDS DROPPED 9 USE PROPER CHANGE HISTORY TRACKING IN NEW SYSTEM")).toBe(true);
  });

  it("a genuinely different statement is still unhandled", () => {
    // The guard against over-matching: keying on words must not collapse two
    // findings into one.
    expect(isContradictionHandled([OLD], "Quote table is no longer the sole record of amendments")).toBe(false);
  });

  it("the key ignores punctuation but keeps the words", () => {
    expect(contradictionKey("Audit/previous-value  fields · dropped")).toBe("audit previous value fields dropped");
    expect(contradictionKey("   ")).toBe("");
  });

  it("the card's ID is stable across the same reformatting", () => {
    // Two programmes whose evidence differs only in the separator must produce the
    // same decision id, or the id itself becomes a second way to duplicate.
    const idFor = (line: string) => {
      const listen = flowMovements().find((m) => m.id === "listen")!;
      const field = (listen.inputFields ?? []).find((f) => f.type === "transcript" || f.type === "document")!;
      const program = {
        id: "p1", name: "T",
        rawData: { data: {
          transformationCharter: { approach: "The programme keeps audit and previous-value fields for change history throughout." },
          phaseInputs: { listen: { [field.id]: `— Dana Patel, RevOps, 2026-08-12 —\n${line}` } },
        } },
      } as unknown as ProgramSummary;
      return negatedClaimProposal(program)?.id ?? null;
    };
    const a = idFor("Audit/previous-value fields dropped\tthe team no longer keeps change history");
    const b = idFor("Audit/previous-value fields dropped, the team no longer keeps change history");
    expect(a, "the detector found nothing — this case would prove nothing").toBeTruthy();
    expect(a).toBe(b);
  });
});

describe("the card says what is in conflict", () => {
  const proposal = () => {
    const listen = flowMovements().find((m) => m.id === "listen")!;
    const field = (listen.inputFields ?? []).find((f) => f.type === "transcript" || f.type === "document")!;
    return negatedClaimProposal({
      id: "p1", name: "T",
      rawData: { data: {
        transformationCharter: { approach: "The programme keeps audit and previous-value fields for change history throughout." },
        phaseInputs: { listen: { [field.id]: "— Dana Patel, RevOps, 2026-08-12 —\nAudit/previous-value fields dropped\tthe team no longer keeps change history" } },
      } },
    } as unknown as ProgramSummary);
  };

  it("REGRESSION: the summary carries BOTH sides, not a second copy of one", () => {
    // The diff row already shows the statement verbatim. What the summary owes the
    // operator is the thing they cannot see anywhere else: the standing claim it
    // contradicts.
    const summary = proposal()!.summary ?? "";
    expect(summary).toContain("the charter still says");
    expect(summary).toContain("audit and previous-value fields");
  });

  it("the recommendation block does not repeat the button's words", () => {
    const shell = readFileSync(resolve(__dirname, "../components/flow/FlowShell.tsx"), "utf8");
    expect(shell, "'Recommended — {action}' sits above a button built from the same string")
      .not.toContain("Recommended — {decision.recommendation.action}");
    expect(shell, "the button must still name the act").toContain('decision.recommendation?.action || "Confirm"');
  });
});
