# Prototype polish — assessment and build brief, 2026-08-16

The bar is a product a client would believe was built for them. Assessed against
the design system's own reference page (`public/prototype-design-system.html`),
which is what the system says it looks like, and against the generated build on
Laila New 2, which is what it actually ships.

The components are not the problem. Cards, pills, tables, boards, empty states,
tone-coded status — all present, all correct. The gap is in **composition and
typographic craft**: the assembler never adopted the reference page's own page
layout, and six details that separate a designed data product from a competent
one were never applied.

---

## What is actually wrong

**1 · Numeric columns do not line up.** Money, quantities and percentages get
`tabular-nums` — the intent was there — but the cells are left-aligned, so the
digits are ragged and two amounts cannot be compared by eye. This is the most
recognisable tell in a data table, and it is one CSS class.

**2 · The detail screen is a single column of full-width cards.** A record with
six short fields renders a ~1,100px card holding two columns of text and half a
page of nothing, and every relation stacks beneath it at full width. A record
with four relations is a three-screen scroll with no hierarchy between *this
record* and *what hangs off it*. The reference page composes exactly this screen
as two columns — and the assembler emits one.

**3 · The record's facts read as two columns of stacked pairs.** They already use
a definition list — `.m-dl` is there and correct — but each label/value pair is
boxed in a wrapper, so the grid lays out two columns of *label above value*
rather than rows of *label beside value*. The reference page does the latter, and
it scans in one vertical pass instead of four diagonal ones. Dropping the wrapper
is the whole change; the grid already declares `auto 1fr`.

*(Assessed wrongly at first as uppercase form labels on a reading screen — the
detail does not do that. Checked against the rendered markup before writing the
fix, which is the only reason this line is right.)*

**4 · Every row carries a filled button.** Five identical `Open` controls stacked
down the right of a table is noise; the row's own name is the affordance in every
product this is measured against. The control should recede until the row is
under the cursor, and the name should carry the link.

**5 · There is no type step between the page title and body.** 32px title, then
15px card titles — barely distinct from 14px body. A page needs a third level to
group by.

**6 · The typeface never arrives.** The stack names `"Inter", "Outfit"` and the
document ships neither and cannot fetch them — it is self-contained by design.
So every prototype renders in whatever the operating system defaults to, and the
one decision that carries more perceived quality than any other is left to
chance. Own it: name the best UI face on each platform explicitly, in order, and
keep Inter first for the machines that have it.

---

## Where the bytes come from

The document that sets the ceiling was 24 bytes under `DOCUMENT_REFINE_BUDGET`,
so none of this could be added without paying for it.

**8,109 bytes of developer comments were shipping inside every prototype** —
3,417 in the stylesheet, 4,692 in the client renderer. They go to the stakeholder
who opens the file, and again into the model's context on every document-mode
refine, where they compete for room with the application itself.

The stylesheet's share is now stripped at emit and kept in the source, which is
where a developer reads it. That is the budget this work is spent from: 3,456
bytes freed, and the polish costs less than that.

**7 · A design-system upgrade could never reach a client.** Found by looking
rather than by testing: all of the above landed, the suite went green, and the
live preview was byte-identical. A prior build's stylesheet is re-adopted as
"the skin the operator approved" whenever it differs from stock — and that test
cannot tell a deliberate restyle from a sheet that is merely old. Every sheet is
stamped with the system that emitted it now, and a skin from an earlier one is
refused rather than held onto.

---

## The build brief

Deterministic. Every item below is assembled, not asked for — a model is not
required to remember any of it, and cannot forget it.

1. **Right-align every numeric column, head and body.** Money, quantity and
   percent roles only. The role is already derived; the alignment follows it.
2. **Compose the detail screen as two columns above 1,040px.** The record's own
   facts and its actions in a rail; its relations in the main column. Below that
   width it stacks, unchanged. No fabric id moves — the same regions, in the same
   order, inside one wrapper.
3. **Lay the definition list out as rows.** Label beside value, not above it —
   drop the per-pair wrapper and let the existing `auto 1fr` grid do what it
   already declares.
4. **Move the drill-down INTO the row.** The record's own name is the control —
   a real `<button>`, so it stays keyboard-reachable and announced — and the
   Actions column goes entirely. A chevron appears on hover and focus so the
   affordance is discoverable without being permanent furniture.
5. **Add the missing type step** — a section size between the page title and body,
   used by card titles.
6. **Name the platform's UI face first** in the font stack, Inter ahead of it for
   the machines that have it. No download, no request, no byte cost.

### What this brief deliberately does not do

- **No tabs on the detail screen.** The reference page has them, and they would
  hide relations behind a click a stakeholder has to discover. Depth is served by
  the rail, not by concealment.
- **No embedded webfont.** A subset of Inter is ~20–40KB base64, which would push
  every build out of document-refine mode. The typeface is worth a lot; it is not
  worth the model losing the ability to see the whole application.
- **No new colour.** The palette is a client input and already earns its keep;
  more colour is not more premium.
