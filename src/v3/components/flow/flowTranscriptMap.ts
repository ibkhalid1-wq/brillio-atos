/**
 * Speaker → stakeholder auto-mapping for attached meeting transcripts.
 *
 * A transcript with "Name: …" turns is more than one person's evidence. When a
 * file looks like a meeting transcript, each detected speaker is matched
 * against the movement's roster and their turns become their OWN attributed
 * block — so everyone in the room is heard, not just the person whose card
 * took the upload. Unmatched speakers stay in the document block untouched;
 * nothing is dropped.
 */

export interface RosterPerson { name: string; role?: string; }
export interface SpeakerBlock { name: string; role?: string; text: string; }
export interface TranscriptMapping {
  /** One block per matched roster person, their turns joined in order. */
  blocks: SpeakerBlock[];
  /** Every distinct speaker label detected, matched or not. */
  speakers: string[];
  matched: string[];
  unmatched: string[];
}

// Colon-separated turns only — em-dashes belong to headings ("Notes — 10am"),
// and treating them as speakers minted phantom voices.
const SPEAKER_LINE = /^([A-Z][A-Za-z .'’-]{1,40}?)\s*:\s+(.*)$/;

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Match a speaker label to a roster person: full-name, contains, or first-name. */
function matchRoster(label: string, roster: RosterPerson[]): RosterPerson | null {
  const key = normalize(label);
  if (key.length < 2) return null;
  const exact = roster.find((p) => normalize(p.name) === key);
  if (exact) return exact;
  const contains = roster.find((p) => normalize(p.name).includes(key) || key.includes(normalize(p.name)));
  if (contains) return contains;
  const first = roster.find((p) => normalize(p.name).split(" ")[0] === key.split(" ")[0] && key.split(" ")[0].length > 2);
  return first ?? null;
}

/**
 * Detect and map a transcript's speakers. Returns null when the text does not
 * read as a meeting transcript (fewer than 2 distinct speakers or 4 turns) —
 * the caller then treats it as an ordinary document.
 */
export function mapTranscriptSpeakers(text: string, roster: RosterPerson[]): TranscriptMapping | null {
  const lines = text.split("\n");
  const turns: Array<{ speaker: string; text: string }> = [];
  let current: { speaker: string; text: string } | null = null;
  for (const line of lines) {
    const m = line.match(SPEAKER_LINE);
    if (m) {
      if (current) turns.push(current);
      current = { speaker: m[1].trim(), text: m[2].trim() };
    } else if (current && line.trim()) {
      current.text += `\n${line.trim()}`;
    }
  }
  if (current) turns.push(current);

  const speakers = [...new Set(turns.map((t) => t.speaker))];
  if (speakers.length < 2 || turns.length < 4) return null;

  const byPerson = new Map<string, SpeakerBlock>();
  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const speaker of speakers) {
    const person = matchRoster(speaker, roster);
    if (!person) { unmatched.push(speaker); continue; }
    matched.push(speaker);
    if (!byPerson.has(person.name)) byPerson.set(person.name, { name: person.name, role: person.role, text: "" });
  }
  for (const turn of turns) {
    const person = matchRoster(turn.speaker, roster);
    if (!person) continue;
    const block = byPerson.get(person.name);
    if (block) block.text += (block.text ? "\n\n" : "") + turn.text;
  }
  return {
    blocks: [...byPerson.values()].filter((b) => b.text.trim()),
    speakers, matched, unmatched,
  };
}
