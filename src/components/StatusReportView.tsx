import React, { useState } from "react";
import { FormattedDocument } from "@/components/FormattedDocument";

const FORMATS = [
  { id: "weekly", label: "Weekly Status" },
  { id: "monthly", label: "Monthly Executive" },
  { id: "steering", label: "Steering Committee" },
  { id: "gate", label: "Gate Readiness" },
];
const RAG_LABELS: Record<string, string> = { green: "🟢 On Track", amber: "🟡 At Risk", red: "🔴 Off Track" };

interface Report {
  id: string;
  format: string;
  generatedAt: number;
  content: string;
  ragStatus: string;
  period: string;
}

interface Props {
  reports: Report[];
  onGenerate: (format: string) => Promise<Report | null>;
  onSave: (report: Report) => void;
}

export function StatusReportView({ reports, onGenerate, onSave }: Props) {
  const [selectedFormat, setSelectedFormat] = useState("weekly");
  const [loading, setLoading] = useState(false);
  const [activeReport, setActiveReport] = useState<Report | null>(reports[0] || null);

  async function generate() {
    setLoading(true);
    const report = await onGenerate(selectedFormat);
    if (report) {
      onSave(report);
      setActiveReport(report);
    }
    setLoading(false);
  }

  function copyToClipboard() {
    if (activeReport) navigator.clipboard.writeText(activeReport.content);
  }

  function downloadMarkdown() {
    if (!activeReport) return;
    const blob = new Blob([activeReport.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `status-report-${activeReport.period}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold">Status Report Generator</h2>

      <div className="flex gap-2 items-center flex-wrap">
        <select value={selectedFormat} onChange={(event) => setSelectedFormat(event.target.value)} className="border rounded px-2 py-1.5 text-sm">
          {FORMATS.map((format) => <option key={format.id} value={format.id}>{format.label}</option>)}
        </select>
        <button onClick={generate} disabled={loading} className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded hover:bg-indigo-700 disabled:opacity-50">
          {loading ? "Generating…" : `Generate ${FORMATS.find((format) => format.id === selectedFormat)?.label}`}
        </button>
        {activeReport ? (
          <>
            <button onClick={copyToClipboard} className="text-sm px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200">Copy</button>
            <button onClick={downloadMarkdown} className="text-sm px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200">Download .md</button>
          </>
        ) : null}
      </div>

      <div className="flex gap-4 h-[520px]">
        <div className="w-1/4 overflow-y-auto border-r pr-2 space-y-1">
          <p className="text-xs font-medium text-gray-500 mb-1">Report History</p>
          {!reports.length ? <p className="text-xs text-gray-400">No reports yet.</p> : null}
          {reports.map((report) => (
            <div key={report.id} onClick={() => setActiveReport(report)} className={`border rounded p-2 cursor-pointer text-xs ${activeReport?.id === report.id ? "border-indigo-400 bg-indigo-50" : "hover:bg-gray-50"}`}>
              <div className="flex justify-between items-center">
                <span className="font-medium">{FORMATS.find((format) => format.id === report.format)?.label}</span>
                <span>{RAG_LABELS[report.ragStatus]?.split(" ")[0]}</span>
              </div>
              <p className="text-gray-400 mt-0.5">{report.period} · {new Date(report.generatedAt).toLocaleDateString()}</p>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeReport ? (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm font-medium">{FORMATS.find((format) => format.id === activeReport.format)?.label}</span>
                <span className="text-sm">{RAG_LABELS[activeReport.ragStatus]}</span>
                <span className="text-xs text-gray-400">{new Date(activeReport.generatedAt).toLocaleString()}</span>
              </div>
              <div className="bg-white border rounded p-4">
                <FormattedDocument content={activeReport.content} />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              Generate a report or select from history.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
