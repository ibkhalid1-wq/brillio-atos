import React, { useEffect, useMemo, useState } from "react";

interface RetroQuestion {
  id: string;
  category: string;
  question: string;
}

interface RetroSession {
  questions: RetroQuestion[];
  responses?: Array<{ questionId: string; response: string }>;
  synthesis?: any;
  completedAt?: number;
}

interface Props {
  phaseId: string;
  session: RetroSession | null;
  pendingItem: { id: string; questions: RetroQuestion[] } | null;
  onSubmit: (phaseId: string, responses: Array<{ questionId: string; response: string }>) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  went_well: "bg-green-50 border-green-200",
  improve: "bg-yellow-50 border-yellow-200",
  blocker: "bg-red-50 border-red-200",
  surprise: "bg-blue-50 border-blue-200",
  carry_forward: "bg-purple-50 border-purple-200",
  lesson: "bg-gray-50 border-gray-200",
};

export function RetroView({ phaseId, session, pendingItem, onSubmit }: Props) {
  const questions = useMemo(() => session?.questions || pendingItem?.questions || [], [pendingItem, session]);
  const initialResponses = useMemo(() => {
    const map: Record<string, string> = {};
    (session?.responses || []).forEach((response) => {
      map[response.questionId] = response.response || "";
    });
    return map;
  }, [session?.responses]);
  const [responses, setResponses] = useState<Record<string, string>>(initialResponses);

  useEffect(() => {
    setResponses(initialResponses);
  }, [initialResponses, phaseId]);

  function handleSubmit() {
    const payload = questions.map((question) => ({
      questionId: question.id,
      response: responses[question.id] || "",
    }));
    onSubmit(phaseId, payload);
  }

  if (session?.completedAt && session?.synthesis) {
    const synthesis = session.synthesis;
    return (
      <div className="p-4 space-y-4">
        <h2 className="text-lg font-semibold capitalize">{phaseId} — Retrospective Summary</h2>
        <div>
          <h3 className="text-sm font-medium mb-1">Lessons Learned</h3>
          <ul className="list-disc pl-4 text-sm space-y-1">
            {(synthesis.lessons || []).map((lesson: string, index: number) => <li key={index}>{lesson}</li>)}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-medium mb-1">Process Improvements</h3>
          <ul className="list-disc pl-4 text-sm space-y-1">
            {(synthesis.improvements || []).map((improvement: string, index: number) => <li key={index}>{improvement}</li>)}
          </ul>
        </div>
        {synthesis.highlight ? (
          <div className="bg-green-50 border border-green-200 rounded p-3 text-sm">
            <span className="font-medium">Highlight: </span>
            {synthesis.highlight}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold capitalize">{phaseId} — Retrospective</h2>
      <p className="text-sm text-gray-500">Capture team responses. Synthesis feeds directly into Lessons Learned.</p>
      {questions.map((question) => (
        <div key={question.id} className={`rounded border p-3 ${CATEGORY_COLORS[question.category] || "bg-gray-50"}`}>
          <p className="text-xs text-gray-500 uppercase mb-1">{question.category.replace(/_/g, " ")}</p>
          <p className="text-sm font-medium mb-2">{question.question}</p>
          <textarea
            className="w-full border rounded p-2 text-sm resize-none"
            rows={3}
            placeholder="Team response..."
            value={responses[question.id] || ""}
            onChange={(event) => setResponses((current) => ({ ...current, [question.id]: event.target.value }))}
          />
        </div>
      ))}
      {questions.length > 0 ? (
        <button onClick={handleSubmit} className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 text-sm">
          Submit & Synthesize
        </button>
      ) : (
        <p className="text-gray-400 text-sm">No retro triggered yet. Complete a gate to unlock.</p>
      )}
    </div>
  );
}
