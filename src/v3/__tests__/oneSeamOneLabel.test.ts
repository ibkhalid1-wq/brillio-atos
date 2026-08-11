/**
 * ONE SEAM, ONE NAME — the single-source invariant, applied to owner LABELS.
 *
 * Found in validation pass 2 by the 10x scale probe's roster assertion, then
 * confirmed against the real Laila snapshot, where it is live today:
 *
 *     "Practices ⋈ Sales Leaders"   5 questions
 *     "Practices ⋈ Sales"          10 questions
 *
 * The same pair of functions, split across two bands. `ownerFor` maps functions
 * through ROLE_LABEL before building the joint owner; `jointOrOwner` — the path a
 * RELATION or a cross-area STEP takes — built it from the raw function tokens and
 * skipped ROLE_LABEL entirely.
 *
 * WHY IT MATTERED, beyond tidiness. Every surface groups seams by `ownerLabel`.
 * Two labels for one seam means the Sessions panel draws two pair cards for one
 * conversation an operator has to schedule once, and a roster person routed via
 * `ownerRoleLabelForArea` (which DOES apply ROLE_LABEL) matches one band and not
 * the other — so half their seam questions never reach them.
 *
 * The near-miss worth naming: `jointOwner` already sorts parties so that a seam
 * is order-independent, and `types.ts` documents that as "one seam, one
 * identity". That guarantee was defeated before it was reached — the labels
 * differed in the party NAME, not the ordering. A normalisation that runs after
 * the divergence cannot see it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { ownerLabel } from "@/v3/lib/ledger/types";
import { isLive } from "@/v3/lib/ledger/types";

const snapshotDir = resolve(__dirname, "../../../docs/laila/snapshot-2026-08-07");
const read = (f: string): Record<string, unknown> => {
  const raw = JSON.parse(readFileSync(resolve(snapshotDir, f), "utf8")) as Record<string, unknown>;
  const nested = (raw as { data?: unknown }).data;
  return (nested && typeof nested === "object" ? nested : raw) as Record<string, unknown>;
};
const laila = (): Snapshot => ({ ontology: read("domain-ontology.json"), atlas: read("current-state-atlas.json"), overrides: JSON.parse(readFileSync(resolve(snapshotDir, "operator-overrides.json"), "utf8")) as Array<Record<string, unknown>> });

/** Every distinct joint label the real programme produces. */
const jointLabels = (): string[] => {
  const store = migrate(laila());
  const labels = new Set<string>();
  for (const c of store.claims()) {
    if (!isLive(c) || c.ownerWhileOpen.kind !== "joint") continue;
    labels.add(ownerLabel(c.ownerWhileOpen));
  }
  return [...labels];
};

describe("a seam wears one label, whichever path built it", () => {
  it("the real snapshot produces joint owners at all (not a vacuous check)", () => {
    expect(jointLabels().length).toBeGreaterThan(0);
  });

  it("no two joint labels name the same seam under different spellings", () => {
    // A raw function token and its ROLE_LABEL are the SAME party. If both appear
    // as parties across the label set, one seam has two names.
    const RAW_TO_LABEL: Record<string, string> = { Sales: "Sales Leaders" };
    const seen = jointLabels();
    const collisions: string[] = [];
    for (const label of seen) {
      const canonical = label.split(" ⋈ ").map((p) => RAW_TO_LABEL[p] ?? p).sort().join(" ⋈ ");
      const twin = seen.find((other) => other !== label
        && other.split(" ⋈ ").map((p) => RAW_TO_LABEL[p] ?? p).sort().join(" ⋈ ") === canonical);
      if (twin) collisions.push(`${label}  ==  ${twin}`);
    }
    expect(collisions, `one seam under two labels:\n${collisions.join("\n")}`).toEqual([]);
  });

  it("no joint label carries a RAW function token where a role label exists", () => {
    // The direct statement of the fix: the parties are labels, not tokens.
    const raws = ["Sales"];   // ROLE_LABEL maps this to "Sales Leaders"
    const offenders = jointLabels().filter((l) => l.split(" ⋈ ").some((p) => raws.includes(p)));
    expect(offenders, `raw function tokens in joint labels: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the seam is still order-independent (the guarantee we did not break)", () => {
    for (const label of jointLabels()) {
      const parties = label.split(" ⋈ ");
      expect(parties, `${label} is not sorted`).toEqual([...parties].sort());
      expect(new Set(parties).size, `${label} repeats a party`).toBe(parties.length);
    }
  });
});
