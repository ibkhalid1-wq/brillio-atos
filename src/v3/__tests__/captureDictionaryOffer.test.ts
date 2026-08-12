/**
 * A DICTIONARY ATTACHED TO THE RECORD IS STILL A DICTIONARY.
 *
 * "Add to the record" on Discover files a document as evidence: the edge flattens
 * it to prose and it lands as a "— Document —" entry attributed to a person. That
 * is the right home for an interview transcript and the wrong one for a data
 * dictionary, whose entire value is in its columns. Filed as prose, a workbook of
 * 275 answered field types reads fine and closes nothing — and the operator has no
 * way to tell, because it looks like it worked.
 *
 * So the attachment is read a SECOND way, by the same parser the Inbox ask uses,
 * and when it parses the operator is told and offered the import.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: redirect. They attached it to the record, so
 * it still becomes evidence — the offer is additive. Silently importing a file
 * someone dropped into an evidence box would be the same class of defect in the
 * other direction: an action nobody asked for, on the strength of a guess about
 * what a file is.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LINE = readFileSync(resolve(__dirname, "../components/flow/TheLine.tsx"), "utf8");
const CAPTURE = readFileSync(resolve(__dirname, "../components/flow/flowCapture.tsx"), "utf8");
const INBOX = readFileSync(resolve(__dirname, "../components/flow/OperatorInbox.tsx"), "utf8");

/** The capture panel's dictionary block, so a scan cannot drift onto other code. */
const offerBlock = (): string => {
  const start = LINE.indexOf("const readAttachedDictionary");
  expect(start, "the capture-panel dictionary reader is gone — re-anchor this scan").toBeGreaterThan(-1);
  return LINE.slice(start, LINE.indexOf("const openCapture", start));
};

describe("the attach control hands back the raw file", () => {
  it("AttachFileButton exposes onFiles — the edge's prose cannot be re-read as columns", () => {
    expect(CAPTURE).toContain("onFiles?: (files: File[]) => void");
    expect(CAPTURE, "onFiles is declared but never called").toContain("onFiles?.(files)");
  });

  it("ALL the selected files in one call, so a merging caller cannot race itself", () => {
    // One call per file would have each result computed from a `capDict` the
    // previous had not written yet, and the last writer would win.
    expect(CAPTURE, "the attach input is single-file again").toMatch(/type="file" multiple/);
    expect(CAPTURE, "only the first file is handed over").not.toMatch(/onFiles\?\.\(\[?files\[0\]/);
  });

  it("and the capture panel passes it", () => {
    expect(LINE).toContain("onFiles={(files) => void readAttachedDictionary(files)}");
  });

  it("one unreadable file does not lose the others, and keeps its own reason", () => {
    // A single file reports the edge's own words ("That workbook is
    // password-protected."); only a real batch is summarised, and by name.
    expect(CAPTURE).toContain("const failed: Array<{ name: string; reason: string }> = []");
    expect(CAPTURE, "the loop aborts on the first failure").not.toMatch(/failed\.push[^\n]*\n?[^\n]*break;/);
    expect(CAPTURE).toContain("files.length === 1\n      ? failed[0].reason");
  });

  it("REGRESSION: attaching still files the document as evidence", () => {
    // The offer is additive. If this ever becomes an either/or, an operator who
    // attached a dictionary as evidence silently loses the evidence.
    expect(LINE).toContain("onExtracted={(filename, text, sourceKey) => setCapDocs(");
  });
});

describe("what the panel reads, and how it counts", () => {
  it("uses the SAME workbook reader and parser as the Inbox ask", () => {
    const block = offerBlock();
    expect(block).toContain("readDictionaryWorkbook");
    expect(block).toContain("parseDictionaryCsv");
    expect(block, "a spreadsheet would be read as text").toContain("isSpreadsheetName");
  });

  it("counts matches through the ONE locus rule, not a hand-written id", () => {
    // The preview promises "N of your open typing questions match". If this site
    // built the locus id its own way, that promise could disagree with what
    // committing actually closes.
    // `dictLocusId` is the resolver: it wraps `attrLocusId` and adds the bridge a
    // real export needs — a row binds by whichever of its two names (API name or
    // stated label) the ontology actually modelled.
    // `dictionaryCoverage` is the shared reading: it resolves each row through
    // `dictLocusId` (API name or stated label, whichever the ontology modelled) and
    // scopes the denominator to the entities the files actually name.
    expect(offerBlock()).toContain("dictionaryCoverage");
    expect(INBOX, "the Inbox kept its own copy of the locus rule").toContain("dictionaryCoverage");
    expect(offerBlock(), "a hand-rolled slug is back").not.toMatch(/replace\(\/\[\^a-z0-9\]/);
  });

  it("several files are merged into ONE reading, through the stored field's rule", () => {
    const block = offerBlock();
    expect(block).toContain("mergeDictionaryCsv");
    expect(block, "the files are read in parallel — the merge would race").toContain("for (const file of files)");
  });

  it("a file that is not a dictionary sets no offer, and is not an error", () => {
    const block = offerBlock();
    expect(block).toContain("if (!parsed.fields.length) { setCapDict(null); return; }");
    expect(block, "an unreadable file must not surface as a failure here").toContain("catch");
  });
});

describe("the offer is an offer", () => {
  it("nothing is applied without a click", () => {
    const block = offerBlock();
    expect(block, "the reader commits on its own — the operator never chose")
      .not.toContain("commitDictionary");
  });

  it("applying goes through the surface's existing write channel", () => {
    expect(LINE).toContain("commits.commitDictionary(capDict.csv, null)");
  });

  it("the button is absent when there is nothing to close", () => {
    // A dictionary matching no open locus would write claims nobody asked about.
    expect(LINE).toContain("commits.canWrite && capDict.closes > 0");
  });

  it("the zero case is still STATED — the miss stays visible", () => {
    expect(LINE).toContain("nothing here matches an open locus, so it would close nothing");
  });

  it("the copy says where it lands and that it is deviatable", () => {
    // Applied claims are code-derived · weak; an operator reading this should know
    // it does not overrule anybody, and that per-system uploads live in the Inbox.
    expect(LINE).toContain("code-derived");
    expect(LINE).toMatch(/programme-wide/);
  });

  it("a new capture does not inherit the previous file's reading", () => {
    expect(LINE).toContain("setCapDict(null);   // a new capture starts with no reading of a previous file");
  });
});
