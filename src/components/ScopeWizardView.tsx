import { useEffect, useState } from "react";
import { FormattedDocument } from "@/components/FormattedDocument";

const STEPS = [
  { id: "objectives", label: "Objectives", prompt: "What are the 3-5 primary objectives this programme must achieve?" },
  { id: "in_scope", label: "In Scope", prompt: "List all work, deliverables, systems, and processes that ARE in scope." },
  { id: "out_of_scope", label: "Out of Scope", prompt: "List items explicitly EXCLUDED from this programme." },
  { id: "constraints", label: "Constraints", prompt: "What budget, time, resource, or regulatory constraints apply?" },
  { id: "dependencies", label: "Dependencies", prompt: "What external factors or deliverables does this programme depend on?" },
  { id: "assumptions", label: "Assumptions", prompt: "What assumptions is this programme making?" },
  { id: "success_criteria", label: "Success Criteria", prompt: "How will success be measured? What are the KPIs?" },
];

interface ScopeStatement {
  objectives: string[];
  in_scope: string[];
  out_of_scope: string[];
  constraints: string[];
  dependencies: string[];
  assumptions: string[];
  success_criteria: string[];
  lastUpdatedAt: number | null;
  baselinedAt: number | null;
  version: number;
}

interface Props {
  scopeStatement: ScopeStatement;
  onSaveStep: (stepId: string, items: string[]) => void;
  onBaseline: () => void;
  onAIAssist: (stepId: string, input: string) => Promise<string[]>;
  onExport: () => Promise<string | null>;
}

