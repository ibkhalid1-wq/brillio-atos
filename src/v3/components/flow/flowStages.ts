/**
 * The loop's three stages — every movement's body is organised as
 * Collect (people + what they said) -> Paper (what ATOS made of it) ->
 * Gate (can we demonstrate?). Shared by the canvas and the Up-next queue.
 */
/** Every movement runs the same loop, and its body is organised as the
 * loop's three stages — Collect (people + what they said) → Paper (what ATOS
 * made of it) → Gate (can we demonstrate?). The active one. */
export type MovementTab = "collect" | "paper" | "gate" | "plan";

/** One line saying what a movement leads with — so every phase reads the same
 * way and the operator knows where its centre of gravity is (item 1c). */
export const MOVEMENT_CAPTION: Record<string, string> = {
  frame: "Frame leads with the sponsor conversation — one recorded talk drafts the charter and the discovery kit.",
  listen: "Listen gathers each stakeholder's workflow, in their own words.",
  envision: "Envision weighs the architecture options and frames the blueprint.",
  show: "Show puts each stakeholder in front of their own workflow, running.",
  ship: "Ship leads with hardening — prove the evals, then cut over.",
  evolve: "Evolve keeps the system honest — the benefits pulse and the drift review.",
};

/** Which stage a movement opens on: conversation-led movements start on
 * Collect, build-led movements start on Paper. */
export function leadTab(movementId: string): MovementTab {
  if (movementId === "envision" || movementId === "ship" || movementId === "evolve") return "paper";
  return "collect";
}
