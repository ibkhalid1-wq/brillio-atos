/**
 * flow-extract — any document in, reviewable TEXT out (operator side, JWT
 * gated). The ladder lives in _shared/extractText.ts and is shared with the
 * public flow-portal (token gated). Only extracted text returns — the file
 * itself is never stored; the operator reads before anything becomes evidence.
 */
import { extractDocumentText } from "../_shared/extractText.ts";

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

  let payload: { file?: string; mime?: string; filename?: string };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Body must be JSON: { file: base64, mime, filename }" }, 400);
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
  return jsonResponse(result);
});
