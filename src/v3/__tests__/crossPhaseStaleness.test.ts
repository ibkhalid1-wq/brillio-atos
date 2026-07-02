import { crossPhaseArtifactsToStale } from "@/v3/lib/artifactStaleness";
import type { DynamicSchemaStore } from "@/v3/lib/dynamicSchema";

/**
 * Cross-phase staleness: when an upstream deliverable changes (Discover's
 * Requirements Catalog), any downstream artifact whose `artifact-reference` input
 * names it (Design's Solution Architecture, grounded on that catalog) is now
 * built on shifted ground and must be regenerated too. The dependency is
 * expressed exactly as the product does it — a later phase's artifact-reference
 * field labelled after the upstream deliverable, wired to the downstream artifact
 * via the dynamic schema's `artifactInputFlow`.
 */
const store: DynamicSchemaStore = {
  inputFields: {
    design: [
      {
        id: "reqRef",
        label: "Reference to approved requirements catalog",
        type: "artifact-reference",
        required: true,
        source: "ai-derived",
      },
    ],
  },
  artifactInputFlow: {
    design: { "solution-architecture": ["reqRef"] },
  },
};

describe("crossPhaseArtifactsToStale", () => {
  it("stales a downstream artifact whose artifact-reference names the changed upstream deliverable", () => {
    const stale = crossPhaseArtifactsToStale(
      "discover",
      ["requirements-catalog"],
      { design: { "solution-architecture": { status: "approved" } } },
      store,
    );
    expect(stale).toEqual([{ phaseId: "design", artifactId: "solution-architecture" }]);
  });

  it("never returns artifacts in the origin phase (that ripple is intra-phase)", () => {
    // The reference field + flow live in the origin phase here; cross-phase must skip it.
    const originStore: DynamicSchemaStore = {
      inputFields: { discover: store.inputFields!.design },
      artifactInputFlow: { discover: { "solution-architecture": ["reqRef"] } },
    };
    const stale = crossPhaseArtifactsToStale(
      "discover",
      ["requirements-catalog"],
      { discover: { "solution-architecture": { status: "approved" } } },
      originStore,
    );
    expect(stale).toEqual([]);
  });

  it("does not propagate when no downstream reference matches the changed deliverable", () => {
    // scope-map ("Scope Map") shares no content tokens with the reqRef label
    // ("requirements catalog"), so the reference is not pointing at what changed.
    const stale = crossPhaseArtifactsToStale(
      "discover",
      ["scope-map"],
      { design: { "solution-architecture": { status: "approved" } } },
      store,
    );
    expect(stale).toEqual([]);
  });

  it("only follows artifact-reference inputs, not a plain field that happens to share the label", () => {
    const textStore: DynamicSchemaStore = {
      inputFields: {
        design: [
          {
            id: "reqNote",
            label: "Reference to approved requirements catalog",
            type: "textarea",
            required: false,
            source: "ai-derived",
          },
        ],
      },
      artifactInputFlow: { design: { "solution-architecture": ["reqNote"] } },
    };
    const stale = crossPhaseArtifactsToStale(
      "discover",
      ["requirements-catalog"],
      { design: { "solution-architecture": { status: "approved" } } },
      textStore,
    );
    expect(stale).toEqual([]);
  });

  it("leaves archived and already-stale downstream artifacts untouched", () => {
    expect(
      crossPhaseArtifactsToStale(
        "discover",
        ["requirements-catalog"],
        { design: { "solution-architecture": { status: "archived" } } },
        store,
      ),
    ).toEqual([]);
    expect(
      crossPhaseArtifactsToStale(
        "discover",
        ["requirements-catalog"],
        { design: { "solution-architecture": { status: "stale" } } },
        store,
      ),
    ).toEqual([]);
  });

  it("no-ops when nothing changed or the downstream artifact was never generated", () => {
    expect(crossPhaseArtifactsToStale("discover", [], { design: {} }, store)).toEqual([]);
    // Referenced but not yet generated ⇒ nothing in the bucket to stale.
    expect(crossPhaseArtifactsToStale("discover", ["requirements-catalog"], { design: {} }, store)).toEqual([]);
  });
});
