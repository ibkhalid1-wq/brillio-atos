/**
 * "CHANGES REQUESTED" IS A STATUS. WHAT WAS WRONG IS THE WORK.
 *
 * A design round records a verdict, free text, an attestation and the design
 * version it was given about. That last field is why a round can tell you
 * feedback has gone stale. What it could never tell you is what the feedback
 * was ABOUT: "the status column is wrong" arrives as prose attached to a whole
 * build, so somebody has to read every request and go hunting for the screen.
 *
 * An ANCHOR fixes that, and the address it uses is not a new invention. It is
 * `OverrideTarget` — the same source tuple `designOverrides` already uses,
 * chosen there for exactly the property needed here: it survives regeneration.
 * A fabric id is derived from names and dies of a rename it had nothing to do
 * with; `{of:"attribute", entity:"Account", attribute:"status"}` still points
 * at the same field after the next build, and when it genuinely stops resolving
 * it becomes a NAMED orphan rather than a silent miss.
 *
 * The one thing an anchor cannot be is invented. Same refusal as
 * `reviewCapture`: an address nobody can reach turns a change request into a
 * scavenger hunt, and it is better to hold a request with no anchor than one
 * with a wrong one.
 */
import { targetKey, targetLabel, type OverrideTarget } from "./designOverrides.ts";

/**
 * WHERE a change request points.
 *
 * A SCREEN is its own kind rather than an entity tuple because they are not the
 * same claim. "The Accounts list is too dense" is about a screen's composition;
 * "Account.status is the wrong word" is about a field wherever it appears. A
 * screen id is also the coarser address, and coarse is the honest default —
 * most feedback in a review names a page, not a column.
 */
export type ChangeAnchor =
  | { of: "screen"; screen: string }
  | OverrideTarget;

/**
 * The address as a comparable string. Delegates to `targetKey` for the tuple
 * kinds so two modules cannot disagree about what "the same locus" means.
 *
 * Joined on an ESCAPED NUL, for both halves of that phrase — the same choice
 * and the same warning as `targetKey`. The byte is right because no screen id
 * or entity name can contain it, so two addresses cannot collide the way a
 * space would let them. Writing it ESCAPED is not style: a raw one makes the
 * file BINARY to grep and ripgrep, which then skip it in silence. That has now
 * happened FOUR times in this codebase — `prototypeRefine.ts`, `designOverrides.ts`,
 * `reviewCapture.ts`, and this file, where four spaces went in and four NULs
 * came out. Never type the byte; type the six characters.
 */
export function anchorKey(a: ChangeAnchor): string {
  return a.of === "screen" ? `screen\u0000${a.screen.toLowerCase()}` : targetKey(a);
}

/** Human phrasing, for a line somebody has to act on. */
export function anchorLabel(a: ChangeAnchor): string {
  return a.of === "screen" ? a.screen : targetLabel(a);
}

const text = (v: unknown): string => String(v ?? "").trim();
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Anchors per response. A request naming nine things is a meeting, not a
 *  request, and the cap keeps one response from becoming the whole backlog. */
const ANCHOR_CAP = 6;

/** Read anchors off stored or submitted data, keeping only well-formed ones.
 *  Shape only — whether the address EXISTS is `resolveAnchors`'s question, and
 *  the two are separate because a stored anchor outlives the build it was
 *  written against. */
export function readAnchors(v: unknown): ChangeAnchor[] {
  const rows = Array.isArray(v) ? v : [];
  const out: ChangeAnchor[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const of = text(row.of);
    let anchor: ChangeAnchor | null = null;
    if (of === "screen" && text(row.screen)) anchor = { of: "screen", screen: text(row.screen) };
    else if (of === "entity" && text(row.entity)) anchor = { of: "entity", entity: text(row.entity) };
    else if (of === "attribute" && text(row.entity) && text(row.attribute)) {
      anchor = { of: "attribute", entity: text(row.entity), attribute: text(row.attribute) };
    } else if (of === "relation" && text(row.parent) && text(row.child)) {
      anchor = { of: "relation", parent: text(row.parent), child: text(row.child) };
    }
    if (!anchor) continue;
    const key = anchorKey(anchor);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(anchor);
    if (out.length >= ANCHOR_CAP) break;
  }
  return out;
}

