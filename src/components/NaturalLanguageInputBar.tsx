import { useState } from "react";
import { applyCapturedCopilotInputs, captureCopilotInputs } from "@/lib/adamCopilot";

type Props = {
  phaseId: string;
  activeView: string;
  phaseFields: Array<{ id: string; label: string; placeholder?: string }>;
  onApplied: (appliedCount: number) => void;
  onError?: (message: string) => void;
};

type ParsePreview = {
  capturedFields: Record<string, string>;
  fieldConfidence: Record<string, "high" | "medium" | "low">;
  captureSummary: string[];
  stillMissing: string[];
};

type Mode = "collapsed" | "input" | "preview";

const NL_PLACEHOLDERS: Record<string, string> = {
  strategy: "e.g. We are embarking on an AI transformation to automate our credit risk assessment. The executive sponsor is the CFO, investment envelope is £2M, and we need results within 12 months. Success means 40% faster decisioning with no increase in default rate…",
  mobilise: "e.g. Jane Smith will lead the program starting March 2026. Our governance cadence is fortnightly steering. We are taking an agile change approach with 3-week sprints…",
  discover: "e.g. The core problem is manual invoice matching — 3 FTEs spend 4 days per cycle. Target is same-day processing with 90% automation. KPI: cycle time from 4 days to 4 hours. GDPR applies…",
  design: "e.g. We will build an L2 autonomous agent using Azure OpenAI. Agent pattern: document extraction → classification → routing. HITL triggers when confidence < 0.75. NFR: 99.5% uptime…",
  build: "e.g. Target platform is Azure AKS. MVP scope is extraction and classification only. Validation metric: 90% classification accuracy on 500 test invoices…",
  operate: "e.g. GDPR Article 22 applies to automated decisions. Control gap: no explainability log. HITL model: any decision >£50k requires human sign-off…",
  govern: "e.g. Regulatory scope: GDPR and internal AI policy v2.1. Control gap: no model versioning policy. Quarterly audit cadence agreed with Internal Audit…",
  optimize: "e.g. Current cycle time is 6h, target 4h. Value leakage: 18% of invoices still routed to manual queue. Reuse signal: extraction component could serve PO matching…",
  valuerealize: "e.g. Cycle time achieved: 5.2h vs 96h baseline — 95% reduction. Agent ROI: £1.4M annualised saving from FTE redeployment. Unrealised: e-invoicing adoption still at 60%…",
};

const CONF_STYLES = {
  high: "bg-green-100 text-green-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-gray-100 text-gray-500",
};

function ConfidencePill({ level }: { level: "high" | "medium" | "low" }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${CONF_STYLES[level] ?? CONF_STYLES.low}`}>
      {level}
    </span>
  );
}

export function NaturalLanguageInputBar({
  phaseId,
  activeView,
  phaseFields,
  onApplied,
  onError,
}: Props) {
  const [mode, setMode] = useState<Mode>("collapsed");
  const [nlText, setNlText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<ParsePreview | null>(null);

  if ((phaseFields ?? []).length === 0) return null;

  const placeholder = NL_PLACEHOLDERS[phaseId] ?? "Describe this phase in plain English so ADAM can populate the workspace.";

  function getFieldLabel(fieldId: string): string {
    return phaseFields.find((field) => field.id === fieldId)?.label ?? fieldId;
  }

  function truncateValue(value: string): string {
    return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  }

  function notify(message: string) {
    if (onError) onError(message);
    else console.warn("[NaturalLanguageInputBar]", message);
  }

  async function handleParse() {
    setParsing(true);
    try {
      const result = await captureCopilotInputs(activeView, nlText, []);
      setPreview({
        capturedFields: result?.capturedFields ?? {},
        fieldConfidence: result?.fieldConfidence ?? {},
        captureSummary: result?.captureSummary ?? [],
        stillMissing: result?.stillMissing ?? [],
      });
      setMode("preview");
    } catch {
      notify("Could not parse input — try adding more detail");
    } finally {
      setParsing(false);
    }
  }

  function handleApply() {
    if (!preview) return;
    const applied = applyCapturedCopilotInputs(activeView, preview);
    onApplied(applied?.length ?? 0);
    setMode("collapsed");
    setNlText("");
    setPreview(null);
  }

  function handleClose() {
    setMode("collapsed");
    setPreview(null);
    setNlText("");
    setParsing(false);
  }

  if (mode === "collapsed") {
    return (
      <button
        type="button"
        onClick={() => setMode("input")}
        className="mb-3 w-full cursor-pointer rounded-lg border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-2.5 text-left text-sm text-blue-700 hover:border-blue-300"
      >
        ✦ Describe this phase in your own words →
      </button>
    );
  }

  const fieldCount = Object.keys(preview?.capturedFields ?? {}).length;

  return (
    <div className="mb-3 rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-blue-600">{phaseId}</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">Natural language input</div>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="rounded px-2 py-1 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          ✕
        </button>
      </div>

      {mode === "input" ? (
        <>
          {parsing ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="animate-pulse space-y-3">
                <div className="h-4 w-1/3 rounded bg-slate-200" />
                <div className="h-4 w-full rounded bg-slate-200" />
                <div className="h-4 w-5/6 rounded bg-slate-200" />
                <div className="h-4 w-2/3 rounded bg-slate-200" />
              </div>
              <div className="mt-4 text-sm text-slate-500">Reading your input…</div>
            </div>
          ) : (
            <>
              <textarea
                value={nlText}
                onChange={(event) => setNlText(event.target.value)}
                rows={5}
                placeholder={placeholder}
                className="min-h-[140px] w-full resize-y rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10"
              />
              <div className="mt-2 text-right text-xs text-gray-400">{nlText.length} chars</div>
            </>
          )}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={handleParse}
              disabled={nlText.trim().length < 30 || parsing}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {parsing ? "Parsing…" : "Parse & Preview"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}

      {mode === "preview" && preview ? (
        <>
          <div className="mb-3 text-sm font-semibold text-slate-900">✓ {fieldCount} fields detected — review before applying</div>
          <div className="space-y-2">
            {Object.entries(preview.capturedFields).map(([fieldId, value]) => (
              <div key={fieldId} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{getFieldLabel(fieldId)}</div>
                    <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{truncateValue(`${value ?? ""}`)}</div>
                  </div>
                  <ConfidencePill level={preview.fieldConfidence[fieldId] ?? "low"} />
                </div>
              </div>
            ))}
          </div>

          {preview.stillMissing.length ? (
            <div className="mt-3 text-xs text-gray-400">Still missing: {preview.stillMissing.join(", ")}</div>
          ) : null}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={handleApply}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
            >
              Apply to Workspace
            </button>
            <button
              type="button"
              onClick={() => setMode("input")}
              className="rounded-lg px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100"
            >
              Edit input
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
