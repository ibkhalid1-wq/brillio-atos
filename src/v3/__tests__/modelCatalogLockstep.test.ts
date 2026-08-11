/**
 * Client ↔ edge lockstep — the AI provider model list must never drift from the
 * model catalog.
 *
 * `supabase/functions/_shared/modelCatalog.ts` is the documented single source
 * of truth for which models exist, their tier, and their pricing. But the AI
 * settings picker (`src/new/pages/IntelligenceView.tsx`) carried its OWN
 * hardcoded Anthropic model array, and that array was never updated when the
 * catalog moved on — so the settings screen offered models Anthropic had
 * superseded and hid the ones the runtime actually routes to. Two lists, one
 * rots. This test makes the second list a *rendering* of the first: adding a
 * model to the catalog fails CI until the picker offers it, and the picker can
 * never offer an id the catalog has never heard of.
 *
 * Why text parsing rather than a shared import (the preferred option): the
 * catalog is a Deno module under `supabase/functions/`, which cannot be
 * imported into the Vite client bundle or a vitest run. This is the same
 * boundary every other client↔edge contract lives across — see
 * `answerCapLockstep.test.ts` and `edgeLockstep.test.ts`, which likewise parse
 * the edge source as text.
 *
 * No DB, no network — pure source scan.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/_shared/modelCatalog.ts"), "utf8");
const CLIENT = readFileSync(resolve(__dirname, "../../new/pages/IntelligenceView.tsx"), "utf8");

interface CatalogEntry {
  id: string;
  provider: string;
  tier: string;
  inputPricePerM: number;
  outputPricePerM: number;
  costMultiplier: number;
  legacy: boolean;
  retired: boolean;
  priceUnverified: boolean;
  /** The capability-profile SYMBOL the entry references, e.g. `ANTHROPIC_NO_SAMPLING_PARAMS`. */
  capabilities: string;
}

