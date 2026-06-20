import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";

interface ArtifactHistoryDrawerProps {
  programId: string | null;
  agentId: string;
  phaseId?: string | null;
  onClose: () => void;
  onRestore: (artifactId: string) => Promise<void>;
}

interface ArtifactRecord {
  id: string;
  generated_at: string;
  confidence: number | null;
  content: Record<string, unknown>;
}

export default function ArtifactHistoryDrawer({
  programId,
  agentId,
  onClose,
  onRestore,
}: ArtifactHistoryDrawerProps) {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    if (!programId || !supabase) return;
    setLoading(true);
    void supabase
      .from("adam_program_artifacts")
      .select("id, generated_at, confidence, content")
      .eq("program_id", programId)
      .eq("agent_id", agentId)
      .order("generated_at", { ascending: false })
      .limit(10)
      .then(({ data }) => {
        setArtifacts((data as ArtifactRecord[]) || []);
        setLoading(false);
      });
  }, [programId, agentId]);

  return (
    <>
      <div className="v3-sheet-overlay" onClick={onClose} />
      <div className="v3-sheet">
        <div className="v3-sheet-header">
          <div>
            <div className="v3-sheet-title">Version history</div>
            <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 2 }}>
              {agentId} · last 10 runs
            </div>
          </div>
          <button className="v3-sheet-close" onClick={onClose}>×</button>
        </div>
        <div className="v3-sheet-body">
          {loading ? (
            <div style={{ display: "grid", gap: 10 }}>
              {[1, 2, 3].map((index) => <div key={index} className="v3-skeleton" style={{ height: 60, borderRadius: 10 }} />)}
            </div>
          ) : artifacts.length === 0 ? (
            <div className="v3-empty">
              <div className="v3-empty-icon">◎</div>
              <div className="v3-empty-title">No history yet</div>
              <div className="v3-empty-body">Previous versions will appear here after each run.</div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {artifacts.map((artifact, index) => {
                const confidenceTone = artifact.confidence === null
                  ? "muted"
                  : artifact.confidence >= 0.8
                    ? "green"
                    : artifact.confidence >= 0.6
                      ? "amber"
                      : "red";
                return (
                  <div key={artifact.id} className="v3-card-sm" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, color: "var(--v3-text-primary)", fontWeight: 500 }}>
                        {index === 0 ? "Current" : `Version ${artifacts.length - index}`}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 3 }}>
                        <RelativeTime date={artifact.generated_at} />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {artifact.confidence !== null ? (
                        <span className={`v3-chip ${confidenceTone}`}>
                          {Math.round(artifact.confidence * 100)}%
                        </span>
                      ) : null}
                      {index > 0 ? (
                        <button
                          type="button"
                          className="v3-button ghost"
                          style={{ fontSize: 11, padding: "4px 10px" }}
                          disabled={restoring === artifact.id}
                          onClick={async () => {
                            setRestoring(artifact.id);
                            try {
                              await onRestore(artifact.id);
                              onClose();
                            } finally {
                              setRestoring(null);
                            }
                          }}
                        >
                          {restoring === artifact.id ? "Restoring…" : "Restore"}
                        </button>
                      ) : (
                        <span className="v3-chip muted">Active</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
