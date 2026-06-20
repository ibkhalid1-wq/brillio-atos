import { useEffect, useState } from "react";
import { FormattedDocument } from "@/components/FormattedDocument";

interface ChecklistItem {
  item: string;
  done: boolean;
}

interface ClosureReport {
  content: string;
  generatedAt: number;
  status: string;
  signedOffBy: string | null;
  signedOffAt: number | null;
  handoverChecklist: ChecklistItem[];
}

interface Props {
  report: ClosureReport | null;
  programStatus: string;
  programName: string;
  focusTab?: "report" | "checklist";
  focusToken?: number;
  onGenerate: () => Promise<void>;
  onToggleItem: (index: number) => void;
  onSignOff: (name: string) => void;
  onRegenerate: () => Promise<void>;
}

export function ClosureView({
  report,
  programStatus,
  programName,
  focusTab,
  focusToken = 0,
  onGenerate,
  onToggleItem,
  onSignOff,
  onRegenerate,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [signName, setSignName] = useState("");
  const [tab, setTab] = useState<"report" | "checklist">("report");
  const [showSign, setShowSign] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    await onGenerate();
    setLoading(false);
  }

  async function handleRegenerate() {
    setLoading(true);
    await onRegenerate();
    setLoading(false);
  }

  const checklistDone = report?.handoverChecklist?.filter((item) => item.done).length ?? 0;
  const checklistTotal = report?.handoverChecklist?.length ?? 0;
  const allChecked = checklistDone === checklistTotal && checklistTotal > 0;

  useEffect(() => {
    if (!focusTab) return;
    setTab(focusTab);
  }, [focusTab, focusToken]);

  function downloadReport() {
    if (!report) return;
    const blob = new Blob([report.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${programName.replace(/\s+/g, "-")}-closure-report.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Program Closure</h2>
          {programStatus === "closed" ? (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded ml-2">Closed</span>
          ) : null}
        </div>
        <div className="flex gap-2">
          {report ? (
            <>
              <button
                type="button"
                onClick={downloadReport}
                className="text-sm px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200"
              >
                Download .md
              </button>
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={loading}
                className="text-sm px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
              >
                Regenerate
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? "Generating..." : "Generate Closure Report"}
            </button>
          )}
        </div>
      </div>

      {!report ? (
        <div className="border rounded p-8 text-center text-gray-400 text-sm">
          <p>No closure report generated yet.</p>
          <p className="text-xs mt-1">
            The agent will auto-generate this when the Value Realization phase is active, or you can trigger it manually above.
          </p>
        </div>
      ) : (
        <>
          <div
            className={`flex items-center justify-between border rounded px-3 py-2 text-sm ${
              report.status === "signed_off" ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"
            }`}
          >
            <div>
              <span className="font-medium">
                {report.status === "signed_off" ? "Signed Off" : "Draft - awaiting sign-off"}
              </span>
              {report.signedOffBy ? (
                <span className="text-xs text-gray-500 ml-2">
                  by {report.signedOffBy} on {new Date(report.signedOffAt || 0).toLocaleDateString()}
                </span>
              ) : null}
            </div>
            {report.status !== "signed_off" && allChecked && !showSign ? (
              <button
                type="button"
                onClick={() => setShowSign(true)}
                className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
              >
                Sign Off Program
              </button>
            ) : null}
            {report.status !== "signed_off" && !allChecked ? (
              <span className="text-xs text-yellow-700">Complete handover checklist to unlock sign-off</span>
            ) : null}
          </div>

          {showSign ? (
            <div className="flex gap-2 items-center border rounded p-2 bg-gray-50">
              <input
                placeholder="Your name"
                value={signName}
                onChange={(event) => setSignName(event.target.value)}
                className="border rounded px-2 py-1 text-sm flex-1"
              />
              <button
                type="button"
                onClick={() => {
                  onSignOff(signName);
                  setShowSign(false);
                }}
                disabled={!signName.trim()}
                className="bg-green-600 text-white text-sm px-3 py-1 rounded disabled:opacity-50"
              >
                Confirm Sign-Off
              </button>
              <button
                type="button"
                onClick={() => setShowSign(false)}
                className="text-sm px-3 py-1 rounded bg-gray-200"
              >
                Cancel
              </button>
            </div>
          ) : null}

          <div className="flex gap-2 border-b">
            {(["report", "checklist"] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setTab(entry)}
                className={`text-sm px-3 py-1.5 border-b-2 capitalize ${
                  tab === entry ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-500"
                }`}
              >
                {entry === "checklist" ? `Handover Checklist (${checklistDone}/${checklistTotal})` : "Closure Report"}
              </button>
            ))}
          </div>

          {tab === "report" ? (
            <div className="border rounded p-4 bg-white">
              <FormattedDocument content={report.content} />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
                <div
                  className="bg-green-500 h-2 rounded-full transition-all"
                  style={{ width: `${checklistTotal > 0 ? (checklistDone / checklistTotal) * 100 : 0}%` }}
                />
              </div>
              {(report.handoverChecklist || []).map((item, index) => (
                <label
                  key={`${item.item}-${index}`}
                  className={`flex items-start gap-2 border rounded p-2 cursor-pointer text-sm ${
                    item.done ? "bg-green-50 border-green-200" : "hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() => onToggleItem(index)}
                    className="mt-0.5 shrink-0"
                    disabled={report.status === "signed_off"}
                  />
                  <span className={item.done ? "line-through text-gray-400" : ""}>{item.item}</span>
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
