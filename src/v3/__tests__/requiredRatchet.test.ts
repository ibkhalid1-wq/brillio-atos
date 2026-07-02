import { isFieldRequiredForProgram } from "@/v3/lib/phaseInputSchema";
import { ATOS_STANDARD } from "@/v3/lib/methodology";
import type { PhaseInputField } from "@/v3/lib/methodology";

function field(over: Partial<PhaseInputField>): PhaseInputField {
  return { id: "f", label: "F", type: "text", required: true, ...over };
}

/**
 * The required-ness ratchet lets a new mandatory input be introduced without
 * retroactively blocking programmes that started before it existed. A `required`
 * field carrying a `requiredSince` cutoff only hard-gates programmes created on or
 * after that date; earlier programmes — and programmes with no recorded creation
 * date (seeded before the stamp existed) — treat it as optional.
 */
describe("isFieldRequiredForProgram", () => {
  it("keeps an ordinary required field required regardless of creation date", () => {
    const f = field({ required: true });
    expect(isFieldRequiredForProgram(f, "2020-01-01T00:00:00Z")).toBe(true);
    expect(isFieldRequiredForProgram(f, "")).toBe(true);
    expect(isFieldRequiredForProgram(f, undefined)).toBe(true);
  });

  it("never makes an optional field required", () => {
    const f = field({ required: false, requiredSince: "2026-07-01" });
    expect(isFieldRequiredForProgram(f, "2030-01-01T00:00:00Z")).toBe(false);
  });

  it("requires a ratcheted field only for programmes created on/after the cutoff", () => {
    const f = field({ required: true, requiredSince: "2026-07-01" });
    expect(isFieldRequiredForProgram(f, "2026-07-01T00:00:00Z")).toBe(true); // exactly on the cutoff
    expect(isFieldRequiredForProgram(f, "2026-08-15T09:30:00Z")).toBe(true); // after
    expect(isFieldRequiredForProgram(f, "2026-06-30T23:59:59Z")).toBe(false); // before
  });

  it("treats an unknown creation date as pre-ratchet (never retroactively blocks)", () => {
    const f = field({ required: true, requiredSince: "2026-07-01" });
    expect(isFieldRequiredForProgram(f, "")).toBe(false);
    expect(isFieldRequiredForProgram(f, undefined)).toBe(false);
  });

  it("ratchets the Design NFR grid: not required for a pre-cutoff programme, required for a new one", () => {
    const nfr = ATOS_STANDARD.phases
      .find((p) => p.id === "design")!
      .inputFields!.find((f) => f.id === "nonFunctionalRequirements")!;
    expect(nfr.required).toBe(true);
    expect(nfr.requiredSince).toBeTruthy();
    // A programme started before the NFR grid landed must not have its solution
    // architecture regeneration blocked by a field it never had.
    expect(isFieldRequiredForProgram(nfr, "")).toBe(false);
    expect(isFieldRequiredForProgram(nfr, "2026-01-01T00:00:00Z")).toBe(false);
    // A programme created now is held to it.
    expect(isFieldRequiredForProgram(nfr, "2026-09-01T00:00:00Z")).toBe(true);
  });
});