/** Parse the edge's `MODEL_CATALOG` array (one entry per line). */
function parseCatalog(): CatalogEntry[] {
  const block = EDGE.match(/export const MODEL_CATALOG: ModelCatalogEntry\[\] = \[([\s\S]*?)\n\];/);
  expect(block, "MODEL_CATALOG not found in modelCatalog.ts").toBeTruthy();
  const entries = [...block![1].matchAll(/\{ id: "([^"]+)", provider: "([^"]+)", tier: "([^"]+)",([^}]*)\}/g)]
    .map((match) => {
      const rest = match[4];
      const num = (key: string): number => {
        const found = rest.match(new RegExp(`${key}: (-?[0-9.]+)`));
        expect(found, `${key} missing on catalog entry ${match[1]}`).toBeTruthy();
        return Number(found![1]);
      };
      return {
        id: match[1],
        provider: match[2],
        tier: match[3],
        inputPricePerM: num("inputPricePerM"),
        outputPricePerM: num("outputPricePerM"),
        costMultiplier: num("costMultiplier"),
        legacy: /legacy: true/.test(rest),
        retired: /retired: true/.test(rest),
        priceUnverified: /priceUnverified: true/.test(rest),
        capabilities: rest.match(/capabilities: ([A-Za-z0-9_.]+)/)?.[1] ?? "",
      };
    });
  expect(entries.length, "catalog parse produced no entries").toBeGreaterThan(8);
  return entries;
}

/** Parse `DEFAULT_BY_PROVIDER` from the edge. */
function parseDefault(provider: string): string {
  const block = EDGE.match(/const DEFAULT_BY_PROVIDER: Record<AIProvider, string> = \{([\s\S]*?)\n\};/);
  expect(block, "DEFAULT_BY_PROVIDER not found in modelCatalog.ts").toBeTruthy();
  const found = block![1].match(new RegExp(`${provider}: "([^"]+)"`));
  expect(found, `no default model for ${provider}`).toBeTruthy();
  return found![1];
}

/** Parse the model ids the client picker offers for a provider, in order. */
function parseClientModelIds(provider: string): string[] {
  const start = CLIENT.indexOf(`id: "${provider}",`);
  expect(start, `AI_PROVIDERS entry for ${provider} not found in IntelligenceView.tsx`).toBeGreaterThan(-1);
  const models = CLIENT.slice(start).match(/models: \[([\s\S]*?)\n {4}\],/);
  expect(models, `models array for ${provider} not found`).toBeTruthy();
  const ids = [...models![1].matchAll(/\{ id: "([^"]+)"/g)].map((match) => match[1]);
  expect(ids.length, `models array for ${provider} parsed empty`).toBeGreaterThan(0);
  return ids;
}

const CATALOG = parseCatalog();
const CATALOG_IDS = new Set(CATALOG.map((entry) => entry.id));
const PROVIDERS = ["anthropic", "openai", "google"] as const;

describe("AI settings picker ↔ model catalog lockstep", () => {
  it("both sides parsed (guards against a regex that silently matches nothing)", () => {
    expect(new Set(CATALOG.map((entry) => entry.provider))).toEqual(new Set(PROVIDERS));
    for (const provider of PROVIDERS) expect(parseClientModelIds(provider).length).toBeGreaterThan(0);
    // The legacy/current split must actually exist, or the assertions below are vacuous.
    expect(CATALOG.some((entry) => entry.legacy)).toBe(true);
    expect(CATALOG.some((entry) => !entry.legacy)).toBe(true);
  });

  it.each(PROVIDERS)("every model the %s picker offers exists in the catalog", (provider) => {
    const phantom = parseClientModelIds(provider).filter((id) => !CATALOG_IDS.has(id));
    expect(
      phantom,
      `\nThe picker offers ${provider} models the catalog has never heard of: ${phantom.join(", ")}.\n` +
      `Add them to MODEL_CATALOG (with real tier + pricing) or remove them from IntelligenceView.tsx.\n`,
    ).toEqual([]);
  });

  it("every current (non-legacy) Anthropic catalog entry is offered in the picker", () => {
    const offered = new Set(parseClientModelIds("anthropic"));
    const hidden = CATALOG
      .filter((entry) => entry.provider === "anthropic" && !entry.legacy)
      .map((entry) => entry.id)
      .filter((id) => !offered.has(id));
    expect(
      hidden,
      `\nThe catalog carries current Anthropic models the settings picker hides: ${hidden.join(", ")}.\n` +
      `This is the exact drift this test exists to stop — add them to AI_PROVIDERS in IntelligenceView.tsx.\n`,
    ).toEqual([]);
  });

  it.each(PROVIDERS)("the %s provider default is offered in the picker, first", (provider) => {
    const offered = parseClientModelIds(provider);
    const fallback = parseDefault(provider);
    expect(offered).toContain(fallback);
    // Three call sites in IntelligenceView fall back to `models[0].id` when no
    // model is configured, so position 0 must BE the provider default — else the
    // UI silently proposes a different model than the runtime would pick.
    expect(offered[0]).toBe(fallback);
  });

  it.each(PROVIDERS)("the %s provider default is a current model, never a superseded one", (provider) => {
    const entry = CATALOG.find((candidate) => candidate.id === parseDefault(provider));
    expect(entry, `default model for ${provider} is not in the catalog`).toBeTruthy();
    expect(entry!.legacy, `${entry!.id} is the ${provider} default but is marked legacy`).toBeFalsy();
  });
});

describe("catalog integrity — legacy routing, pricing honesty, one multiplier rule", () => {
  it("modelForTier excludes legacy entries, so a superseded model is never auto-routed", () => {
    const fn = EDGE.match(/export function modelForTier\([\s\S]*?\n\}/);
    expect(fn, "modelForTier not found").toBeTruthy();
    expect(fn![0]).toContain("!entry.legacy");
  });

  it("every provider+tier still has a current model to route to", () => {
    const gaps: string[] = [];
    for (const provider of PROVIDERS) {
      const tiers = new Set(CATALOG.filter((entry) => entry.provider === provider).map((entry) => entry.tier));
      for (const tier of tiers) {
        const current = CATALOG.filter((entry) =>
          entry.provider === provider && entry.tier === tier && !entry.legacy);
        if (current.length === 0) gaps.push(`${provider}/${tier}`);
      }
    }
    expect(
      gaps,
      `\n${gaps.join(", ")} has only legacy models — modelForTier returns undefined and routing silently ` +
      `falls back to the configured default. Add a current model at that tier.\n`,
    ).toEqual([]);
  });

  it("costMultiplier is derived by ONE rule (inputPricePerM / 3, the tier2 Sonnet anchor)", () => {
    const offenders = CATALOG
      .filter((entry) => Math.abs(entry.costMultiplier - entry.inputPricePerM / 3) > 0.005)
      .map((entry) => `${entry.id}: costMultiplier ${entry.costMultiplier}, expected ~${(entry.inputPricePerM / 3).toFixed(2)}`);
    expect(
      offenders,
      `\nHand-tuned cost multipliers diverge from list pricing — tier routing would sort on a fiction:\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("no catalog entry carries a placeholder price — including the provisional ones", () => {
    // `priceUnverified` flags a price that is REAL but not currently in force
    // (e.g. an introductory rate). It must never be used to smuggle in a zeroed
    // or invented figure: a model with no known price belongs out of the catalog.
    const bad = CATALOG
      .filter((entry) => !(entry.inputPricePerM > 0) || !(entry.outputPricePerM > 0))
      .map((entry) => entry.id);
    expect(bad, `\nNon-positive pricing in the catalog: ${bad.join(", ")}\n`).toEqual([]);
  });

  // Anthropic REMOVED `temperature` in the 4.7-and-later generation: sending it
  // to any of these returns a 400, so an entry that inherits the provider
  // default (`acceptsTemperature: true`) makes every run on that model fail.
  // This is not a style rule — `claude-sonnet-5` is the configured default, so
  // getting it wrong breaks the primary path outright rather than degrading it.
  const SAMPLING_PARAMS_REMOVED = ["claude-sonnet-5", "claude-fable-5", "claude-opus-4-8"];

  it("models that reject sampling params do not inherit the temperature-sending default", () => {
    const present = CATALOG.filter((entry) => SAMPLING_PARAMS_REMOVED.includes(entry.id));
    expect(
      present.map((entry) => entry.id).sort(),
      "catalog no longer carries the models this sentry guards — update SAMPLING_PARAMS_REMOVED deliberately",
    ).toEqual([...SAMPLING_PARAMS_REMOVED].sort());

    const offenders = present
      .filter((entry) => entry.capabilities !== "ANTHROPIC_NO_SAMPLING_PARAMS")
      .map((entry) => `${entry.id}: capabilities = ${entry.capabilities || "(unparsed)"}`);
    expect(
      offenders,
      `\nThese models reject \`temperature\` with a 400, but their catalog entry inherits a profile\n` +
      `that sends it:\n${offenders.join("\n")}\n` +
      `Give them ANTHROPIC_NO_SAMPLING_PARAMS. Inheriting PROVIDER_DEFAULT_CAPABILITIES.anthropic\n` +
      `here is not graceful degradation — it is a guaranteed 400 on every call.\n`,
    ).toEqual([]);
  });

  it("the no-sampling profile actually clears the flag, and claudeClient gates on it", () => {
    // Both halves must hold or the profile is decorative: the constant has to
    // set the flag false, AND the payload builder has to consult it.
    const declaration = EDGE.match(
      /const ANTHROPIC_NO_SAMPLING_PARAMS: ModelCapabilityProfile = \{([\s\S]*?)\};/,
    );
    expect(declaration, "ANTHROPIC_NO_SAMPLING_PARAMS not found in modelCatalog.ts").toBeTruthy();
    expect(declaration![1]).toMatch(/acceptsTemperature:\s*false/);

    const client = readFileSync(
      resolve(__dirname, "../../../supabase/functions/_shared/claudeClient.ts"),
      "utf8",
    );
    const anthropicBranch = client.match(/function anthropicPayload\([\s\S]*?\n\}/);
    expect(anthropicBranch, "anthropicPayload not found in claudeClient.ts").toBeTruthy();
    expect(
      anthropicBranch![0],
      "anthropicPayload must attach `temperature` only behind caps.acceptsTemperature — " +
      "an unconditional assignment re-breaks every 4.7+ model regardless of the catalog.",
    ).toMatch(/if \(caps\.acceptsTemperature\)[\s\S]*?temperature/);
  });

  it("no edge function hardcodes an Anthropic model id — the catalog is the only place they live", () => {
    // The picker was not the only second source: `company-brief` pinned its own
    // `claude-sonnet-4-6` and went stale the same way. Every Anthropic model id
    // in edge code must now come from the catalog (`defaultModelForProvider` /
    // `modelForTier`), so this scans for the literal across all edge sources.
    const root = resolve(__dirname, "../../../supabase/functions");
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.isFile() && path.endsWith(".ts") ? [path] : [];
    });
    const files = walk(root);
    expect(files.length, "edge source scan found no .ts files — the walk is broken").toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const path of files) {
      if (path.endsWith(`_shared${"/"}modelCatalog.ts`)) continue; // the source of truth itself
      for (const [, id] of readFileSync(path, "utf8").matchAll(/"(claude-[a-z0-9.-]+)"/g)) {
        offenders.push(`${relative(root, path)} → "${id}"`);
      }
    }
    expect(
      offenders,
      `\nHardcoded Anthropic model ids outside modelCatalog.ts:\n${offenders.join("\n")}\n` +
      `Use defaultModelForProvider("anthropic") or modelForTier(...) instead — a literal here goes stale\n` +
      `the moment the catalog default moves, which is the bug this whole test exists to prevent.\n`,
    ).toEqual([]);
  });

  it("the provisional-price flag is documented for dollar-reporting surfaces", () => {
    // The run-agent cost ledger derives `costUsd` from these numbers; the caveat
    // has to travel with the entry or a provisional figure gets read as spend.
    const declaration = EDGE.match(/priceUnverified\?: true;/);
    expect(declaration, "priceUnverified flag missing from ModelCatalogEntry").toBeTruthy();
    expect(EDGE).toMatch(/PROVISIONAL/);
    expect(EDGE).toMatch(/DOLLARS/);
  });
});

