/**
 * Narrate the film in your cloned ElevenLabs voice — locked to American English.
 *
 *   ELEVENLABS_API_KEY=… node scripts/tts-eleven.mjs [--voice "name or id"] [--only seg3,seg7]
 *
 * Writes vo-raw/<id>.mp3. `npm run vo` then trims, level-matches and measures
 * them exactly as it does your own recordings, so the film re-times itself.
 *
 * ── Why this sounds American and the earlier take didn't ──────────────────
 * The first pass used eleven_multilingual_v2. That model shares one phoneme
 * space across 29 languages, and a cloned voice gets pulled toward that
 * average — which is where the British vowels came from. eleven_turbo_v2 is
 * English-only, so there is no foreign phonetics to drift into. On top of
 * that:
 *   similarity_boost 0.97 pins timbre and vowel colour to your samples
 *   style            0    style exaggeration re-introduces the model average
 *   stability        0.38 low enough to follow your prosody, not the model's
 * The script text matters too: British spellings in the copy ("fulfilment",
 * "judgement") cue British pronunciation, so the content library uses
 * American forms.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "vo-raw");
const API = "https://api.elevenlabs.io/v1";

/** English-only. This single choice is the accent fix. */
const MODEL = "eleven_turbo_v2";
const VOICE_SETTINGS = {
  stability: 0.38,
  similarity_boost: 0.97,
  style: 0,
  use_speaker_boost: true,
};

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const key =
  process.env.ELEVENLABS_API_KEY ||
  (arg("--key-file") && existsSync(arg("--key-file"))
    ? readFileSync(arg("--key-file"), "utf8").trim()
    : "");

if (!key) {
  console.error(
    "No API key.\n\n" +
      "  ELEVENLABS_API_KEY=sk_… npm run vo:eleven\n\n" +
      "The key is never written to disk by this script."
  );
  process.exit(1);
}

const call = async (path, init = {}) => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "xi-api-key": key, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res;
};

/* ── The narration, straight from the content library ───────────────────── */

const src = readFileSync(join(ROOT, "src/content.ts"), "utf8");
const lines = [];
for (const block of src.split(/\bid: "/).slice(1)) {
  const id = block.slice(0, block.indexOf('"'));
  if (!/^seg\d+$/.test(id)) continue;
  const vo = block.match(/\n\s+vo:\s*\n?\s*"((?:[^"\\]|\\.)*)"/);
  if (vo) lines.push({ id, text: vo[1].replace(/\\"/g, '"') });
}
if (!lines.length) throw new Error("No vo: lines found in src/content.ts");

const only = arg("--only")?.split(",").map((s) => s.trim());
const todo = only ? lines.filter((l) => only.includes(l.id)) : lines;

/* ── Find the cloned voice ──────────────────────────────────────────────── */

const wanted = arg("--voice") || process.env.ELEVEN_VOICE || "";
const { voices } = await (await call("/voices")).json();

const pick = () => {
  if (/^[A-Za-z0-9]{20,}$/.test(wanted)) return { voice_id: wanted, name: wanted };
  if (wanted) {
    const byName = voices.find((v) => v.name.toLowerCase().includes(wanted.toLowerCase()));
    if (byName) return byName;
    throw new Error(`No voice matching "${wanted}". Available: ${voices.map((v) => v.name).join(", ")}`);
  }
  const cloned = voices.filter((v) => v.category === "cloned" || v.category === "professional");
  if (!cloned.length)
    throw new Error(
      `No cloned voice in this account. Available: ${voices.map((v) => `${v.name} (${v.category})`).join(", ")}`
    );
  return cloned[0];
};

const voice = pick();
console.log(`Voice: ${voice.name} (${voice.voice_id})`);
console.log(`Model: ${MODEL} — English-only, similarity ${VOICE_SETTINGS.similarity_boost}\n`);

mkdirSync(OUT_DIR, { recursive: true });

for (const { id, text } of todo) {
  const res = await call(`/text-to-speech/${voice.voice_id}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: VOICE_SETTINGS,
      // Neighbouring lines condition prosody, so each take lands in the same
      // register as the ones around it instead of resetting every scene.
      previous_text: lines[lines.findIndex((l) => l.id === id) - 1]?.text,
      next_text: lines[lines.findIndex((l) => l.id === id) + 1]?.text,
    }),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(OUT_DIR, `${id}.mp3`), buf);
  console.log(`  ${id}: ${(buf.length / 1024).toFixed(0)} KB  “${text.slice(0, 56)}…”`);
}

console.log(`\n${todo.length} takes in vo-raw/. Next: npm run vo && npm run build:film`);
