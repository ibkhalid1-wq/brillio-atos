/**
 * The pure predicates behind the FINAL GATE source sentries (finalGateInvariants.test.ts).
 *
 * They live here, apart from the assertions that use them, for ONE reason: a source
 * sentry that is silently bypassable is worse than no sentry, and the only way to prove
 * a sentry catches its bypass is to feed it the bypass. Inline regexes inside an `it()`
 * can never be tested; these can — see sourceGuards.test.ts, which hands each predicate
 * the exact string that slipped past the previous spelling of the guard.
 *
 * TEST-ONLY module. Nothing under src/v3/lib or src/v3/components imports it, so it
 * cannot change app behaviour.
 */
import { readdirSync } from "node:fs";
import ts from "typescript";

// ── (b) which ledger modules the fabricated-owner scan covers ───────────────────────
/**
 * FROZEN CORE — the four files the branch contract forbids editing. They are excluded
 * from the fabricated-owner scan, and each exclusion is safe for the same structural
 * reason: none of them MINTS a claim, so none can stamp an owner on one.
 *
 *   types.ts       — type declarations and pure helpers. It DEFINES `Owner`; it never builds one.
 *   store.ts       — the append-only log. It records whatever ownerWhileOpen its caller passes in.
 *   precedence.ts  — the source lattice. It compares claims; it writes none.
 *   projections.ts — read-only derivations over claims already in the log.
 *
 * The exclusion is also about the right ALARM: a fabricated owner appearing inside the
 * frozen core is a FINDING to raise, not something a scan here could let anyone fix.
 */
export const FROZEN_CORE = ["store.ts", "types.ts", "precedence.ts", "projections.ts"];

/**
 * Which files the scan reads. Takes a DIRECTORY LISTING, never a hand-kept array — the
 * previous guard listed 12 of the 20 modules by hand, so kitAgendaCache/pgStore/
 * readModel/useOperatorCommits were never scanned at all, and readModel is on the live
 * path (useProgramLedger and pgStore both import it). A module added tomorrow is covered
 * the day it lands.
 */
export const filesToScan = (entries: string[]): string[] =>
  entries.filter((f) => f.endsWith(".ts") && !FROZEN_CORE.includes(f)).sort();

export const ledgerFilesToScan = (dir: string): string[] => filesToScan(readdirSync(dir));

/**
 * Every CONSTANT role-owner in a source file. A constant owner is a role string somebody
 * typed, however it is spelled. Derived owners (`role: fn(x)`, `role: a.owner.label`) are
 * computed from the record and are deliberately not matched.
 *
 * ONE LEVEL OF CONST INDIRECTION IS RESOLVED, because the previous spelling —
 * `/role:\s*"([^"]+)"/` — was defeated by it completely. Planted on the LIVE path
 * (useProgramLedger.ts):
 *
 *     const FALLBACK_ROLE = "Sales Ops";
 *     const PLANTED_OWNER = { kind: "role", role: FALLBACK_ROLE };
 *
 * the whole (b) invariant stayed GREEN — finalGateInvariants 13/13, sourceGuards 19/19,
 * and validate-pipeline printed PASS F4, F5 and F6. The identical hole swallowed
 * `'Sales Ops'` (single quotes), `` `Sales Ops` `` (template) and the object shorthand
 * `{ kind: "role", role }`. That is the exact defect 0a023c9 fixed in adapters.ts, and
 * this file's own thesis — a sentry is only proven by feeding it its bypass — had never
 * been applied to THIS predicate: it was tested only against the inline double-quoted
 * literals it already matched. See sourceGuards.test.ts "H6".
 *
 * An identifier is reported ONLY when the same file binds it to a string literal, so
 * `role: someComputedLabel` stays unmatched: what is reported is a typed constant, never
 * a name. Chains deeper than one hop (const → const → role) remain invisible; a real
 * binding resolver is an AST job (H2), recorded as outstanding rather than faked here.
 */
