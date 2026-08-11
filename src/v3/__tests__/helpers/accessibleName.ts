/**
 * A small, honest accessible-name computation for the a11y tests.
 *
 * There is no axe-core / testing-library in this repo, and pulling one in for this
 * would put the assertion behind a dependency nobody here can read. So this walks the
 * parts of accname 1.2 that the flow surfaces actually exercise, in the spec's order:
 *
 *   2A  hidden nodes contribute nothing            (aria-hidden, hidden, display:none)
 *   2B  aria-labelledby (one level, no recursion into another labelledby)
 *   2C  aria-label
 *   2D  the host-language label   — <label for>, an ancestor <label>, <legend>
 *   2F  name from content         — for roles that allow it (button, link, option…)
 *   2I  the tooltip               — title, and for form fields the placeholder
 *
 * What it deliberately does NOT do: CSS ::before/::after content (jsdom does not
 * expose it), and aria-labelledby chains deeper than one hop (nothing here uses them).
 * Both would make the result LOOK better than the DOM is, which is the wrong direction
 * for an audit to be wrong in.
 */

/** Roles whose name may come from their own text content (accname step 2F). */
const NAME_FROM_CONTENT = new Set([
  "button", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio",
  "checkbox", "tab", "treeitem", "cell", "columnheader", "rowheader", "gridcell", "heading",
]);

const TAG_ROLE: Record<string, string> = {
  BUTTON: "button", SUMMARY: "button", A: "link", OPTION: "option",
  INPUT: "textbox", SELECT: "combobox", TEXTAREA: "textbox",
};

export const roleOf = (el: Element): string => {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit.trim().split(/\s+/)[0];
  if (el.tagName === "INPUT") {
    const t = (el as HTMLInputElement).type;
    if (t === "button" || t === "submit" || t === "reset") return "button";
    if (t === "checkbox") return "checkbox";
    if (t === "radio") return "radio";
    return "textbox";
  }
  if (el.tagName === "A") return el.hasAttribute("href") ? "link" : "generic";
  return TAG_ROLE[el.tagName] ?? "generic";
};

const isHidden = (el: Element): boolean => {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.getAttribute("aria-hidden") === "true") return true;
    if (n.hasAttribute("hidden")) return true;
    const style = (n as HTMLElement).style;
    if (style && (style.display === "none" || style.visibility === "hidden")) return true;
  }
  return false;
};

/** Text a screen reader would read from a subtree, skipping aria-hidden branches. */
const contentName = (el: Element): string => {
  let out = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) { out += node.textContent ?? ""; continue; }
    if (node.nodeType !== 1) continue;
    const child = node as Element;
    if (isHidden(child)) continue;
    // A nested labelled element contributes its own name (e.g. an <img alt>).
    const own = child.getAttribute("aria-label");
    out += own?.trim() ? ` ${own} ` : contentName(child);
  }
  return out;
};

const labelFor = (el: Element): string => {
  const doc = el.ownerDocument;
  const id = el.getAttribute("id");
  if (id) {
    // getElementById is used rather than a selector so ids containing spaces or
    // colons (this app mints a few) still resolve the way a browser resolves them.
    for (const l of Array.from(doc.querySelectorAll("label[for]"))) {
      if (l.getAttribute("for") === id) return contentName(l);
    }
  }
  const wrapping = el.closest("label");
  if (wrapping) return contentName(wrapping);
  return "";
};

export const accessibleName = (el: Element): string => {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();

  // 2B — aria-labelledby
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const doc = el.ownerDocument;
    const parts = by.split(/\s+/).map((id) => {
      const t = doc.getElementById(id);
      return t ? (t.getAttribute("aria-label") ?? contentName(t)) : "";
    });
    const joined = clean(parts.join(" "));
    if (joined) return joined;
  }
  // 2C — aria-label
  const aria = el.getAttribute("aria-label");
  if (aria && clean(aria)) return clean(aria);

  // 2D — host-language label
  const native = clean(labelFor(el));
  if (native) return native;

  // 2F — name from content, when the role allows it
  const role = roleOf(el);
  if (NAME_FROM_CONTENT.has(role)) {
    const fromContent = clean(contentName(el));
    if (fromContent) return fromContent;
  }
  // <input type=button|submit> takes its value
  if (el.tagName === "INPUT" && ["button", "submit", "reset"].includes((el as HTMLInputElement).type)) {
    const v = clean((el as HTMLInputElement).value);
    if (v) return v;
  }
  // 2I — tooltip, then (form fields only) the placeholder
  const title = clean(el.getAttribute("title") ?? "");
  if (title) return title;
  const placeholder = clean(el.getAttribute("placeholder") ?? "");
  if (placeholder) return placeholder;
  return "";
};

/**
 * Is this element something a keyboard/AT user will land on and try to operate?
 * `tabindex="-1"` is excluded: it is programmatically focusable but not in the tab
 * order, which is the correct way to park a control that a button proxies for.
 */
export const isInteractive = (el: Element): boolean => {
  if (isHidden(el)) return false;
  if ((el as HTMLElement & { disabled?: boolean }).disabled) return false;
  const tabindex = el.getAttribute("tabindex");
  if (tabindex != null && Number(tabindex) < 0) return false;
  const tag = el.tagName;
  if (tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA" || tag === "SUMMARY") return true;
  if (tag === "INPUT" && (el as HTMLInputElement).type !== "hidden") return true;
  if (tag === "A" && el.hasAttribute("href")) return true;
  const role = el.getAttribute("role");
  if (role && ["button", "link", "menuitem", "tab", "checkbox", "radio", "switch"].includes(role)) return true;
  if (tabindex != null && Number(tabindex) >= 0) return true;
  return false;
};

/**
 * A name is USELESS when it carries no word: an emoji, an arrow, a lone digit, a
 * bare "?" — the thing a screen reader turns into "black up-pointing triangle" or
 * silence. Two or more letters is the bar; "OK" clears it, "⌄" and "5" do not.
 */
export const isWordless = (name: string): boolean => (name.match(/\p{L}/gu)?.length ?? 0) < 2;

/** Every interactive element under `root`, in document order. */
export const interactiveElements = (root: ParentNode): Element[] =>
  Array.from(root.querySelectorAll("*")).filter(isInteractive);
