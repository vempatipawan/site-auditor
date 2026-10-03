// 91-digest: the ONE file the model reads. Everything the scripts measured, compressed to a few hundred lines.
// Bulk data stays in data/. If a line here says needs_model, that is the model's cue to look closer.
const fs = require("fs");
const path = require("path");
const U = require("../lib/util");
const F = require("./90-findings");

const LINE = 230, PER_MODULE = 16;
const inline = (v) => { if (v == null) return "-"; if (typeof v !== "object") return String(v); if (Array.isArray(v)) { const items = v.slice(0, 6).map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))); return (items.join(" | ") || "none") + (v.length > 6 ? ` | (+${v.length - 6} more)` : ""); } return JSON.stringify(v); };
const clip = (s) => (s.length > LINE ? s.slice(0, LINE - 1) + "…" : s);
function block(summary, skip = []) { const lines = []; for (const [k, v] of Object.entries(summary)) { if (["status", "ms", "needs_model", "note", "profile", "scope", "source", "how_to_use", "advice"].includes(k) || skip.includes(k)) continue; if (v == null || v === false || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)) continue; lines.push(clip(`- ${k}: ${inline(v)}`)); if (lines.length >= PER_MODULE) { lines.push("- (more in summaries/ file)"); break; } } return lines; }

