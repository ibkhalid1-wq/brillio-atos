/**
 * flow-extract — any document in, reviewable TEXT out (operator side, JWT
 * gated). The ladder lives in _shared/extractText.ts and is shared with the
 * public flow-portal (token gated). Only extracted text returns — the file
 * itself is never stored; the operator reads before anything becomes evidence.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { extractDocumentText } from "../_shared/extractText.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BUCKET = "flow-source-docs";

async function ensureBucket(admin: ReturnType<typeof createClient>) {
  try { await admin.storage.createBucket(BUCKET, { public: false }); } catch { /* exists */ }
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (request.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  let payload: { file?: string; mime?: string; filename?: string; store?: boolean; programId?: string; download?: string };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Body must be JSON: { file: base64, mime, filename }" }, 400);
  }

  // Download: mint a short-lived signed URL for a stored original. The JWT
  // gate on this function is the access control; the URL forces a download
  // disposition so the browser saves the file instead of previewing it.
  if (typeof payload.download === "string" && payload.download) {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const filename = payload.download.split("/").pop()?.replace(/^[0-9a-f-]{36}-/, "") || "document";
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(payload.download, 300, { download: filename });
    if (error || !data?.signedUrl) return jsonResponse({ error: "The original file is no longer available." }, 404);
    return jsonResponse({ url: data.signedUrl });
  }

  if (typeof payload.file !== "string" || !payload.file) {
    return jsonResponse({ error: "Missing file (base64)" }, 400);
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(payload.file);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } catch {
    return jsonResponse({ error: "file is not valid base64" }, 400);
  }
  if (bytes.length > MAX_FILE_BYTES) {
    return jsonResponse({ error: `File too large — cap is ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB` }, 413);
  }

  const result = await extractDocumentText(bytes, payload.file,
    typeof payload.mime === "string" ? payload.mime : "",
    typeof payload.filename === "string" ? payload.filename : "", MAX_TEXT_CHARS);
  if ("error" in result) return jsonResponse({ error: result.error }, result.status);

  // Keep the ORIGINAL alongside the extraction: the Library offers it back
  // as a download in its native format (pptx, xlsx, …), never a preview.
  let sourceKey: string | undefined;
  if (payload.store === true && typeof payload.programId === "string" && payload.programId) {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await ensureBucket(admin);
    const safeName = (typeof payload.filename === "string" ? payload.filename : "document").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    const key = `${payload.programId}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await admin.storage.from(BUCKET).upload(key, bytes, {
      contentType: typeof payload.mime === "string" && payload.mime ? payload.mime : "application/octet-stream",
    });
    if (!error) sourceKey = key;
  }
  return jsonResponse(sourceKey ? { ...result, sourceKey } : result);
});
