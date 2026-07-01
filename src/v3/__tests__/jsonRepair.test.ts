import { describe, it, expect } from "vitest";
import {
  parseLenientJson,
  stripCodeFences,
  extractBalancedJson,
  sanitizeControlChars,
  repairTruncatedJson,
  LenientJsonError,
} from "../../../supabase/functions/_shared/jsonRepair.ts";

describe("stripCodeFences", () => {
  it("removes ```json fences and trims", () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFences('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe("extractBalancedJson", () => {
  it("pulls the outermost object out of surrounding prose", () => {
    expect(extractBalancedJson('Here it is: {"a":1,"b":[2,3]} — done')).toBe('{"a":1,"b":[2,3]}');
  });

  it("is not fooled by braces inside strings", () => {
    const s = 'prose {"a":"a } b","c":2} tail';
    expect(extractBalancedJson(s)).toBe('{"a":"a } b","c":2}');
  });

  it("returns null when the object never closes (truncated)", () => {
    expect(extractBalancedJson('{"a":1,"b":')).toBeNull();
  });
});

describe("sanitizeControlChars", () => {
  it("escapes raw newlines/tabs inside strings but not structural whitespace", () => {
    const dirty = '{"a":"line1\nline2\ttabbed"}';
    const cleaned = sanitizeControlChars(dirty);
    expect(cleaned).toBe('{"a":"line1\\nline2\\ttabbed"}');
    expect(JSON.parse(cleaned)).toEqual({ a: "line1\nline2\ttabbed" });
  });

  it("leaves already-escaped sequences untouched", () => {
    const ok = '{"a":"already\\nescaped"}';
    expect(sanitizeControlChars(ok)).toBe(ok);
  });
});

describe("repairTruncatedJson", () => {
  it("closes an object truncated after a value", () => {
    const repaired = repairTruncatedJson('{"a":1,"b":2');
    expect(repaired && JSON.parse(repaired)).toEqual({ a: 1, b: 2 });
  });

  it("drops a dangling key with no value", () => {
    const repaired = repairTruncatedJson('{"a":1,"b":');
    expect(repaired && JSON.parse(repaired)).toEqual({ a: 1 });
  });

  it("closes a string truncated mid-value", () => {
    const repaired = repairTruncatedJson('{"a":"un終わ');
    const parsed = repaired && JSON.parse(repaired) as Record<string, unknown>;
    expect(parsed).toHaveProperty("a");
  });

  it("closes nested arrays/objects truncated deep", () => {
    const repaired = repairTruncatedJson('{"list":[{"x":1},{"y":2');
    expect(repaired && JSON.parse(repaired)).toEqual({ list: [{ x: 1 }, { y: 2 }] });
  });

  it("drops a partial trailing array element", () => {
    const repaired = repairTruncatedJson('{"list":[1,2,3,');
    expect(repaired && JSON.parse(repaired)).toEqual({ list: [1, 2, 3] });
  });
});

describe("parseLenientJson", () => {
  it("parses clean JSON directly", () => {
    const r = parseLenientJson<{ a: number }>('{"a":1}');
    expect(r.value).toEqual({ a: 1 });
    expect(r.strategy).toBe("direct");
    expect(r.repaired).toBe(false);
  });

  it("parses fenced JSON with prose", () => {
    const r = parseLenientJson('Sure!\n```json\n{"a":1}\n```');
    expect(r.value).toEqual({ a: 1 });
    // fence-stripped text parses directly
    expect(["direct", "balanced"]).toContain(r.strategy);
  });

  it("extracts a balanced object buried in prose", () => {
    const r = parseLenientJson('The result is {"a":1,"b":2}. Hope that helps.');
    expect(r.value).toEqual({ a: 1, b: 2 });
    expect(r.strategy).toBe("balanced");
  });

  it("sanitizes raw control characters inside strings", () => {
    const r = parseLenientJson('{"note":"first line\nsecond line"}');
    expect(r.value).toEqual({ note: "first line\nsecond line" });
    expect(r.strategy).toBe("sanitized");
  });

  it("repairs a truncated object (max-token cutoff)", () => {
    const r = parseLenientJson<{ summary: string; items: unknown[] }>(
      '{"summary":"ok","items":[{"id":1,"name":"Alpha"},{"id":2,"name":"Bet',
    );
    expect(r.repaired).toBe(true);
    expect(r.strategy).toBe("repaired");
    expect(r.value.summary).toBe("ok");
    expect(Array.isArray(r.value.items)).toBe(true);
    expect((r.value.items[0] as { name: string }).name).toBe("Alpha");
  });

  it("repairs truncation combined with raw control chars", () => {
    const r = parseLenientJson<{ a: string; b: number[] }>(
      '{"a":"multi\nline","b":[1,2,3',
    );
    expect(r.repaired).toBe(true);
    expect(r.value.a).toBe("multi\nline");
    expect(r.value.b).toEqual([1, 2, 3]);
  });

  it("throws LenientJsonError when nothing is salvageable", () => {
    expect(() => parseLenientJson("this is not json at all")).toThrow(LenientJsonError);
  });
});
