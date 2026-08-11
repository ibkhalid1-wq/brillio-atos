/**
 * Regenerate public/prototype-design-system.html from the Meridian module, so the
 * reference page can never drift from the codified system. Run:
 *   npx esbuild supabase/functions/_shared/prototypeDesignSystem.ts --format=esm > .tmp-ds.mjs
 *   node scripts/build-ds-demo.mjs
 */
import { writeFileSync } from "node:fs";
import { meridianStylesheet } from "../.tmp-ds.mjs";

const css = meridianStylesheet();

const body = `
<div class="m-app">
  <aside class="m-side">
    <div class="m-brand"><span class="m-brand-dot"></span>Northwind Ops</div>
    <nav class="m-nav">
      <div class="m-nav-sec">Workspace</div>
      <div class="m-nav-item is-active">Opportunities<span class="m-nav-count">128</span></div>
      <div class="m-nav-item">Accounts<span class="m-nav-count">64</span></div>
      <div class="m-nav-item">Contacts<span class="m-nav-count">311</span></div>
      <div class="m-nav-item">Pipeline</div>
      <div class="m-nav-sec">Review</div>
      <div class="m-nav-item">Escalations<span class="m-nav-count">3</span></div>
      <div class="m-nav-item">Forecast</div>
      <div class="m-nav-item">Settings</div>
    </nav>
  </aside>
  <main class="m-main">
    <div class="m-crumbs"><a href="#">Opportunities</a> / <span>Acme renewal</span></div>
    <header class="m-page-h">
      <div>
        <div class="m-eyebrow">Opportunity</div>
        <h1 class="m-title">Acme Corp — Platform renewal</h1>
        <p class="m-sub">Q3 renewal with expansion into two new business units. Owner review due before the forecast lock.</p>
      </div>
      <div style="display:flex;gap:10px">
        <button class="m-btn m-btn--secondary">Export</button>
        <button class="m-btn m-btn--primary">New activity</button>
      </div>
    </header>

    <div class="m-tabs" style="margin-bottom:24px">
      <button class="m-tab is-active">Overview</button>
      <button class="m-tab">Activity<span class="m-tab-count">12</span></button>
      <button class="m-tab">Line items<span class="m-tab-count">6</span></button>
      <button class="m-tab">Documents</button>
    </div>

    <div class="m-grid m-grid--2" style="margin-bottom:24px">
      <section class="m-card">
        <div class="m-card-h"><div class="m-card-t">Details</div><span class="m-pill m-pill--warn"><span class="m-dot m-dot--warn"></span>At risk</span></div>
        <dl class="m-dl">
          <dt>Stage</dt><dd>Negotiation</dd>
          <dt>Amount</dt><dd>$248,000</dd>
          <dt>Close date</dt><dd>30 Sep 2026</dd>
          <dt>Owner</dt><dd>J. Rivera</dd>
          <dt>Account</dt><dd>Acme Corp</dd>
        </dl>
      </section>
      <section class="m-card">
        <div class="m-card-h"><div class="m-card-t">Log an activity</div></div>
        <div class="m-field"><label class="m-label">Type</label>
          <select class="m-select"><option>Call</option><option>Email</option><option>Meeting</option></select></div>
        <div class="m-field"><label class="m-label">Summary <span class="m-req">*</span></label>
          <input class="m-input" placeholder="What happened?" value="Pricing pushback from procurement" /></div>
        <div class="m-field"><label class="m-label">Notes</label>
          <textarea class="m-textarea" placeholder="Detail…"></textarea>
          <span class="m-help">Visible to the account team.</span></div>
        <div class="m-form-actions"><button class="m-btn m-btn--ghost">Cancel</button><button class="m-btn m-btn--primary">Save activity</button></div>
      </section>
    </div>

    <section class="m-card" style="padding:0;overflow:hidden">
      <div class="m-card-h" style="padding:16px 18px;margin:0;border-bottom:1px solid var(--m-line)">
        <div class="m-card-t">Related opportunities</div>
        <button class="m-btn m-btn--secondary m-btn--sm">Filter</button>
      </div>
      <div class="m-table-wrap" style="border:none;border-radius:0">
        <table class="m-table">
          <thead><tr>
            <th class="m-th-sort is-desc">Name</th><th class="m-th-sort">Stage</th>
            <th class="m-th-sort">Amount</th><th>Health</th><th style="text-align:right">Actions</th>
          </tr></thead>
          <tbody>
            <tr><td><div class="m-cell-main">Acme — Platform renewal</div><div class="m-cell-sub">Renewal · J. Rivera</div></td>
              <td><span class="m-badge">Negotiation</span></td><td>$248,000</td>
              <td><span class="m-pill m-pill--warn"><span class="m-dot m-dot--warn"></span>At risk</span></td>
              <td class="m-row-actions"><button class="m-btn m-btn--secondary m-btn--sm">Open</button></td></tr>
            <tr class="is-flagged"><td><div class="m-cell-main">Acme — Data add-on</div><div class="m-cell-sub">Expansion · No account owner</div></td>
              <td><span class="m-badge">Qualify</span></td><td>$52,000</td>
              <td><span class="m-pill m-pill--risk"><span class="m-dot m-dot--risk"></span>Blocked</span></td>
              <td class="m-row-actions"><button class="m-btn m-btn--secondary m-btn--sm">Open</button></td></tr>
            <tr><td><div class="m-cell-main">Acme — Training seats</div><div class="m-cell-sub">New · K. Osei</div></td>
              <td><span class="m-badge">Proposal</span></td><td>$18,500</td>
              <td><span class="m-pill m-pill--good"><span class="m-dot m-dot--good"></span>On track</span></td>
              <td class="m-row-actions"><button class="m-btn m-btn--secondary m-btn--sm">Open</button></td></tr>
          </tbody>
        </table>
        <div class="m-pagination"><span>1–3 of 6</span><span style="display:flex;gap:8px"><button class="m-btn m-btn--secondary">Prev</button><button class="m-btn m-btn--secondary">Next</button></span></div>
      </div>
    </section>
  </main>
</div>
<div class="m-toast">Activity saved</div>
`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Meridian — prototype design system</title>
<style>
${css}
</style></head><body>
${body}
</body></html>
`;

writeFileSync(new URL("../public/prototype-design-system.html", import.meta.url), html);
console.log("wrote public/prototype-design-system.html", html.length, "bytes");
