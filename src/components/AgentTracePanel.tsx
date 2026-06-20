import { AGENT_REGISTRY, type OrchestrationTrace } from "@/lib/adamAgents";

export function AgentTracePanel({
  trace,
  visible,
}: {
  trace: OrchestrationTrace | null;
  visible: boolean;
}) {
  if (!trace || !visible) return null;

  return (
    <details className="rounded-lg border border-gray-200 bg-gray-50 text-xs" open={false}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-gray-600">
        <span className="font-medium">⚡ {trace.agents.length} agents · {trace.orchestrationMs}ms</span>
        <div className="flex items-center gap-2">
          {trace.synthesized ? (
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-700">
              ✦ Synthesized
            </span>
          ) : null}
          {trace.timedOut ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">⚠ Timed out</span>
          ) : null}
          <span className="text-[10px] text-gray-400">▾</span>
        </div>
      </summary>
      <div className="border-t border-gray-200 px-3 py-2.5">
        {trace.timedOut ? (
          <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
            ⚠ Timed out — fallback used
          </div>
        ) : null}
        <div className="space-y-2">
          {trace.results.map((result) => {
            const agent = AGENT_REGISTRY[result.agentId];
            return (
              <div key={`${result.agentId}-${result.durationMs}`} className="rounded border border-gray-200 bg-white px-2.5 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-gray-700">{agent?.name || result.agentId}</div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-400">
                    <span>{result.durationMs}ms</span>
                    <span>{result.content.length} chars</span>
                    {result.error ? (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 font-semibold uppercase text-red-700">
                        Error
                      </span>
                    ) : null}
                  </div>
                </div>
                {result.error ? (
                  <div className="mt-1 text-[11px] text-red-600">{result.error}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}
