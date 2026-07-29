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
  // Steady enough to sound like a presenter rather than a reader, but not so
  // steady that it flattens into the model's own cadence.
  stability: 0.45,
  similarity_boost: 0.97,
  style: 0,
  use_speaker_boost: true,
  // The clone reads ~25% faster than Ibrahim does live, which is what made
  // the first cut feel rushed against the animation.
  speed: 0.9,
};

/**
 * "…" in the content library marks a deliberate beat — the two the film
 * depends on, after the opening question and before the final answer. The
 * model treats an ellipsis as ordinary punctuation and hurries through it,
 * so make the pause explicit.
 */
const withPauses = (text) =>
  // One ellipsis is a beat; repeat it for a longer one. The model treats an
  // ellipsis as ordinary punctuation and hurries through it, so the pause has
  // to be stated rather than implied.
  text.replace(/\s*(…(?:\s*…)*)\s*/g, (_, run) => {
    const n = (run.match(/…/g) || []).length;
    return ` <break time="${(0.7 + 0.55 * (n - 1)).toFixed(2)}s" /> `;
  });

/**
 * Words the model gets wrong, pinned in CMU Arpabet. English-only models
 * honour phoneme tags; the multilingual ones ignore them, which is another
 * reason this script stays on turbo_v2.
 *
 *   two  — was landing somewhere between "two" and "tuh"
 *   Aura — AW-ruh, not A-U-R-A and not "ow-ra"
 *   live — as in "go-live": LYVE, not the verb "to live"
 *
 * REMOVED, and the reason matters: "autonomously", "autonomous" and
 * "proposes" were pinned here and all three read WORSE tagged than plain.
 * A/B clips of the same sentence settled it. The tag also damages the word
 * NEXT to it — "machine" was mispronounced only because "proposes" carried
 * a tag two words later, which is why it was never in this table itself.
 * Reach for a tag only when the plain read is genuinely wrong, and A/B it
 * before pinning: turbo_v2's own pronunciation has improved to the point
 * where these corrections mostly cost more than they buy.
 */
const SAY = {
  two: "T UW1",
  aura: "AO1 R AH0",
  live: "L AY1 V",
};

const withPronunciation = (text) =>
  text.replace(/\b(two|aura|live)\b/gi, (word) => {
    const ph = SAY[word.toLowerCase()];
    return `<phoneme alphabet="cmu-arpabet" ph="${ph}">${word}</phoneme>`;
  });

/**
 * A possessive running straight into a vowel elides: "Brillio's AI-native"
 * came out as one slurred word, taking "delivery" down with it because the
 * whole phrase then had to be caught up on. A quarter-second is enough to
 * separate them and is inaudible as a pause — far cheaper than a phoneme tag,
 * which this project has already learned degrades its neighbours.
 */
const BREATHE_AFTER = ["Brillio’s", "Brillio's"];
const withMicroPauses = (text) =>
  BREATHE_AFTER.reduce((t, w) => t.split(w).join(`${w} <break time="0.25s" /> `), text);

const speak = (text) => withPronunciation(withMicroPauses(withPauses(text)));

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
  if (!/^seg\d+[a-z]?$/.test(id)) continue;
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
  // The account holds TWO clones of the same speaker: "Ib Voice" and
  // "Ibrahim US". Only the second carries an american accent label, and it is
  // the one this film wants — picking cloned[0] silently took the other for
  // every take up to this point, which is why the read kept coming back
  // British no matter what the model or settings were. Prefer an
  // american-labelled clone; fall back to the first only if none exists.
  const cloned = voices.filter((v) => v.category === "cloned" || v.category === "professional");
  const american = cloned.find((v) => (v.labels?.accent || "").toLowerCase() === "american");
  if (american) return american;
  if (!cloned.length)
    throw new Error(
      `No cloned voice in this account. Available: ${voices.map((v) => `${v.name} (${v.category})`).join(", ")}`
    );
  return cloned[0];
};

/**
 * Per-take speed override. The levelling pass in prepare-vo fixes the average
 * rate, but not a take that drags internally — long gaps between words that
 * average out fine. Regenerating that one at a livelier base speed fixes the
 * prosody at source.
 */
const speedArg = arg("--speed");
if (speedArg) VOICE_SETTINGS.speed = Number(speedArg);

const voice = pick();
console.log(`Voice: ${voice.name} (${voice.voice_id})`);
console.log(`Model: ${MODEL} — English-only, similarity ${VOICE_SETTINGS.similarity_boost}\n`);

mkdirSync(OUT_DIR, { recursive: true });

for (const { id, text } of todo) {
  const res = await call(`/text-to-speech/${voice.voice_id}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: speak(text),
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