const QUOTED = "[\"'`]([^\"'`]+)[\"'`]";

const constStringValue = (source: string, name: string): string | null => {
  const m = new RegExp(`(?:const|let|var)\\s+${name}\\s*(?::[^=\\n]+)?=\\s*${QUOTED}`).exec(source);
  return m ? m[1] : null;
};

/**
 * AST PASS — the real binding resolver the note above records as outstanding (H2).
 *
 * The regex pass is bounded to ONE const hop and is defeated by five ordinary spellings,
 * each of which walks the 0a023c9 defect back in with the whole harness green: a second
 * hop (`const A = "X"; const B = A; role: B`), an `as` cast (`role: NAME as string`), a
 * trailing comment (`role: NAME // why`), a member or index lookup into a local table
 * (`role: OWNERS.sales`, `role: OWNERS["sales"]`), and an identifier imported from
 * another module.
 *
 * Parsing also removes a false POSITIVE, in the opposite direction: comments are trivia,
 * never nodes, so a comment QUOTING `role: "Sales Ops"` — which is exactly how this
 * codebase documents its own fixes — cannot trip the scan. (The regex pass is fed
 * `codeOnly(source)` for the same reason; that is why invariant (b) needs no wrap at its
 * call site.)
 *
 * What is deliberately NOT resolved stays unreported, because a guard that fires on every
 * honest derivation gets switched off: a call (`role: fn(x)`), or an identifier with no
 * constant string behind it, is computed from the record and is not a fabrication.
 */
const unwrap = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)
    ? unwrap(e.expression) : e;

/** Every `const|let|var NAME = <expr>` in the file, by name. */
const bindingsOf = (file: ts.SourceFile): Map<string, ts.Expression> => {
  const binds = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
        && !binds.has(node.name.text)) binds.set(node.name.text, node.initializer);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return binds;
};

/** Local name → module specifier, for `import { X } from "…"` and `import X from "…"`. */
const importsOf = (file: ts.SourceFile): Map<string, string> => {
  const out = new Map<string, string>();
  for (const st of file.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    if (st.importClause?.name) out.set(st.importClause.name.text, spec);
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const el of named.elements) out.set(el.name.text, spec);
  }
  return out;
};

/**
 * How to read another module's source, so a cross-module constant can be followed.
 *
 * `ownerShapeOnly` narrows the scan to the OWNER discriminant — a `role` sitting in an
 * object that also says `kind: "role"`. It exists because "role" is an overloaded word:
 * on the Deno mirror, `{ role: "user" }` and `{ role: "system" }` are LLM chat-message
 * roles in a wire payload (claudeClient.ts, extractText.ts, types.ts), nothing to do with
 * who owns a question. Scanning those modules on the bare key reports four owners that do
 * not exist, and a guard that cries wolf is a guard someone deletes. Keyed on `kind`, the
 * same modules are silent while a real `{ kind: "role", role: "Sales Leaders" }` is still
 * caught. The loose regex pass is skipped under this flag, because it cannot see the
 * sibling property that carries the discriminant.
 */
export interface RoleOwnerScanOpts {
  readModule?: (spec: string) => string | null;
  ownerShapeOnly?: boolean;
}

/** Does the object literal holding this property also carry `kind: "role"`? */
const inOwnerShape = (node: ts.Node): boolean => {
  const obj = node.parent;
  if (!obj || !ts.isObjectLiteralExpression(obj)) return false;
  return obj.properties.some((p) =>
    ts.isPropertyAssignment(p)
    && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === "kind"
    && (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer))
    && p.initializer.text === "role");
};

