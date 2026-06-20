import { useCallback, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import {
  extractArchitectureDecisionsFromDocument,
  extractBuildContextFromDocument,
  extractGovernContextFromDocument,
  extractMobiliseContextFromDocument,
  extractOperateContextFromDocument,
  extractOptimizeContextFromDocument,
  extractStrategyContextFromDocument,
  extractValueMetricsFromDocument,
  registerAdamCopilotRuntime,
} from "@/lib/adamCopilot";
import { inferPhaseFromDocument, type AtosPhase } from "@/new/lib/documentPhaseMap";
import { parseDocumentToText } from "@/new/lib/parseDocumentToText";

export type ImportStage =
  | "idle"
  | "parsing"
  | "extracting"
  | "saving"
  | "done"
  | "error";

export type ImportResult = {
  attachmentId: string;
  phase: AtosPhase;
  confidence: number;
  wordCount: number;
  extractedData: Record<string, unknown>;
};

function buildDocumentWorkspaceId() {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `document-import-${suffix}`;
}

// File types the AI can read natively (no client-side pre-parsing needed)
const AI_NATIVE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);
// Max file size to send natively to AI (10 MB — larger files fall back to client-side text extraction)
const AI_PARSE_MAX_BYTES = 10 * 1024 * 1024;
// For non-native types, we still extract text client-side but then send it through the AI
// All extraction goes through the AI provider — no direct parsing without AI

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function invokeDocumentExtraction(
  programId: string,
  system: string,
  user: string,
  fileAttachment?: { base64: string; mimeType: string; name: string },
): Promise<string> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured.");
  }

  const message = fileAttachment
    ? [
        "Follow the system instructions exactly and return only the requested extraction output.",
        "",
        "SYSTEM INSTRUCTIONS:",
        system,
        "",
        "The document is attached above. Extract the requested information directly from the document.",
      ].join("\n")
    : [
        "Follow the system instructions exactly and return only the requested extraction output.",
        "",
        "SYSTEM INSTRUCTIONS:",
        system,
        "",
        "DOCUMENT CONTENT:",
        user,
      ].join("\n");

  const { data, error } = await supabase.functions.invoke("copilot-chat", {
    body: {
      programId,
      workspaceId: buildDocumentWorkspaceId(),
      message,
      stream: false,
      ...(fileAttachment ? { fileAttachment } : {}),
    },
  });

  if (error) {
    throw new Error(error.message || "Document extraction request failed.");
  }

  const content = (data as any)?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Document extraction returned no content.");
  }

  return content;
}

function ensureAdamCopilotRuntime(programId: string, fileAttachment?: { base64: string; mimeType: string; name: string }) {
  registerAdamCopilotRuntime({
    callRegisteredRuntime: (system: string, user: string) => invokeDocumentExtraction(programId, system, user, fileAttachment),
    requestAIText: (system: string, user: string) => invokeDocumentExtraction(programId, system, user, fileAttachment),
  });
}