export function ScopeWizardView({
  scopeStatement,
  onSaveStep,
  onBaseline,
  onAIAssist,
  onExport,
}: Props) {
  const [activeStep, setActiveStep] = useState(0);
  const [inputText, setInputText] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [view, setView] = useState<"wizard" | "document">("wizard");
  const [documentContent, setDocumentContent] = useState<string | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);

  const step = STEPS[activeStep];
  const stepItems = (scopeStatement?.[step.id as keyof ScopeStatement] as string[]) || [];
  const completed = STEPS.filter((entry) => (((scopeStatement?.[entry.id as keyof ScopeStatement] as string[]) || []).length > 0)).length;

  useEffect(() => {
    setItems([...(stepItems || [])]);
  }, [activeStep, scopeStatement]);

  async function handleAiAssist() {
    if (!inputText.trim()) return;
    setAiLoading(true);
    const suggested = await onAIAssist(step.id, inputText);
    setItems((previous) => [...previous, ...suggested.filter((item) => !previous.includes(item))]);
    setInputText("");
    setAiLoading(false);
  }

  function saveAndNext() {
    onSaveStep(step.id, items);
    if (activeStep < STEPS.length - 1) {
      setActiveStep((value) => value + 1);
      setInputText("");
      setNewItem("");
    }
  }

  function loadStep(index: number) {
    onSaveStep(step.id, items);
    setActiveStep(index);
    setInputText("");
    setNewItem("");
  }

  function addItem() {
    if (!newItem.trim()) return;
    setItems((previous) => [...previous, newItem.trim()]);
    setNewItem("");
  }

  function removeItem(index: number) {
    setItems((previous) => previous.filter((_, entryIndex) => entryIndex !== index));
  }

  async function loadDocument() {
    setDocumentLoading(true);
    const content = await onExport();
    setDocumentContent(content);
    setDocumentLoading(false);
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Scope Statement Wizard</h2>
          <p className="text-xs text-gray-400">
            {completed}/{STEPS.length} sections completed
            {scopeStatement?.baselinedAt ? (
              <span className="ml-2 text-green-600">✓ Baselined v{scopeStatement.version}</span>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setView((current) => current === "wizard" ? "document" : "wizard")}
            className="text-xs px-3 py-1 rounded bg-gray-100 hover:bg-gray-200"
          >
            {view === "wizard" ? "View Document" : "Back to Wizard"}
          </button>
          {completed >= STEPS.length && !scopeStatement?.baselinedAt ? (
            <button
              type="button"
              onClick={onBaseline}
              className="text-xs px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700"
            >
              Baseline Scope
            </button>
          ) : null}
        </div>
      </div>

      {view === "document" ? (
        <div className="space-y-3">
          {!documentContent ? (
            <button
              type="button"
              onClick={loadDocument}
              disabled={documentLoading}
              className="bg-indigo-600 text-white text-sm px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {documentLoading ? "Generating..." : "Generate Formal Scope Statement"}
            </button>
          ) : (
            <div className="border rounded p-4 bg-white">
              <FormattedDocument content={documentContent} />
              <button type="button" onClick={() => setDocumentContent(null)} className="mt-2 text-xs text-gray-400">
                Regenerate
              </button>
            </div>
          )}

          <div className="space-y-2">
            {STEPS.map((entry) => {
              const sectionItems = (scopeStatement?.[entry.id as keyof ScopeStatement] as string[]) || [];
              return (
                <div key={entry.id} className="border rounded p-3">
                  <h3 className="text-sm font-semibold mb-1">{entry.label}</h3>
                  {sectionItems.length ? (
                    <ul className="list-disc pl-4 text-xs text-gray-700 space-y-0.5">
                      {sectionItems.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                    </ul>
                  ) : (
                    <p className="text-xs text-gray-400">Not completed.</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex gap-4 h-[500px]">
          <div className="w-36 shrink-0 border-r pr-2 space-y-1">
            {STEPS.map((entry, index) => {
              const done = (((scopeStatement?.[entry.id as keyof ScopeStatement] as string[]) || []).length > 0);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => loadStep(index)}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded flex items-center gap-1.5 ${
                    activeStep === index ? "bg-indigo-600 text-white" : "hover:bg-gray-50 text-gray-700"
                  }`}
                >
                  <span>{done ? "✓" : `${index + 1}.`}</span>
                  <span>{entry.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 flex flex-col gap-3">
            <div className="bg-indigo-50 border border-indigo-100 rounded p-3">
              <h3 className="text-sm font-semibold text-indigo-800">{step.label}</h3>
              <p className="text-xs text-indigo-600 mt-0.5">{step.prompt}</p>
            </div>

            <div className="flex gap-2">
              <textarea
                placeholder="Describe this section in your own words — AI will expand and structure it..."
                rows={3}
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                className="flex-1 border rounded px-2 py-1 text-sm resize-none"
              />
              <button
                type="button"
                onClick={handleAiAssist}
                disabled={aiLoading || !inputText.trim()}
                className="shrink-0 bg-indigo-600 text-white text-xs px-3 rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {aiLoading ? "..." : "AI Expand"}
              </button>
            </div>

            <div className="flex gap-2">
              <input
                placeholder="Or type an item directly and press Add..."
                value={newItem}
                onChange={(event) => setNewItem(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addItem();
                  }
                }}
                className="flex-1 border rounded px-2 py-1 text-sm"
              />
              <button type="button" onClick={addItem} className="text-xs px-3 py-1 rounded bg-gray-100 hover:bg-gray-200">
                Add
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1">
              {!items.length ? (
                <p className="text-xs text-gray-400 text-center pt-4">No items yet. Use AI assist or add manually.</p>
              ) : null}
              {items.map((item, index) => (
                <div key={`${item}-${index}`} className="flex items-start gap-2 border rounded px-2 py-1.5 text-sm bg-white group">
                  <span className="text-gray-400 text-xs mt-0.5 shrink-0">{index + 1}.</span>
                  <span className="flex-1">{item}</span>
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="text-red-400 opacity-0 group-hover:opacity-100 shrink-0 text-xs"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-between pt-2 border-t">
              <button
                type="button"
                onClick={() => activeStep > 0 && loadStep(activeStep - 1)}
                disabled={activeStep === 0}
                className="text-sm px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-30"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={saveAndNext}
                className="text-sm px-4 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700"
              >
                {activeStep === STEPS.length - 1 ? "Save & Finish" : "Save & Next →"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
