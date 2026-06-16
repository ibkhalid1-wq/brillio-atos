import { htmlToStructuredText } from "@/new/lib/parseDocumentToText";

/**
 * parseDocx feeds mammoth.convertToHtml through htmlToStructuredText. These tests
 * pin the table-preservation contract: a metrics table flattened into one blob is
 * unrecoverable by the AI extractor, so each row must survive as a pipe line.
 */
describe("htmlToStructuredText", () => {
  it("renders table rows as pipe-delimited lines", () => {
    const html = `
      <p>Laila poc metrics</p>
      <table>
        <tr><td>Metric</td><td>Baseline</td><td>Target</td><td>Unit</td></tr>
        <tr><td>Qualification Accuracy</td><td>55%</td><td>80%</td><td>% correctly qualified</td></tr>
        <tr><td>Meeting Preparation Time</td><td>60</td><td>10</td><td>Minutes per customer meeting</td></tr>
      </table>`;

    const lines = htmlToStructuredText(html).split("\n").filter(Boolean);

    expect(lines).toContain("Laila poc metrics");
    expect(lines).toContain("Metric | Baseline | Target | Unit");
    expect(lines).toContain("Qualification Accuracy | 55% | 80% | % correctly qualified");
    expect(lines).toContain("Meeting Preparation Time | 60 | 10 | Minutes per customer meeting");
  });

  it("keeps each metric's baseline and target paired on its own row", () => {
    const html = `<table>
      <tr><th>Metric</th><th>Baseline</th><th>Target</th></tr>
      <tr><td>Agent Adoption</td><td>0%</td><td>70%</td></tr>
      <tr><td>Pipeline Influenced</td><td>$0</td><td>$2M+</td></tr>
    </table>`;

    const text = htmlToStructuredText(html);
    expect(text).toMatch(/Agent Adoption \| 0% \| 70%/);
    expect(text).toMatch(/Pipeline Influenced \| \$0 \| \$2M\+/);
  });

  it("preserves paragraph boundaries in surrounding prose", () => {
    const html = `<p>First paragraph.</p><p>Second paragraph.</p>`;
    const lines = htmlToStructuredText(html).split("\n").filter(Boolean);
    expect(lines).toEqual(["First paragraph.", "Second paragraph."]);
  });
});
