import { useCallback, useEffect, useState } from "react";

export interface ViewState {
  activeTab?: string;
  scrollY?: number;
  expandedPanelIds?: string[];
  lastVisitedAt: number;
}

const PREFIX = "adam_view_state_";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function saveViewState(key: string, state: Partial<Omit<ViewState, "lastVisitedAt">>): void {
  try {
    const existing = loadViewState(key) ?? ({} as Partial<ViewState>);
    const next: ViewState = { ...existing, ...state, lastVisitedAt: Date.now() };
    localStorage.setItem(PREFIX + key, JSON.stringify(next));
  } catch {}
}

export function loadViewState(key: string): ViewState | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ViewState;
    if (!parsed.lastVisitedAt || Date.now() - parsed.lastVisitedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch { return null; }
}

export function clearViewState(key: string): void {
  try { localStorage.removeItem(PREFIX + key); } catch {}
}

export function useViewState(key: string): [ViewState | null, (update: Partial<ViewState>) => void] {
  const [state, setState] = useState<ViewState | null>(() => loadViewState(key));
  const setter = useCallback((update: Partial<ViewState>) => {
    saveViewState(key, update);
    setState((prev) => ({ ...(prev ?? { lastVisitedAt: Date.now() }), ...update, lastVisitedAt: Date.now() }));
  }, [key]);
  useEffect(() => { setState(loadViewState(key)); }, [key]);
  return [state, setter];
}