export function useDocumentImport(programId: string | null, onComplete?: (result?: ImportResult) => void | Promise<void>) {
  const [stage, setStage] = useState<ImportStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState(0);

  const importFile = useCallback(async (file: File, phaseOverride?: AtosPhase) => {
    if (!programId) {
      setStage("error");
      setError("No active program.");
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setStage("error");
      setError("Supabase is not configured for this workspace.");
      return;
    }

    setStage("parsing");
    setError(null);
    setResult(null);
    setProgress(10);

    // Verify AI provider is reachable before doing any heavy work.
    // A lightweight ping — if extractStrategyContextFromDocument throws "AI provider key is not configured"
    // we surface a graceful message instead of a cryptic error later.
    // We skip this pre-check and let the extraction step surface the error naturally —
    // but we do ensure a good error message in the catch block below.

    // Decide whether to let the AI provider read the file natively (PDF, images ≤10 MB)
    // or fall back to client-side text extraction before sending to AI
    const canUseAINative = AI_NATIVE_TYPES.has(file.type) && file.size <= AI_PARSE_MAX_BYTES;

    let text = "";
    let fileType: string = file.name.split(".").pop()?.toLowerCase() ?? "unknown";
    let wordCount = 0;
    let fileAttachment: { base64: string; mimeType: string; name: string } | undefined;

    if (canUseAINative) {
      try {
        const base64 = await fileToBase64(file);
        fileAttachment = { base64, mimeType: file.type, name: file.name };
        text = "";
        fileType = file.type.startsWith("image/") ? "image" : "pdf";
        wordCount = 0;
      } catch {
        // encoding failed — fall through to client-side parsing
      }
    }

    if (!fileAttachment) {
      const parsed = await parseDocumentToText(file);
      if (!parsed.ok) {
        // Client-side parsing failed — still attempt AI extraction with just the filename as context.
        // The AI provider will be told to do its best without pre-extracted text.
        text = "";
        wordCount = 0;
      } else {
        text = parsed.text;
        fileType = parsed.fileType ?? fileType;
        wordCount = parsed.wordCount ?? 0;
      }
    }

    setProgress(30);
    const phase = phaseOverride ?? inferPhaseFromDocument(text || file.name, file.name);
    const doc = { text, name: file.name, usableText: !fileAttachment };

    setStage("extracting");
    setProgress(50);

    let extractedData: Record<string, unknown> = {};
    let confidence = 0;

    try {
      ensureAdamCopilotRuntime(programId, fileAttachment);

      switch (phase) {
        case "strategy": {
          const response = await extractStrategyContextFromDocument(doc);
          extractedData = response ?? {};
          const scores = [
            ...(((response?.objectives || []) as Array<{ confidenceScore?: number }>).map((entry) => Number(entry.confidenceScore || 0))),
            ...(((response?.constraints || []) as Array<{ confidenceScore?: number }>).map((entry) => Number(entry.confidenceScore || 0))),
          ].filter((s) => s > 0);
          confidence = scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0.75;
          break;
        }
        case "mobilise": {
          const response = await extractMobiliseContextFromDocument(doc);
          extractedData = response ?? {};
          const scores = ((response?.roles || []) as Array<{ confidenceScore?: number }>).map((entry) => Number(entry.confidenceScore || 0)).filter((s) => s > 0);
          confidence = scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0.75;
          break;
        }
        case "architecture": {
          const response = await extractArchitectureDecisionsFromDocument(doc);
          extractedData = { decisions: Array.isArray(response) ? response : [] };
          confidence = 0.75;
          break;
        }
        case "build": {
          const response = await extractBuildContextFromDocument(doc);
          extractedData = response ?? {};
          const scores = ((response?.testCases || []) as Array<{ confidenceScore?: number }>).map((entry) => Number(entry.confidenceScore || 0)).filter((s) => s > 0);
          confidence = scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0.75;
          break;
        }
        case "operate": {
          const response = await extractOperateContextFromDocument(doc);
          extractedData = response ?? {};
          const scores = ((response?.runbookItems || []) as Array<{ confidenceScore?: number }>).map((entry) => Number(entry.confidenceScore || 0)).filter((s) => s > 0);
          confidence = scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0.75;
          break;
        }
        case "govern": {
          const response = await extractGovernContextFromDocument(doc as any);
          extractedData = response ?? {};
          confidence = 0.75;
          break;
        }
        case "optimize": {
          const response = await extractOptimizeContextFromDocument(doc as any);
          extractedData = response ?? {};
          confidence = 0.75;
          break;
        }
        case "value": {
          const response = await extractValueMetricsFromDocument(doc);
          extractedData = response ?? {};
          const scores = Array.isArray(response?.kpiActuals)
            ? response.kpiActuals.map((entry) => Number((entry as { confidenceScore?: number }).confidenceScore || 0)).filter((s) => s > 0)
            : [];
          confidence = scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0.75;
          break;
        }
        default:
          extractedData = {};
          confidence = 0;
      }
    } catch (caughtError: any) {
      setStage("error");
      const msg: string = caughtError?.message || "Unknown error";
      // Surface a friendly message when the AI provider is not configured
      if (msg.includes("AI provider key is not configured") || msg.includes("not configured")) {
        setError("No AI provider connected. Please open AI Settings and connect a provider before importing documents.");
      } else {
        setError(`Extraction failed: ${msg}`);
      }
      return;
    }

    setProgress(75);
    setStage("saving");

    // Use the save-document edge function (admin/service-role client) to bypass RLS
    const { data: saveData, error: saveError } = await supabase!.functions.invoke("save-document", {
      body: {
        program_id: programId,
        file_name: file.name,
        file_type: fileType,
        file_size_bytes: file.size,
        raw_text: text ? text.slice(0, 50000) : null,
        phase_context: phase,
        extraction_status: "extracted",
        extracted_data: extractedData,
        confidence: Math.max(0, Math.min(1, confidence)),
      },
    });

    if (saveError || !(saveData as any)?.id) {
      setStage("error");
      setError(`Save failed: ${saveError?.message || (saveData as any)?.error || "Unknown error"}`);
      return;
    }
    const row = saveData as { id: string };

    setProgress(100);
    setStage("done");
    const importResult = {
      attachmentId: row.id,
      phase,
      confidence,
      wordCount,
      extractedData,
    };
    setResult(importResult);

    window.dispatchEvent(new CustomEvent("adam:documents-updated", {
      detail: { programId },
    }));

    await onComplete?.(importResult);
  }, [onComplete, programId]);

  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
    setResult(null);
    setProgress(0);
  }, []);

  return { importFile, stage, error, result, progress, reset };
}
