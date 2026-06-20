import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // Use admin client — bypasses RLS so all operations succeed regardless of auth state
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    const payload = await req.json() as Record<string, unknown>;

    // action: "list" — fetch documents for a program
    if (payload.action === "list") {
      const programId = payload.program_id as string | undefined;
      if (!programId) return jsonResponse({ error: "program_id is required." }, 400);

      const { data: rows, error } = await admin
        .from("adam_document_attachments")
        .select("id, file_name, file_type, file_size_bytes, phase_context, extraction_status, confidence, created_at")
        .eq("program_id", programId)
        .order("created_at", { ascending: false });

      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ documents: rows ?? [] });
    }

    // action: "get" — fetch a single document's stored content (raw text +
    // extracted data) for download or re-extraction. Scoped by program_id so a
    // document can only be read in the context of its own programme.
    if (payload.action === "get") {
      const id = payload.id as string | undefined;
      const programId = payload.program_id as string | undefined;
      if (!id || !programId) return jsonResponse({ error: "id and program_id are required." }, 400);

      const { data: row, error } = await admin
        .from("adam_document_attachments")
        .select("id, file_name, file_type, phase_context, raw_text, extracted_data, extraction_status, confidence, created_at")
        .eq("program_id", programId)
        .eq("id", id)
        .single();

      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ document: row });
    }

    // default action: insert a new document attachment
    const insert = payload as {
      program_id: string;
      file_name: string;
      file_type: string;
      file_size_bytes: number;
      raw_text?: string | null;
      phase_context: string;
      extraction_status: string;
      extracted_data: Record<string, unknown>;
      confidence: number;
    };

    if (!insert.program_id || !insert.file_name) {
      return jsonResponse({ error: "program_id and file_name are required." }, 400);
    }

    const { data: row, error } = await admin
      .from("adam_document_attachments")
      .insert({
        program_id: insert.program_id,
        file_name: insert.file_name,
        file_type: insert.file_type,
        file_size_bytes: insert.file_size_bytes,
        raw_text: insert.raw_text ?? null,
        phase_context: insert.phase_context,
        extraction_status: insert.extraction_status,
        extracted_data: insert.extracted_data,
        confidence: Math.max(0, Math.min(1, insert.confidence)),
      })
      .select("id")
      .single();

    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ id: row.id });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