module.exports = {
  id: "91-digest", name: "Build DIGEST.md", tiers: ["bid", "full"],
  async run(ctx) {
    const site = ctx.site, fj = ctx.read("findings.json", { findings: [], good: [], scorecard: [] }), mods = fs.readdirSync(ctx.sumDir).filter((f) => f.endsWith(".json")).sort().map((f) => [f.replace(".json", ""), ctx.read("summaries/" + f)]);
    const L = [], P = (...a) => L.push(...a), brief = ctx.read("brief.json");
    P(`# AUDIT DIGEST: ${site.host}`, "", `Audited ${site.audited_at.slice(0, 10)} · tier ${ctx.opts.tier || "full"} · platform ${site.fingerprint.platform}${site.fingerprint.shop ? " + shop" : ""} · ${site.urls_audited} of ${site.total_urls_found} URLs · theme ${site.fingerprint.themes[0] || "-"} · builders ${site.fingerprint.builders.join(", ") || "-"}`, "");
    P("> This is the only file to read. Raw data is in data/, per-module detail in summaries/. Lab numbers are lab numbers; CrUX is real visitors. Timings come from one location unless the line says otherwise.", "");
    if (brief) P("## The brief (from the job post)", ...Object.entries(brief).map(([k, v]) => clip(`- ${k}: ${inline(v)}`)), "");

    P("## Module run status", "| module | status | time | note |", "|---|---|---|---|", ...mods.map(([id, s]) => `| ${id} | ${s.status || "ok"} | ${s.ms != null ? Math.round(s.ms / 1000) + "s" : "-"} | ${s.reason || ""} |`), "");

    P(`## Drafted findings (${fj.findings.length}) — edit, merge, re-rank; do not rewrite what is already right`, "| id | sev | effort | qw | title | evidence |", "|---|---|---|---|---|---|", ...fj.findings.map((f) => `| ${f.id} | ${f.severity} | ${f.effort} | ${f.quick_win ? "yes" : ""} | ${f.title.replace(/\|/g, "/")} | ${clip(String(f.evidence_value).replace(/\|/g, "/")).slice(0, 170)} |`), "");
    P("## Working well (scorecard \"Good\" lines)", ...(fj.good.length ? fj.good.map((g) => `- ${g.title}: ${g.value}`) : ["- none detected automatically; look for some, the report needs them"]), "");

    P("## Module detail (only what the findings table does not already say)");
    const skipKeys = { "11-analyze": ["issues", "by_template", "statuses"], "30-perf": ["pages"], "00-discover": ["samples"] };
    for (const [id, s] of mods) { if (s.status === "skipped" || /^9\d/.test(id)) continue; P("", `### ${id}${s.status && s.status !== "ok" ? ` (${s.status}: ${s.reason || ""})` : ""}`); if (s.profile || s.scope || s.note || s.source) P(clip(`_${s.profile || s.scope || s.source || s.note}_`));
      if (id === "30-perf" && s.pages) for (const p of s.pages) P(clip(`- ${p.id}: phone LCP ${p.phone.lcp_ms} ms · TTFB ${p.phone.ttfb_ms} · CLS ${p.phone.cls} · TBT ${p.phone.tbt_ms} · ${p.phone.requests} req · ${p.phone.kb} KB (img ${p.phone.img_kb}, js ${p.phone.js_kb}, css ${p.phone.css_kb}, font ${p.phone.font_kb}, 3rd-party ${p.phone.third_party_kb})${p.desktop ? ` · desktop LCP ${p.desktop.lcp_ms}` : ""} · LCP el: ${p.lcp_element || "-"} · blocking files ${p.render_blocking_files}`));
      if (id === "11-analyze" && s.by_template) P(clip(`- by_template: ${Object.entries(s.by_template).map(([t, v]) => `${t} ${v.pages}p ttfb ${v.avg_ttfb_ms}ms ${v.avg_html_kb}KB ${v.avg_scripts}js ${v.avg_styles}css ${v.avg_words}w`).join(" | ")}`), clip(`- statuses: ${inline(s.statuses)}`));
      if (id === "00-discover" && s.samples) P(`- samples: ${s.samples.join(" | ")}`);
      P(...block(s, skipKeys[id] || [])); }

    const needs = []; for (const [id, s] of mods) if (s.needs_model) needs.push(...[].concat(s.needs_model).map((x) => `[${id}] ${x}`));
    const an = ctx.summary("11-analyze"); if (an && an.contact_identity && (an.contact_identity.phones.length || an.contact_identity.emails.length)) needs.push(`[identity] Confirm every phone and email on the site belongs to this business (a Said & Co footer number rang a competitor). Phones: ${an.contact_identity.phones.slice(0, 5).join(", ")} · Emails: ${an.contact_identity.emails.slice(0, 5).join(", ")}`);
    const fc = fj.findings.filter((f) => f.fact_check); if (fc.length) needs.push(`[fact-check] ${fc.map((f) => f.id).join(", ")} make claims about plugins. Verify each against the plugin's own documentation and changelog before it ships.`);
    needs.push("[vision] Open the contact sheets in sheets/. Record what scripts cannot see: hierarchy, contrast, typography, photography quality, mobile treated as an afterthought, brand drift between pages.");
    needs.push("[registry] Check the company name / number / VAT printed in the footer against the public registry for that country (WebSearch).", "[brief] Test each suspicion the client voiced against this digest. Confirm or correct each one with the number.", "[challenge] Write challenge-the-brief: what in their plan is too late, mispriced or missing; one thing NOT to change; the standard fix that would make THEIR problem worse.");
    P("", "## needs_model — the model's work list", ...needs.map((x) => clip("- " + x)), "");
    const sheets = ctx.read("data/sheets.json", []); if (sheets.length) P("## Contact sheets to look at", ...sheets.map((s) => `- ${s.file} (${s.tiles} tiles): ${s.title}`), "");
    const skipped = mods.filter(([, s]) => s.status === "skipped"); if (skipped.length) P("## Not run", ...skipped.map(([id, s]) => `- ${id}: ${s.reason}`), "");
    P("## Then", "1. Write model-findings.json (same fields as findings.json rows) for everything in needs_model.", "2. `node audit.js --out <this dir> --only 90,91,92` to merge and re-rank.", "3. Fill the {{MODEL:...}} slots in AUDIT-REPORT.md. Run the seven gates in README.md.", "4. `node audit.js --out <this dir> --only 93,94,95` for the PDF and client pack.", "");

    const text = L.join("\n"); ctx.write("DIGEST.md", text);
    const all = {}; for (const [id, s] of mods) all[id] = s; ctx.write("AUDIT-DIGEST.json", { site: { host: site.host, origin: site.origin, platform: site.fingerprint.platform, audited_at: site.audited_at }, scorecard: fj.scorecard, findings: fj.findings, good: fj.good, summaries: all });
    return { digest_lines: L.length, digest_kb: U.round(Buffer.byteLength(text) / 1024, 1), findings: fj.findings.length, needs_model_items: needs.length, file: "DIGEST.md" };
  },
};
U.standalone(module.exports, module);
