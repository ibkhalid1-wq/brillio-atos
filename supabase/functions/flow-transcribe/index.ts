/**
 * flow-transcribe — turns a meeting recording into text the operator can
 * review before it becomes evidence. The audio arrives base64-encoded, goes
 * straight to Whisper, and only the TRANSCRIPT returns — nothing is stored
 * here; the operator reads it in the capture box and decides what lands.
 * Responds 501 when no OPENAI_API_KEY is configured, so the client can hide
 * the affordance rather than fail it.
 */
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Whisper accepts up to 25MB; leave headroom for the base64 envelope.
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (request.method !== "POST") return jsonResponse({ error: "POST only" }, 405);
  if (!OPENAI_API_KEY) {
    return jsonResponse({ error: "Transcription is not configured — set OPENAI_API_KEY on the project." }, 501);
  }

  let payload: { audio?: string; mime?: string; filename?: string };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Body must be JSON: { audio: base64, mime, filename? }" }, 400);
  }
  if (typeof payload.audio !== "string" || !payload.audio) {
    return jsonResponse({ error: "Missing audio (base64)" }, 400);
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(payload.audio);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } catch {
    return jsonResponse({ error: "audio is not valid base64" }, 400);
  }
  if (bytes.length > MAX_AUDIO_BYTES) {
    return jsonResponse({ error: `Recording too large — cap is ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)}MB` }, 413);
  }
  if (bytes.length < 1024) {
    return jsonResponse({ error: "Recording too short to transcribe" }, 400);
  }

  const mime = typeof payload.mime === "string" && payload.mime ? payload.mime : "audio/webm";
  const filename = typeof payload.filename === "string" && payload.filename
    ? payload.filename
    : `recording.${mime.split("/")[1]?.split(";")[0] || "webm"}`;

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), filename);
  form.append("model", "whisper-1");
  form.append("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("whisper error", response.status, detail.slice(0, 400));
    return jsonResponse({ error: "Transcription failed — try again or paste the notes instead." }, 502);
  }
  const result = await response.json().catch(() => null) as { text?: string } | null;
  const text = typeof result?.text === "string" ? result.text.trim() : "";
  if (!text) return jsonResponse({ error: "The recording produced no speech to transcribe." }, 422);
  return jsonResponse({ text });
});
