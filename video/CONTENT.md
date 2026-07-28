# The AURA film — content library

Every word, every narration line and every pacing rule lives in **`src/content.ts`**.
Nothing else needs editing to change the film.

```
src/content.ts        ← the only file you edit for content
src/vo-durations.json ← measured narration lengths (written by `npm run vo`)
src/tokens.ts         ← colours + the DERIVED timeline (don't hand-edit timings)
src/scenes.tsx        ← animation only; all copy is imported
scripts/prepare-vo.mjs← turns raw recordings into film-ready audio
scripts/mix.mjs       ← lays narration (and optionally music) onto the render
```

## The one rule that makes this work

**Scene durations are derived, never written.** Each scene is sized to:

```
max( lead-in + narration + tail ,  animation floor )
```

So when narration changes length, the film re-times itself. There is no
list of hand-computed timings to keep in sync — that was the source of
most of the rework in earlier versions.

---

## Common jobs

### Change a word on screen
Edit the `headline`, `subline`, `eyebrow`, or one of the content arrays in
`src/content.ts`, then:
```bash
npm run build:film
```

### Change a narration line
1. Edit the scene's `vo` in `src/content.ts` (keep it as the record of truth).
2. Get audio for it, either way:
```bash
# your cloned voice, regenerated in seconds
ELEVENLABS_API_KEY=sk_… npm run vo:eleven -- --only seg4

# or re-record it yourself — any format, filename containing the scene id
#   "Seg 4 - people.m4a" → vo-raw/
```
3. Then:
```bash
npm run vo          # trims, level-matches, measures
npm run build:film  # re-times the film to the new length and mixes
```
Only the segment you changed moves; the rest are untouched.

### Which voice the film is using
Both narrations live side by side and the film is built from whichever is
in `vo-you/`:

| | source | how to select |
|---|---|---|
| Cloned | ElevenLabs "Ib Voice" | `npm run vo:eleven` then `npm run vo` |
| Recorded | your own takes, kept in `vo-recorded-ibrahim/` | `npm run vo:mine` |

Follow either with `npm run build:film`.

### Keeping the accent American
The first cloned pass drifted British. The cause was the model, not the
clone: `eleven_multilingual_v2` shares one phoneme space across 29
languages and pulls a cloned voice toward that average.
`scripts/tts-eleven.mjs` pins it down:

- **`eleven_turbo_v2`** — English-only, so there is no foreign phonetics to
  drift into. This is the fix that matters.
- **`similarity_boost` 0.97** — holds timbre and vowel colour to your samples.
- **`style` 0** — style exaggeration re-introduces the model's average voice.
- **`stability` 0.38** — low enough to follow your prosody rather than the
  model's.

Spelling counts too: British forms in the copy cue British pronunciation, so
the content library uses *fulfillment* and *judgment*, not *fulfilment* and
*judgement*. Watch for that when you add a line.

### Change the pacing
- `tail` — seconds of breath after a line before the cut. Raise it for a
  more contemplative feel, lower it to tighten.
- `LEAD_IN` — silence before every narration line begins.
- `animFloor` — the frames a scene's animation needs regardless of
  narration. Raise it if a visual feels rushed; the scene will never be
  shorter than this.

### Add or remove music
```bash
npm run mix:music   # with the bed
npm run mix         # voice only
```
The bed lives at `music/bed.wav`. It ducks 3.5 dB under every narration
window automatically — the windows come from the derived timeline, so
ducking can never drift out of sync.

### Swap a product screenshot
Put the new PNG in `public/` and point `RECEIPTS` at it in `content.ts`.
These are real captures from the live programme — replace them when the
UI changes so the film keeps telling the truth.

---

## Audio standards

| | value | why |
|---|---|---|
| Narration RMS | −18 dBFS | consistent between takes; sits right against the bed |
| Music in gaps | −27.6 dBFS | audible, fills silence |
| Music under speech | −31.7 dBFS | present, never competing |
| Final peak | under −1 dBFS | no clipping on any playback system |

`npm run vo` enforces the narration target automatically and caps gain
per file so nothing clips.

## Recording narration

Nine takes, one per scene, filename containing the scene id. Quiet room,
consistent mic distance, presenting pace rather than reading pace. Don't
chase the target durations in `content.ts` — they describe the current
cut, and the film re-times to whatever you deliver.

`…` in a `vo` line marks a deliberate pause. They carry the two beats the
film depends on: after the opening question, and before the final answer.

## Verify before you ship

```bash
npm run check   # types
npm run studio  # scrub any frame live
```
