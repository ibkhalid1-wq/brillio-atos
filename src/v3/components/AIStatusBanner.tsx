import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatAbsolute } from "@/lib/formatTime";
import type { AIConnectionStatus } from "@/v3/hooks/useAIStatus";

interface CircuitState {
  service: string;
  state: string;
  next_retry_at?: string | null;
}

interface AIStatusBannerProps {
  aiStatus?: AIConnectionStatus;
  onOpenAISettings?: () => void;
}

export function AIStatusBanner({ aiStatus, onOpenAISettings }: AIStatusBannerProps) {
  const [openCircuit, setOpenCircuit] = useState<CircuitState | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("adam_circuit_breakers")
        .select("service,state,next_retry_at")
        .eq("state", "open")
        .limit(1)
        .maybeSingle();
      if (mounted) setOpenCircuit((data as CircuitState | null) || null);
    };
    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, []);

  // Circuit breaker open — highest priority
  if (openCircuit) {
    return (
      <div className="v3-ai-status-banner v3-ai-status-banner--warning">
        <span className="v3-ai-status-banner-icon">⚠</span>
        <span className="v3-ai-status-banner-text">
          Smart features temporarily unavailable.
          {openCircuit.next_retry_at ? ` Retrying at ${formatAbsolute(openCircuit.next_retry_at)}.` : " You can still manage risks, decisions, and milestones manually."}
        </span>
      </div>
    );
  }

  // No AI key configured
  if (aiStatus === "not-configured") {
    return (
      <div className="v3-ai-status-banner v3-ai-status-banner--setup">
        <span className="v3-ai-status-banner-icon">✦</span>
        <span className="v3-ai-status-banner-text">
          Smart features unavailable. Programme analysis and recommendations are unavailable. You can still manage risks, decisions, and milestones manually.
        </span>
        {onOpenAISettings && (
          <button
            type="button"
            className="v3-ai-status-banner-action"
            onClick={onOpenAISettings}
          >
            Set up →
          </button>
        )}
      </div>
    );
  }

  // Error reaching AI settings endpoint (transient)
  if (aiStatus === "error") {
    return (
      <div className="v3-ai-status-banner v3-ai-status-banner--warning">
        <span className="v3-ai-status-banner-icon">⚠</span>
        <span className="v3-ai-status-banner-text">
          Smart features may be unavailable. Analysis and recommendations might not load correctly.
        </span>
        {onOpenAISettings && (
          <button
            type="button"
            className="v3-ai-status-banner-action"
            onClick={onOpenAISettings}
          >
            Settings →
          </button>
        )}
      </div>
    );
  }

  return null;
}
