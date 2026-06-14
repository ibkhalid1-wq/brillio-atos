import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";

export type AIConnectionStatus = "checking" | "connected" | "not-configured" | "error" | "offline";

export interface AIStatus {
  status: AIConnectionStatus;
  provider: string | null;
  model: string | null;
  /** Last time the check succeeded */
  checkedAt: number | null;
  recheck: () => void;
}

const POLL_INTERVAL_MS = 90 * 1000; // re-check every 90 seconds
const CACHE_TTL_MS    = 90 * 1000; // cache valid for 90 seconds
const CACHE_KEY = "v3_ai_status_cache";
/** Fired by IntelligenceView after a successful save/pause/resume */
export const AI_SETTINGS_SAVED_EVENT = "adam:ai-settings-saved";

function readCache(): { status: AIConnectionStatus; provider: string | null; model: string | null; checkedAt: number } | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { status: AIConnectionStatus; provider: string | null; model: string | null; checkedAt: number };
    if (Date.now() - parsed.checkedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(status: AIConnectionStatus, provider: string | null, model: string | null) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ status, provider, model, checkedAt: Date.now() }));
  } catch { /* sessionStorage may be unavailable */ }
}

export function useAIStatus(enabled = true): AIStatus {
  const cached = readCache();
  const [status, setStatus] = useState<AIConnectionStatus>(cached?.status ?? "checking");
  const [provider, setProvider] = useState<string | null>(cached?.provider ?? null);
  const [model, setModel] = useState<string | null>(cached?.model ?? null);
  const [checkedAt, setCheckedAt] = useState<number | null>(cached?.checkedAt ?? null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    if (!enabled || !isSupabaseConfigured || !supabase) {
      setStatus("offline");
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("configure-ai-settings", {
        body: { action: "status", provider: "anthropic" },
      });

      if (error) {
        // If the function itself errored (network, cold start), keep last known good or mark error
        setStatus((prev) => (prev === "connected" ? "connected" : "error"));
        return;
      }

      const d = data as { configured?: boolean; active?: boolean; provider?: string; model?: string } | null;

      if (d?.configured && d?.active) {
        const prov = d.provider ?? "anthropic";
        const mod = d.model ?? null;
        setStatus("connected");
        setProvider(prov);
        setModel(mod);
        setCheckedAt(Date.now());
        writeCache("connected", prov, mod);
      } else {
        // Not configured — check other providers too before declaring not-configured
        const providers = ["openai", "google"];
        let found = false;
        for (const p of providers) {
          const { data: pd } = await supabase.functions.invoke("configure-ai-settings", {
            body: { action: "status", provider: p },
          });
          const pdata = pd as { configured?: boolean; active?: boolean; provider?: string; model?: string } | null;
          if (pdata?.configured && pdata?.active) {
            setStatus("connected");
            setProvider(pdata.provider ?? p);
            setModel(pdata.model ?? null);
            setCheckedAt(Date.now());
            writeCache("connected", pdata.provider ?? p, pdata.model ?? null);
            found = true;
            break;
          }
        }
        if (!found) {
          setStatus("not-configured");
          setProvider(null);
          setModel(null);
          setCheckedAt(Date.now());
          writeCache("not-configured", null, null);
        }
      }
    } catch {
      setStatus((prev) => (prev === "connected" ? "connected" : "error"));
    }
  }, [enabled]);

  const recheck = useCallback(() => {
    try { sessionStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
    void check();
  }, [check]);

  useEffect(() => {
    if (!enabled) return;
    // Run immediately if no fresh cache
    if (!readCache()) void check();
    // Regular poll
    intervalRef.current = setInterval(() => void check(), POLL_INTERVAL_MS);
    // Instant recheck when AI settings are saved anywhere in the app
    const onAISaved = () => {
      try { sessionStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
      void check();
    };
    window.addEventListener(AI_SETTINGS_SAVED_EVENT, onAISaved);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener(AI_SETTINGS_SAVED_EVENT, onAISaved);
    };
  }, [enabled, check]); // eslint-disable-line react-hooks/exhaustive-deps

  return { status, provider, model, checkedAt, recheck };
}
