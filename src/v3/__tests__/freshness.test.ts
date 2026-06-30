import { describe, it, expect } from "vitest";
import { ONE_DAY_MS, isSameUtcDay, isWithinMs } from "@/v3/lib/freshness";

describe("isSameUtcDay", () => {
  const now = new Date("2026-06-30T12:00:00Z");

  it("matches a full ISO instant on the same UTC day", () => {
    expect(isSameUtcDay("2026-06-30T08:00:00Z", now)).toBe(true);
  });

  it("matches a date-only stamp on the same UTC day", () => {
    expect(isSameUtcDay("2026-06-30", now)).toBe(true);
  });

  it("is false for a different day", () => {
    expect(isSameUtcDay("2026-06-29T23:59:59Z", now)).toBe(false);
  });

  it("is false for an empty or nullish stamp", () => {
    expect(isSameUtcDay(undefined, now)).toBe(false);
    expect(isSameUtcDay(null, now)).toBe(false);
    expect(isSameUtcDay("", now)).toBe(false);
  });
});

describe("isWithinMs", () => {
  const nowMs = Date.parse("2026-06-30T12:00:00Z");

  it("is true for a stamp inside the window", () => {
    expect(isWithinMs("2026-06-30T06:00:00Z", ONE_DAY_MS, nowMs)).toBe(true);
  });

  it("is false for a stamp older than the window", () => {
    expect(isWithinMs("2026-06-29T06:00:00Z", ONE_DAY_MS, nowMs)).toBe(false);
  });

  it("treats a legacy epoch-millis (unparseable) stamp as not fresh", () => {
    expect(isWithinMs(String(nowMs), ONE_DAY_MS, nowMs)).toBe(false);
  });

  it("treats an empty or nullish stamp as not fresh", () => {
    expect(isWithinMs(null, ONE_DAY_MS, nowMs)).toBe(false);
    expect(isWithinMs("", ONE_DAY_MS, nowMs)).toBe(false);
  });
});
