/**
 * Turn raw narration recordings into film-ready audio.
 *
 *   node scripts/prepare-vo.mjs [sourceDir]
 *
 * For every scene id in the content library it looks for a recording whose
 * filename contains that id (seg1, seg2 …) in any common format, then:
 *   1. decodes to 44.1kHz mono
 *   2. trims leading/trailing silence using an envelope, not a fixed gate,
 *      so a natural breath survives but dead air doesn't
 *   3. level-matches to TARGET_RMS so no line sits louder than another,
 *      capped per-file so nothing clips
 *   4. writes vo-you/<id>.wav and refreshes src/vo-durations.json
 *
 * The film re-times itself from those durations on the next render.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "vo-you");
const SRC_DIR = process.argv[2] || join(ROOT, "vo-raw");
const TARGET_RMS_DB = -18;
const AUDIO_EXT = /\.(m4a|mp3|wav|aac|aif|aiff|caf|mov|mp4)$/i;

const IDS = readFileSync(join(ROOT, "src/content.ts"), "utf8")
  .match(/id: "(seg\d+)"/g)
  .map((m) => m.slice(5, -1));

const ffmpeg = (args) =>
  execFileSync("npx", ["remotion", "ffmpeg", "-y", ...args], { cwd: ROOT, stdio: "pipe" });

/** Read a 16-bit PCM wav into { rate, samples }. */
const readWav = (path) => {
  const b = readFileSync(path);
  let p = 12, rate = 44100, dataStart = 0, dataLen = 0;
  while (p < b.length - 8) {
    const id = b.toString("ascii", p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === "fmt ") rate = b.readUInt32LE(p + 12);
    if (id === "data") { dataStart = p + 8; dataLen = size; break; }
    p += 8 + size + (size % 2);
  }
  const n = Math.floor(dataLen / 2);
  const s = new Int16Array(n);
  for (let i = 0; i < n; i++) s[i] = b.readInt16LE(dataStart + i * 2);
  return { rate, samples: s };
};

const writeWav = (path, rate, samples) => {
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + samples.length * 2, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(samples.length * 2, 40);
  const body = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) body.writeInt16LE(samples[i], i * 2);
  writeFileSync(path, Buffer.concat([head, body]));
};

if (!existsSync(SRC_DIR)) {
  console.error(`No source directory: ${SRC_DIR}\nDrop your recordings there (any format, filename containing seg1…seg9).`);
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });

const files = readdirSync(SRC_DIR).filter((f) => AUDIO_EXT.test(f));
const durations = existsSync(join(ROOT, "src/vo-durations.json"))
  ? JSON.parse(readFileSync(join(ROOT, "src/vo-durations.json"), "utf8"))
  : {};

for (const id of IDS) {
  // "Seg 5 - the business's own language.m4a" → seg5
  const match = files.find((f) => f.toLowerCase().replace(/\s+/g, "").includes(id));
  if (!match) { console.log(`  ${id}: no recording found — keeping previous`); continue; }

  const tmp = join(OUT_DIR, `.${id}.tmp.wav`);
  ffmpeg(["-i", join(SRC_DIR, match), "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", tmp]);
  const { rate, samples: a } = readWav(tmp);
  rmSync(tmp);

  // Envelope in 20ms blocks; speech is anything well above the noise floor.
  const B = Math.round(rate * 0.02);
  const env = [];
  for (let j = 0; j + B < a.length; j += B) {
    let s = 0; for (let k = j; k < j + B; k++) s += a[k] * a[k];
    env.push(Math.sqrt(s / B));
  }
  const floor = [...env].sort((x, y) => x - y)[Math.floor(env.length / 10)] || 1;
  const thr = Math.max(floor * 4, 40);
  const live = env.map((v, k) => (v > thr ? k : -1)).filter((k) => k >= 0);
  if (!live.length) { console.log(`  ${id}: silent file — skipped`); continue; }
  const start = Math.max(0, live[0] * B - Math.round(rate * 0.12));
  const end = Math.min(a.length, (live[live.length - 1] + 1) * B + Math.round(rate * 0.18));
  const seg = a.slice(start, end);

  // Active RMS: the loud 55% of the take, so pauses don't drag the level down.
  const win = Math.max(1, Math.floor(seg.length / 120));
  const blocks = [];
  for (let j = 0; j + win < seg.length; j += win) {
    let s = 0; for (let k = j; k < j + win; k++) s += seg[k] * seg[k];
    blocks.push(s / win);
  }
  blocks.sort((x, y) => x - y);
  const active = blocks.slice(Math.floor(blocks.length * 0.45));
  const rms = Math.sqrt(active.reduce((x, y) => x + y, 0) / active.length) / 32768;
  // Loop, not spread: a minute of audio is millions of samples and the
  // argument list would overflow the stack.
  let peakRaw = 1;
  for (let i = 0; i < seg.length; i++) { const v = seg[i] < 0 ? -seg[i] : seg[i]; if (v > peakRaw) peakRaw = v; }
  const peak = peakRaw / 32768;
  const gain = Math.min(10 ** (TARGET_RMS_DB / 20) / rms, 0.97 / peak);

  const out = new Int16Array(seg.length);
  for (let i = 0; i < seg.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(seg[i] * gain)));
  writeWav(join(OUT_DIR, `${id}.wav`), rate, out);

  const dur = seg.length / rate;
  durations[id] = Math.round(dur * 100) / 100;
  console.log(`  ${id}: ${dur.toFixed(1)}s  (trimmed ${((a.length - seg.length) / rate).toFixed(1)}s, gain ${(20 * Math.log10(gain)).toFixed(1)}dB)`);
}

writeFileSync(join(ROOT, "src/vo-durations.json"), JSON.stringify(durations, null, 2) + "\n");
const total = IDS.reduce((s, id) => s + (durations[id] || 0), 0);
console.log(`\nTotal narration: ${total.toFixed(1)}s — the film will re-time to it on the next render.`);