/** What the CURRENT build can be pointed at. */
export interface AnchorWorld {
  /** Every `data-screen` id the build routes to. */
  screens: Set<string>;
  /** Entity name (lowercased) → its attribute names (lowercased). */
  entities: Map<string, Set<string>>;
  /** "parent\u0000child" (lowercased) for every relation the ontology states. */
  relations: Set<string>;
}

/** Read the addressable world out of a build and its ontology. */
export function anchorWorldOf(html: string, ontology: unknown): AnchorWorld {
  const screens = new Set([...String(html ?? "").matchAll(/data-screen="([^"]+)"/g)].map((m) => m[1]));
  const entities = new Map<string, Set<string>>();
  const relations = new Set<string>();
  const doc = isRecord(ontology) ? ontology : {};
  for (const e of (Array.isArray(doc.entities) ? doc.entities : []).filter(isRecord)) {
    const name = text(e.name).toLowerCase();
    if (!name) continue;
    const attrs = new Set<string>();
    for (const a of (Array.isArray(e.attributes) ? e.attributes : [])) {
      const n = isRecord(a) ? text(a.name) : text(a);
      if (n) attrs.add(n.toLowerCase());
    }
    entities.set(name, attrs);
  }
  for (const r of (Array.isArray(doc.relations) ? doc.relations : []).filter(isRecord)) {
    const from = text(r.from).toLowerCase();
    const to = text(r.to).toLowerCase();
    if (from && to) relations.add(`${from}\u0000${to}`);
  }
  return { screens, entities, relations };
}

/** Whether one anchor still points at something that exists. */
export function anchorResolves(a: ChangeAnchor, world: AnchorWorld): boolean {
  if (a.of === "screen") return world.screens.has(a.screen);
  if (a.of === "entity") return world.entities.has(a.entity.toLowerCase());
  if (a.of === "attribute") {
    return !!world.entities.get(a.entity.toLowerCase())?.has(a.attribute.toLowerCase());
  }
  return world.relations.has(`${a.parent.toLowerCase()}\u0000${a.child.toLowerCase()}`);
}

export interface ResolvedAnchors {
  /** Still addressable in the current build — the actionable ones. */
  found: ChangeAnchor[];
  /** No longer addressable. NOT deleted, and never silently re-bound. */
  orphaned: ChangeAnchor[];
}

/**
 * Split a request's anchors against the build in front of you.
 *
 * Nothing is re-bound and nothing is dropped. An orphan is a real event worth
 * a person's attention — the thing somebody asked to change was renamed or
 * removed between the round and now, and whether the request still stands is a
 * judgement, not a lookup. Same rule `designOverrides` holds for the same
 * reason: guessing moves somebody's decision onto a field they never saw.
 */
export function resolveAnchors(anchors: readonly ChangeAnchor[], world: AnchorWorld): ResolvedAnchors {
  const found: ChangeAnchor[] = [];
  const orphaned: ChangeAnchor[] = [];
  for (const a of anchors) (anchorResolves(a, world) ? found : orphaned).push(a);
  return { found, orphaned };
}

/**
 * Say what went stale, in words somebody can act on.
 *
 * Deliberately silent when there are no orphans, and silent about requests with
 * NO anchor at all: plenty of feedback is legitimately about the whole design,
 * and a channel that nagged about every unanchored comment would stop being
 * read — the lesson the demo-script check and the watcher gaps both record.
 */
export function staleAnchorNotes(
  requests: ReadonlyArray<{ who: string; anchors: readonly ChangeAnchor[] }>,
  world: AnchorWorld,
): string[] {
  const notes: string[] = [];
  for (const r of requests) {
    const { orphaned } = resolveAnchors(r.anchors, world);
    if (!orphaned.length) continue;
    notes.push(`${r.who} asked for a change to ${orphaned.map(anchorLabel).join(", ")}, which the current build no longer has. Re-point the request or close it — do not assume it was done.`);
  }
  return notes;
}