/** Resolve an expression to a constant string, or null if it is derived / unknowable. */
const constStringOf = (
  expr: ts.Expression, binds: Map<string, ts.Expression>, file: ts.SourceFile,
  opts: RoleOwnerScanOpts, seen: Set<string>,
): string | null => {
  const e = unwrap(expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isIdentifier(e)) {
    if (seen.has(e.text)) return null;                       // cycle: `const a = b; const b = a;`
    seen.add(e.text);
    const local = binds.get(e.text);
    if (local) return constStringOf(local, binds, file, opts, seen);
    const spec = importsOf(file).get(e.text);                // not bound here — follow the import
    const text = spec && opts.readModule ? opts.readModule(spec) : null;
    if (text == null) return null;
    const mod = ts.createSourceFile("m.ts", text, ts.ScriptTarget.Latest, true);
    const bound = bindingsOf(mod).get(e.text);
    return bound ? constStringOf(bound, bindingsOf(mod), mod, opts, seen) : null;
  }
  // `OWNERS.sales` / `OWNERS["sales"]` — a lookup into a constant table in this file.
  if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
    const objExpr = unwrap(e.expression);
    if (!ts.isIdentifier(objExpr)) return null;
    const obj = binds.get(objExpr.text);
    if (!obj) return null;
    const lit = unwrap(obj);
    if (!ts.isObjectLiteralExpression(lit)) return null;
    const key = ts.isPropertyAccessExpression(e) ? e.name.text
      : (ts.isStringLiteral(e.argumentExpression) ? e.argumentExpression.text : null);
    if (key == null) return null;
    for (const p of lit.properties) {
      if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
          && p.name.text === key) return constStringOf(p.initializer, binds, file, opts, seen);
    }
  }
  return null;                                               // calls and anything else: derived
};

const astRoleOwners = (source: string, opts: RoleOwnerScanOpts): string[] => {
  const file = ts.createSourceFile("s.ts", source, ts.ScriptTarget.Latest, true);
  const binds = bindingsOf(file);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    const shapeOk = (n: ts.Node): boolean => !opts.ownerShapeOnly || inOwnerShape(n);
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
        && node.name.text === "role" && shapeOk(node)) {
      const v = constStringOf(node.initializer, binds, file, opts, new Set());
      if (v !== null) out.push(v);
    }
    // `{ kind: "role", role }` — shorthand resolves the binding of that same name.
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === "role" && shapeOk(node)) {
      const v = constStringOf(node.name, binds, file, opts, new Set());
      if (v !== null) out.push(v);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return out;
};

/**
 * UNION OF THE TWO PASSES, deduped — each covers the other's blind spot.
 *
 * The AST pass cannot read a bare FRAGMENT: `role:"Finance"` at statement position is a
 * labelled statement, not a property, and `{ kind: "role", role: "X" }` is a block. Those
 * are the shapes this predicate is exercised with, and they are real — a planted line,
 * quoted into a test, looks exactly like that. The regex pass reads them. The regex pass
 * in turn cannot follow a binding past one hop. So: union, which is the fail-safe
 * direction — a guard may over-report and be argued with; under-reporting is silent.
 * Deduped, because both passes see the ordinary inline literal.
 */
/**
 * The parties of a literal JOINT owner — the shape this scan was blind to.
 *
 * FOUND IN VALIDATION PASS 2, and it is a defect the fix window itself opened.
 * `Owner` gained a joint arm (`{ kind: "joint"; parties: string[] }`, plus the
 * `jointOwner([...])` constructor) when N-party seams were authorised. Every
 * fabrication gate in this repo, though, matches on `role: "…"` — so from that
 * change onward a constant owner could be written
 *
 *     const O: Owner = jointOwner(["Chief of Surgery"]);
 *
 * and the scan returned []. That is the EXACT bug the gates exist to prevent
 * (the Chief-of-Surgery fabrication), wearing the one costume they never learned
 * to recognise. The sentry had silently narrowed while the type widened.
 *
 * Both spellings are read: the object literal and the constructor call. Only
 * string LITERALS are reported — `jointOwner(fns)` is a derivation, not a
 * constant, and must not be flagged.
 */
