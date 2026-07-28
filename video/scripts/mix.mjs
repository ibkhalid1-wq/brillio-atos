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
const scenes = [...src.matchAll(/id: "(seg\d+)"[\s\S]*?animFloor: (\d+),\s*\n\s*tail: ([\d.]+)/g)]
  .map((m) => ({ id: m[1], animFloor: +m[2], tail: +m[3] }));

let cursor = 0;
const plan = scenes.map((s) => {
  const dur = Math.max(s.animFloor, Math.ceil((LEAD_IN + (durations[s.id] || 0) + s.tail) * FPS), 120);
  const lead = s.id === "seg1" ? 0.5 : LEAD_IN;
  const at = Math.round((cursor / FPS + lead) * 1000);
  cursor += dur;
  return { ...s, atMs: at, from: cursor - dur, dur };
});
const totalSec = cursor / FPS;

const present = plan.filter((p) => existsSync(join(ROOT, `vo-you/${p.id}.wav`)));
if (!present.length) { console.error("No narration in vo-you/ — run `npm run vo` first."); process.exit(1); }
if (!existsSync(VIDEO)) { console.error("No render in out/ — run `npm run render` first."); process.exit(1); }

const inputs = ["-i", VIDEO, ...present.flatMap((p) => ["-i", join(ROOT, `vo-you/${p.id}.wav`)])];
const delays = present.map((p, i) => `[${i + 1}:a]adelay=${p.atMs}|${p.atMs}[a${i}]`).join(";");
const labels = present.map((_, i) => `[a${i}]`).join("");
let chain = `${delays};${labels}amix=inputs=${present.length}:normalize=0[vo]`;
let mapAudio = "[vo]";

if (withMusic && existsSync(join(ROOT, "music/bed.wav"))) {
  inputs.push("-i", join(ROOT, "music/bed.wav"));
  // Duck the bed 3.5dB under every narration window — precise, no pumping.
  const duck = present
    .map((p) => `between(t,${(p.atMs / 1000).toFixed(2)},${(p.atMs / 1000 + (durations[p.id] || 0)).toFixed(2)})`)
    .join("+");
  chain += `;[${present.length + 1}:a]volume='(1-0.33*(${duck}))':eval=frame[bed];[vo][bed]amix=inputs=2:normalize=0[mix]`;
  mapAudio = "[mix]";
}

console.log(`Mixing ${present.length} narration segments${withMusic ? " + music bed" : ""} over ${totalSec.toFixed(1)}s`);
for (const p of plan) {
  const has = present.includes(p);
  console.log(`  ${p.id}  scene ${(p.from / FPS).toFixed(1)}–${((p.from + p.dur) / FPS).toFixed(1)}s   narration at ${(p.atMs / 1000).toFixed(1)}s${has ? "" : "   (missing)"}`);
}

execFileSync("npx", ["remotion", "ffmpeg", "-y", ...inputs,
  "-filter_complex", chain, "-map", "0:v", "-map", mapAudio,
  "-ac", "2", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", OUT],
  { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });

console.log(`\n→ ${OUT}`);
