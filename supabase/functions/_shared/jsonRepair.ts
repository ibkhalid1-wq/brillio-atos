// Lenient JSON parsing for LLM output.
//
// Models asked to "reply with JSON" routinely return something that is *almost*
// JSON: wrapped in ```json fences, prefaced with a sentence of prose, truncated
// mid-object when the response hits the max-token ceiling, or carrying raw
// control characters (unescaped newlines/tabs) inside string values. The old
// call sites did `JSON.parse(stripFences(text))` and, on failure, a naive
// greedy `/\{[\s\S]*\}/` match — which cannot salvage a truncated or
// control-char-dirty payload and throws away the whole extraction.
//
// parseLenientJson tries a series of increasingly aggressive strategies and
// returns the first that parses, reporting which one worked so callers can log
// whether (and how heavily) a repair was needed. Pure string logic, no runtime
// deps — safe to unit-test under Node/vitest as well as run under Deno.

export type LenientJsonStrategy =
  | "direct" // parsed as-is after fence/prose stripping
  | "balanced" // extracted the outermost balanced {...} / [...] block
  | "sanitized" // escaped raw control characters inside strings, then parsed
  | "repaired"; // closed a truncated structure (and/or trimmed a partial tail)

export interface LenientJsonResult<T> {
  value: T;
  strategy: LenientJsonStrategy;
  /** True when structural repair (closing/trimming a truncated payload) was applied. */
  repaired: boolean;
}

export class LenientJsonError extends Error {
  constructor(message: string, readonly rawPreview: string) {
    super(message);
    this.name = "LenientJsonError";
  }
}

/** Strip a single leading ```json (or ```) fence and a trailing ``` fence, then trim. */
export function stripCodeFences(text: string): string {
  return text
    .replace(/^\uFEFF/, "") // stray BOM
    .replace(/^\s*```[a-z0-9]*\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

/**
 * Extract the outermost balanced JSON value ({...} or [...]) from a string that
 * may have prose on either side. Scans with string/escape awareness so braces
 * inside string literals don't throw off the balance. Returns the substring, or
 * null when no complete balanced block is present (e.g. truncated output).
 */
export function extractBalancedJson(text: string): string | null {
  const start = firstStructuralIndex(text);
  if (start === -1) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function firstStructuralIndex(text: string): number {
  const brace = text.indexOf("{");
  const bracket = text.indexOf("[");
  if (brace === -1) return bracket;
  if (bracket === -1) return brace;
  return Math.min(brace, bracket);
}

/**
 * Escape raw control characters (unescaped newlines/tabs/etc.) that appear
 * *inside* string literals — a common way LLM JSON becomes unparseable. Control
 * characters outside strings (structural whitespace) are left untouched.
 */
export function sanitizeControlChars(text: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = text.charCodeAt(i);
    if (inString) {
      if (escape) {
        out += ch;
        escape = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        escape = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      if (code < 0x20) {
        // Raw control char inside a string → escape it so JSON.parse accepts it.
        if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else out += "\\u" + code.toString(16).padStart(4, "0");
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

/**
 * Best-effort repair of a truncated JSON value: if the model was cut off
 * mid-object/array, close any open string and containers so the salvageable
 * prefix parses. Trims a dangling trailing comma and a dangling `"key":` that
 * never received a value, then progressively drops the last (possibly partial)
 * element until the result parses or there's nothing left to trim.
 */
export function repairTruncatedJson(text: string): string | null {
  const start = firstStructuralIndex(text);
  if (start === -1) return null;
  const body = text.slice(start);

  // Single scan to capture, at each safe truncation boundary, the container
  // stack in effect. A "safe boundary" is a point where we are not inside a
  // string and could validly close the structure: right after a value/closer,
  // or just before a separating comma.
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  const boundaries: Array<{ end: number; stack: string[] }> = [];
  const pushBoundary = (end: number) => {
    boundaries.push({ end, stack: [...stack] });
    if (boundaries.length > 128) boundaries.shift();
  };

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') {
        inString = false;
        pushBoundary(i + 1); // just after a completed string value
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      pushBoundary(i + 1); // just after a completed container
    } else if (ch === ",") {
      pushBoundary(i); // truncate before the comma → drop what follows
    } else if (ch === "e" || ch === "l") {
      // crude end-of-literal boundary for true / false / null (…e, …e, …l)
      pushBoundary(i + 1);
    } else if (ch >= "0" && ch <= "9") {
      pushBoundary(i + 1); // possible end of a number
    }
  }

  const candidates: string[] = [];

  // 1) Close the current state in place (handles a value truncated mid-string).
  candidates.push(closeStructure(body, [...stack], inString));

  // 2) Fall back to each recorded safe boundary, newest first, closing the
  //    prefix at that point. This drops a partial trailing element.
  for (let b = boundaries.length - 1; b >= 0; b--) {
    const { end, stack: snapshot } = boundaries[b];
    candidates.push(closeStructure(body.slice(0, end), [...snapshot], false));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Close an open string and any open containers on `stack`, trimming a dangling comma/key. */
function closeStructure(prefix: string, stack: string[], inString: boolean): string {
  let out = prefix;
  if (inString) out += '"';
  out = out.replace(/\s+$/, "");
  // Drop a trailing comma, or a dangling `"key":` with no value yet.
  out = out.replace(/,\s*$/, "");
  out = out.replace(/"(?:[^"\\]|\\.)*"\s*:\s*$/, "");
  out = out.replace(/,\s*$/, "");
  for (let i = stack.length - 1; i >= 0; i--) {
    out += stack[i] === "{" ? "}" : "]";
  }
  return out;
}

/**
 * Parse LLM output as JSON, tolerating fences, surrounding prose, raw control
 * characters, and truncation. Throws {@link LenientJsonError} only when every
 * strategy fails.
 */
export function parseLenientJson<T = unknown>(raw: string): LenientJsonResult<T> {
  const cleaned = stripCodeFences(raw ?? "");

  // 1) Direct.
  try {
    return { value: JSON.parse(cleaned) as T, strategy: "direct", repaired: false };
  } catch {
    // fall through
  }

  // 2) Outermost balanced block (drops surrounding prose).
  const balanced = extractBalancedJson(cleaned);
  if (balanced) {
    try {
      return { value: JSON.parse(balanced) as T, strategy: "balanced", repaired: false };
    } catch {
      // fall through
    }
  }

  // 3) Escape raw control chars inside strings, then retry direct + balanced.
  const sanitized = sanitizeControlChars(cleaned);
  if (sanitized !== cleaned) {
    try {
      return { value: JSON.parse(sanitized) as T, strategy: "sanitized", repaired: false };
    } catch {
      const sanitizedBalanced = extractBalancedJson(sanitized);
      if (sanitizedBalanced) {
        try {
          return { value: JSON.parse(sanitizedBalanced) as T, strategy: "sanitized", repaired: false };
        } catch {
          // fall through
        }
      }
    }
  }

  // 4) Structural repair of a truncated payload (also run on the sanitized text,
  //    since truncation and dirty control chars often co-occur).
  for (const source of [cleaned, sanitized]) {
    const repaired = repairTruncatedJson(source);
    if (repaired) {
      try {
        return { value: JSON.parse(repaired) as T, strategy: "repaired", repaired: true };
      } catch {
        // fall through
      }
    }
  }

  throw new LenientJsonError(
    "Could not parse or repair the AI response as JSON.",
    cleaned.slice(0, 500),
  );
}
