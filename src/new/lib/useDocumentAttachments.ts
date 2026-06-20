import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";

export interface DocumentAttachmentSummary {
  id: string;
  file_name: string;
  file_type: string;
  file_size_bytes: number | null;
  phase_context: string | null;
  extraction_status: string | null;
  confidence: number | null;
  ocr_confidence: number | null;
  page_count: number | null;
  sheet_count: number | null;
  slide_count: number | null;
  created_at: string;
}

export interface DocumentAttachmentDetail {
  id: string;
  file_name: string;
  file_type: string;
  phase_context: string | null;
  raw_text: string | null;
  extracted_data: Record<string, unknown> | null;
  extraction_status: string | null;
  confidence: number | null;
  created_at: string;
}

/**
 * Fetch a single document's stored content (raw text + extracted data) for
 * download or re-extraction. Routed through the save-document edge function
 * (admin client) so it bypasses RLS, scoped by program_id + id.
 */
export async function getDocumentDetail(
  programId: string,
  id: string,
): Promise<DocumentAttachmentDetail> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured.");
  }
  const { data: result, error } = await supabase.functions.invoke("save-document", {
    body: { action: "get", id, program_id: programId },
  });
  if (error) throw new Error(error.message || "Failed to load document.");
  if ((result as any)?.error) throw new Error((result as any).error);
  const doc = (result as any)?.document;
  if (!doc) throw new Error("Document not found.");
  return doc as DocumentAttachmentDetail;
}

export function useDocumentAttachments(programId: string | null) {
  const [data, setData] = useState<DocumentAttachmentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!programId || !isSupabaseConfigured || !supabase) {
      setData([]);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      // Fetch via edge function (admin client) to bypass RLS on adam_document_attachments
      const { data: result, error: loadError } = await supabase.functions.invoke("save-document", {
        body: { action: "list", program_id: programId },
      });

      if (loadError) throw new Error(loadError.message || "Failed to load documents.");
      if ((result as any)?.error) throw new Error((result as any).error);

      const rows = (result as any)?.documents ?? [];
      setData(Array.isArray(rows) ? rows : []);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to load documents.");
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, [programId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleDocumentsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ programId?: string }>).detail;
      if (!detail?.programId || detail.programId === programId) {
        void refresh();
      }
    };

    window.addEventListener("adam:documents-updated", handleDocumentsUpdated as EventListener);
    return () => {
      window.removeEventListener("adam:documents-updated", handleDocumentsUpdated as EventListener);
    };
  }, [programId, refresh]);

  return { data, isLoading, error, refresh };
}
