import { extractDocxText } from "@/v3/lib/documentParser";

/** Minimal helpers to build OOXML fragments the way Word does. */
const t = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (text: string) => `<w:p><w:pPr/>${t(text)}</w:p>`;
const tc = (text: string) => `<w:tc><w:tcPr/><w:p>${t(text)}</w:p></w:tc>`;
const tr = (...cells: string[]) => `<w:tr><w:trPr/>${cells.map(tc).join("")}</w:tr>`;
const tbl = (...rows: string[]) => `<w:tbl><w:tblPr/><w:tblGrid/>${rows.join("")}</w:tbl>`;

describe("extractDocxText", () => {
  it("preserves table rows as pipe-delimited lines", () => {
    const xml = `<w:document><w:body>
      ${p("Laila poc metrics")}
      ${tbl(
        tr("Metric", "Baseline", "Target", "Unit"),
        tr("Qualification Accuracy", "55%", "80%", "% correctly qualified"),
        tr("Meeting Preparation Time", "60", "10", "Minutes per customer meeting"),
      )}
    </w:body></w:document>`;

    const text = extractDocxText(xml);
    const lines = text.split("\n").filter(Boolean);

    expect(lines).toContain("Laila poc metrics");
    expect(lines).toContain("Metric | Baseline | Target | Unit");
    expect(lines).toContain("Qualification Accuracy | 55% | 80% | % correctly qualified");
    expect(lines).toContain("Meeting Preparation Time | 60 | 10 | Minutes per customer meeting");
  });

  it("keeps each metric's baseline and target on its own row", () => {
    const xml = `<w:document><w:body>${tbl(
      tr("Metric", "Baseline", "Target"),
      tr("Agent Adoption", "0%", "70%"),
      tr("Pipeline Influenced", "$0", "$2M+"),
    )}</w:body></w:document>`;

    const text = extractDocxText(xml);
    // The flattened-blob bug merged all numbers into one stream; the row-aware
    // output must keep 0%→70% and $0→$2M+ paired on separate lines.
    expect(text).toMatch(/Agent Adoption \| 0% \| 70%/);
    expect(text).toMatch(/Pipeline Influenced \| \$0 \| \$2M\+/);
  });

  it("merges split text runs within a cell", () => {
    const splitCell = `<w:tc><w:tcPr/><w:p><w:r><w:t>Qualif</w:t></w:r><w:r><w:t>ication</w:t></w:r></w:p></w:tc>`;
    const xml = `<w:document><w:body><w:tbl>${`<w:tr>${splitCell}${tc("55%")}</w:tr>`}</w:tbl></w:body></w:document>`;
    expect(extractDocxText(xml)).toContain("Qualification | 55%");
  });
});
