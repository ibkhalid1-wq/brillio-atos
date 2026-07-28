/**
 * Lay the narration (and optionally the music bed) onto the rendered film.
 *
 *   node scripts/mix.mjs [--music] [--out <file>]
 *
 * Narration offsets come from the content library's derived timeline, so
 * they can never drift out of sync with the scene durations the way a
 * hand-typed ffmpeg filter chain does.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const withMusic = process.argv.includes("--music");
const outIdx = process.argv.indexOf("--out");
const OUT = outIdx > -1 ? process.argv[outIdx + 1] : join(ROOT, "out/aura-board.mp4");
const VIDEO = join(ROOT, "out/aura-board-90.mp4");

// Re-derive the timeline from content.ts without needing a TS toolchain.
const src = readFileSync(join(ROOT, "src/content.ts"), "utf8");
const durations = JSON.parse(readFileSync(join(ROOT, "src/vo-durations.json"), "utf8"));
const FPS = 30, LEAD_IN = 0.4;
// Must match content.ts exactly — including the bar snap, or the narration
// walks away from the picture a bar at a time. The assertion below is what
// actually keeps the two honest.
const BEAT = Math.round((60 / 120) * FPS);
const BAR = BEAT * 4;
const VO_AT_DEFAULT = 1;
const toBar = (frames) => Math.ceil(frames / BAR) * BAR;

const scenes = [];
for (const block of src.split(/\bid: "/).slice(1)) {
  const id = block.slice(0, block.indexOf('"'));
  if (!/^seg\d+[a-z]?$/.test(id)) continue;
  const num = (key, fallback) => {
    const m = block.match(new RegExp(`\\n\\s+${key}: ([\\d.]+)`));
    return m ? +m[1] : fallback;
  };
  scenes.push({ id, animFloor: num("animFloor", 0), tail: num("tail", 0), voAt: num("voAt", VO_AT_DEFAULT) });
}

let cursor = 0;
const plan = scenes.map((s) => {
  // Narration begins where its visual lands, not a fixed lead after the cut.
  const lead = (s.voAt * BEAT) / FPS;
  const dur = toBar(Math.max(s.animFloor, Math.ceil((lead + (durations[s.id] || 0) + s.tail) * FPS), BAR * 2));
  const at = Math.round((cursor / FPS + lead) * 1000);
  cursor += dur;
  return { ...s, atMs: at, from: cursor - dur, dur };
});
const totalSec = cursor / FPS;

const present = plan.filter((p) => existsSync(join(ROOT, `vo-you/${p.id}.wav`)));
if (!present.length) { console.error("No narration in vo-you/ — run `npm run vo` first."); process.exit(1); }
if (!existsSync(VIDEO)) { console.error("No render in out/ — run `npm run render` first."); process.exit(1); }

// The timeline above is re-derived, not shared with the render, so prove it
// still agrees with the picture before laying a single word onto it. A
// silent half-second here is a scene-length drift by the closing line.
const probed = +execFileSync("npx",
  ["remotion", "ffprobe", "-v", "error", "-show_entries", "format=duration",
   "-of", "default=noprint_wrappers=1:nokey=1", VIDEO],
  { cwd: ROOT, encoding: "utf8" }).trim();
if (Math.abs(probed - totalSec) > 0.1) {
  console.error(
    `Timeline drift: this script derives ${totalSec.toFixed(1)}s but the render is ${probed.toFixed(1)}s.\n` +
    `The narration would land in the wrong scenes. Re-render, or reconcile the\n` +
    `duration formula here with sceneFrames() in src/content.ts.`
  );
  process.exit(1);
}

const inputs = ["-i", VIDEO, ...present.flatMap((p) => ["-i", join(ROOT, `vo-you/${p.id}.wav`)])];
const delays = present.map((p, i) => `[${i + 1}:a]adelay=${p.atMs}|${p.atMs}[a${i}]`).join(";");
const labels = present.map((_, i) => `[a${i}]`).join("");
let chain = `${delays};${labels}amix=inputs=${present.length}:normalize=0[vo]`;
let mapAudio = "[vo]";

/* ── Music ──────────────────────────────────────────────────────────────
 * MUSIC_GAIN is measured, not chosen: the supplied track is a loud master
 * (median −5.1 dBFS), and −24.9 dB puts it at −30 dBFS in the gaps — the
 * usual place for a bed under narration, quiet enough to sit beneath the
 * room. An earlier bed set by ear landed at −40 and was inaudible; −24 was
 * audible but too present. Don't guess this number — measure the track's
 * median RMS and subtract, and re-measure whenever the track changes.
 */
const MUSIC_GAIN = 0.057;
const DUCK = 0.6; // −4.4 dB under speech
const TRACK = existsSync(join(ROOT, "music/track.wav"))
  ? join(ROOT, "music/track.wav")
  : join(ROOT, "music/bed.wav");

if (withMusic && existsSync(TRACK)) {
  // The track is shorter than the film, so loop it; the cut points fall on
  // bar lines because both the track and the edit are 120 BPM.
  inputs.push("-stream_loop", "-1", "-i", TRACK);
  const duck = present
    .map((p) => `between(t,${(p.atMs / 1000).toFixed(2)},${(p.atMs / 1000 + (durations[p.id] || 0)).toFixed(2)})`)
    .join("+");
  const fade = `min(1,t/1.5)*min(1,max(0,(${totalSec.toFixed(2)}-t)/3))`;
  chain +=
    `;[${present.length + 1}:a]volume='${MUSIC_GAIN}*${fade}*(1-${DUCK}*(${duck}))':eval=frame,` +
    `atrim=0:${totalSec.toFixed(3)}[bed];[vo][bed]amix=inputs=2:normalize=0[mix]`;
  mapAudio = "[mix]";
}

console.log(`Mixing ${present.length} narration segments${withMusic ? " + music bed" : ""} over ${totalSec.toFixed(1)}s`);
for (const p of plan) {
  const has = present.includes(p);
  console.log(`  ${p.id}  scene ${(p.from / FPS).toFixed(1)}–${((p.from + p.dur) / FPS).toFixed(1)}s   narration at ${(p.atMs / 1000).toFixed(1)}s${has ? "" : "   (missing)"}`);
}

// Narration stops before the picture does. Pad the audio to the full
// timeline, or -shortest clips the closing scene off the end of the film.
chain += `;${mapAudio}apad=whole_dur=${totalSec.toFixed(3)}[out]`;

execFileSync("npx", ["remotion", "ffmpeg", "-y", ...inputs,
  "-filter_complex", chain, "-map", "0:v", "-map", "[out]",
  "-ac", "2", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", OUT],
  { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });

console.log(`\n→ ${OUT}`);