const literalJointParties = (source: string): string[] => {
  const code = codeOnly(source);
  const out: string[] = [];
  const strings = (list: string) => {
    for (const m of list.matchAll(/["'`]([^"'`]+)["'`]/g)) out.push(m[1]);
  };
  // { kind: "joint", parties: ["A", "B"] } — property order independent.
  for (const m of code.matchAll(/kind:\s*["'`]joint["'`][^}]*?parties:\s*\[([^\]]*)\]/g)) strings(m[1]);
  for (const m of code.matchAll(/parties:\s*\[([^\]]*)\][^}]*?kind:\s*["'`]joint["'`]/g)) strings(m[1]);
  // jointOwner(["A", "B"]) — the constructor, literal argument only.
  for (const m of code.matchAll(/jointOwner\(\s*\[([^\]]*)\]/g)) strings(m[1]);
  return out;
};

export const literalRoleOwners = (source: string, opts: RoleOwnerScanOpts = {}): string[] => {
  const out: string[] = [...astRoleOwners(source, opts), ...literalJointParties(source)];
  // The regex pass cannot see the sibling `kind` that carries the Owner discriminant, so
  // it is skipped when the caller asked for owner-shaped matches only.
  if (opts.ownerShapeOnly) return [...new Set(out)];
  const code = codeOnly(source);   // comments explain the guard; they must not trip it
  // `role: "X"` / `role: 'X'` / role: `X` — the typed literal, any quote.
  for (const m of code.matchAll(new RegExp(`role:\\s*${QUOTED}`, "g"))) out.push(m[1]);
  // `role: NAME` — one const hop. The lookahead stops at `,` `}` or end-of-line, so
  // `role: fn(x)` and `role: a.owner.label` (a `(` or `.` follows) are never candidates.
  for (const m of code.matchAll(/role:\s*([A-Za-z_$][\w$]*)\s*(?=[,}\r\n])/g)) {
    const v = constStringValue(code, m[1]);
    if (v !== null) out.push(v);
  }
  // `{ kind: "role", role }` — object shorthand, same one hop.
  for (const m of code.matchAll(/[{,]\s*(role)\s*(?=[,}])/g)) {
    const v = constStringValue(code, m[1]);
    if (v !== null) out.push(v);
  }
  return [...new Set(out)];
};

/**
 * Is a constant owner literal INERT — i.e. can it only ever land on a claim that is
 * already weak or closed, where ownerWhileOpen routes no work to anybody?
 *
 * This is the condition the migrate.ts pin has always applied to `ownerFor("sales")`,
 * expressed for the const-binding shape dictionary.ts uses. The exemption used to be
 * granted on the STRING ALONE, unconditionally, so dictionary.ts could have started
 * stamping "System Owner" on an OPEN claim and the scan would have stayed green.
 *
 * Inert requires all of:
 *   1. the literal is bound to a named `const … : Owner` (not sprayed inline),
 *   2. it is actually spent somewhere (a vacuous exemption proves nothing),
 *   3. EVERY `ownerWhileOpen: <binding>` site also carries `status: "weak" | "closed"`,
 *   4. the binding is referenced nowhere else — declaration + those sites and no other,
 *      so there is no second path that could reach an open claim.
 *
 * (3) is line-scoped, exactly like the migrate pin. Reformatting the assert across
 * several lines turns this red rather than green: the fail-safe direction.
 */
export const constOwnerIsInert = (source: string, role: string): boolean => {
  // Any quote style, matching literalRoleOwners: a single-quoted band must be judged on
  // the same terms as a double-quoted one, not silently fail the exemption and go red.
  const decl = new RegExp(`const\\s+(\\w+)\\s*:\\s*Owner\\s*=\\s*\\{[^}]*role:\\s*["'\`]${escapeRe(role)}["'\`][^}]*\\}`).exec(source);
  if (!decl) return false;                                   // (1) inline literal, or no binding
  const name = decl[1];
  const uses = source.split("\n").filter((l) => l.includes(`ownerWhileOpen: ${name}`));
  if (uses.length === 0) return false;                       // (2)
  if (!uses.every((l) => /status:\s*"(weak|closed)"/.test(l))) return false;  // (3)
  const refs = source.match(new RegExp(`\\b${name}\\b`, "g")) ?? [];
  return refs.length === 1 + uses.length;                    // (4) declaration + use sites, nothing else
};

// ── (c) how a component reaches a count ────────────────────────────────────────────
/**
 * Does `source` import from module `spec` at all?
 *
 * The old guard for "FlowShell must not re-acquire its own copy of the operator-queue
 * count" was `not.toContain("operatorQueueCount(")`, which does NOT match the EXPORTED
 * plural `operatorQueueCounts(` — the one spelling a developer would actually reach for.
 * Naming the count is the wrong thing to forbid anyway; naming the MODULE is the real
 * rule. FlowShell may reach the ledger half only through flowInbox, so a new term in
 * the badge reaches the Inbox's empty state for free.
 */
const escapeRe = (s: string): string => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

/**
 * The source with its COMMENTS removed.
 *
 * A guard that forbids a code pattern must not be tripped by the comment that explains
 * why the pattern is forbidden — and in this codebase the fix and its rationale live
 * side by side, so that collision is the normal case, not a corner one. (Concretely:
 * the D1 guard forbids `onRecordApproval ?` as a render gate, and the comment above the
 * now-required prop quotes that exact gate to say why it is gone.) Without this the
 * author's only ways out are to weaken the guard or to stop writing the reason down.
 */
export const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

export const importsModule = (source: string, spec: string): boolean =>
  new RegExp(`from\\s+["']${escapeRe(spec)}["']`).test(source);

/**
 * The EXPORTED symbol that holds a given source offset, or null if nothing exported does.
 *
 * Used by captureControlsReachable to answer "is this control actually reachable, or is it
 * rendered inside a local nobody calls?" — the ed82514 defect, where a control was orphaned
 * and the guard stayed green.
 *
 * The previous spelling was a column-zero regex bound to `function|const|class`:
 *
 *     /^(export\s+)?(default\s+)?(?:async\s+)?(?:function|const|class)\s+(\w+)/gm
 *
 * It fails OPEN in two ordinary shapes. A local host declared `let CaptureDialog = …` is
 * not in the alternation, so it never CLOSES the exported declaration above it and the
 * site is still credited to that export. A local host that is INDENTED is not at column
 * zero, with the same result. Either way the control is orphaned and the guard passes.
 *
 * The recorded interim — add `let|var`, relax `^` to `^[ \t]*` — cannot be taken: relaxing
 * the anchor makes every ordinary indented `const` inside an exported component close its
 * own export, so live render sites resolve to null and the guard goes red on correct code.
 * The distinction the regex cannot draw is structural, so this walks the tree instead:
 * find the TOP-LEVEL statement containing the offset (the one whose parent is the file)
 * and ask whether that statement is exported. JSX inside a non-exported top-level local
 * answers null; JSX nested any number of functions deep inside an exported one answers
 * that export, because it genuinely is reachable through it.
 */
export const enclosingExport = (
  src: string, offset: number,
): { name: string; isDefault: boolean } | null => {
  const file = ts.createSourceFile("s.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const st of file.statements) {
    if (offset < st.getStart(file) || offset >= st.getEnd()) continue;
    const mods = ts.canHaveModifiers(st) ? (ts.getModifiers(st) ?? []) : [];
    const isExport = mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExport) return null;                       // a local host — the fail-safe answer
    const isDefault = mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) {
      return { name: st.name.text, isDefault };
    }
    if (ts.isVariableStatement(st)) {
      const d = st.declarationList.declarations[0];
      if (d && ts.isIdentifier(d.name)) return { name: d.name.text, isDefault };
    }
    // `export default <expr>` — anonymous, but still an export
    if (ts.isExportAssignment(st)) return { name: "default", isDefault: true };
    return null;
  }
  return null;
};