describe("retired models — the picker must not offer a 404 as an ordinary choice", () => {
  // `legacy` and `retired` are different facts and the picker has to say which. A legacy
  // model still WORKS, so "kept selectable for programmes already pinned to it" is true of
  // it. A retired one 404s, so that same sentence is a promise the API will not keep — and
  // it was live on claude-opus-4-1 for five days after its retirement date, one line above
  // claude-3-5-haiku-latest, which stated the honest version.
  const retired = () => CATALOG.filter((entry) => entry.retired);

  it("the split is real, or every assertion below is vacuous", () => {
    expect(retired().length).toBeGreaterThan(0);
    expect(CATALOG.some((entry) => !entry.retired)).toBe(true);
  });

  it("a retired model is never auto-routed", () => {
    const fn = EDGE.match(/export function modelForTier\([\s\S]*?\n\}/);
    expect(fn, "modelForTier not found").toBeTruthy();
    expect(fn![0]).toContain("!entry.retired");
  });

  it("a retired model is never a provider default", () => {
    for (const provider of PROVIDERS) {
      const entry = CATALOG.find((candidate) => candidate.id === parseDefault(provider));
      expect(entry?.retired, `${provider} defaults to a retired model`).toBeFalsy();
    }
  });

  it("every retired model SAYS SO in the picker, and none is sold as merely superseded", () => {
    const offending: string[] = [];
    for (const entry of retired()) {
      // the label/description pair the picker renders for this id
      const block = CLIENT.match(new RegExp(`\\{ id: "${entry.id}",[^}]*\\}`));
      if (!block) continue;                       // not offered at all is also honest
      if (!/retired/i.test(block[0])) offending.push(`${entry.id}: not labelled retired`);
      if (/kept selectable/i.test(block[0])) offending.push(`${entry.id}: sold as merely superseded`);
    }
    expect(
      offending,
      `\n${offending.join("\n")}\n` +
      `A retired id returns 404. Say so, or drop it from the picker — do not offer it as a\n` +
      `model an operator may reasonably stay pinned to.\n`,
    ).toEqual([]);
  });

  it("but it STAYS in the catalog, so an already-pinned programme still resolves its real price", () => {
    for (const entry of retired()) {
      expect(entry.inputPricePerM).toBeGreaterThan(0);
      expect(entry.outputPricePerM).toBeGreaterThan(0);
    }
  });
});
