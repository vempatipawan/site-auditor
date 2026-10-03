// 92-report: assembles AUDIT-REPORT.md from findings.json + the module summaries, with {{MODEL:...}} slots for the
// judgment parts. In bid tier it writes BID-FINDINGS.md instead: the top findings as letter-ready lines.
// Zero model tokens: everything here is already measured and already drafted.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const U = require("../lib/util");
const T = require("../lib/thresholds");
const LANG = require("../lib/language");
const F = require("./90-findings");

const SEVS = ["Critical", "High", "Medium", "Low"];
const EFFORT_TEXT = { Low: "Low: minutes to hours, usually a settings change", Med: "Medium: days, template or bulk work", High: "High: a project of its own" };
// Text that arrives from the site or from plugin directories can carry long dashes; the language gate bans them.
const plain = (s) => String(s).replace(/\s*[–—]\s*/g, " - ").replace(/\n+/g, " ");
const cell = (v) => plain(v == null ? "-" : v).replace(/\|/g, "/");
const esc = (s) => plain(s == null ? "" : s).replace(/</g, "&lt;");
const stop = (s) => (/[.!?]$/.test(s.trim()) ? s.trim() : s.trim() + ".");
const clip = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + " ..." : s; };
const sec = (ms) => (ms == null ? "-" : (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + " s");
const firstSentence = (s) => { const m = String(s || "").match(/^.*?[.!?](?=\s|$)/); return m ? m[0] : String(s || ""); };
const table = (head, rows) => (rows.length ? [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n") : "");
const longDate = (iso) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const parseCsv = (text) => text.split(/\r?\n/).filter(Boolean).map((l) => { const out = []; let cur = "", q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; } out.push(cur); return out; });

// What each module would have added, in the client's language. Used for "not run" lines.
const NOT_RUN = { "35-crux": "Real-visitor speed data from Chrome users over the last 28 days, with a 25-week trend", "36-psi": "Google's own Lighthouse scoring for the key pages", "37-globalping": "First-byte timing measured from your customers' cities", "34-thirdparty": "The measured cost of each outside script, one at a time", "80-commerce": "A walk of the buyer path from product page to checkout entry", "23-wayback": "A check of old addresses from your site's history that may still hold links and rankings", "22-subdomains": "A sweep for forgotten copies of the site on other subdomains" };
const WITH_ACCESS = ["**Search Console:** which pages Google actually indexes, the queries that bring visitors, and the pages it has quietly dropped.", "**Analytics and order data:** where buyers leave the path, by device, and what each step of that is worth in money.", "**The control panel:** the real plugin list with exact versions, scheduled tasks, database size and autoloaded options, which settle every item marked as low confidence here.", "**Hosting:** server-side cache configuration, PHP version and workers, error logs, and whether the slow first byte is the server or the application.", "**A staging copy:** every fix in this report tested safely before it touches the live site."];

function build(ctx, S, fj, brief) {
  const site = ctx.site, o = ctx.opts, findings = fj.findings, mods = fs.readdirSync(ctx.sumDir).filter((f) => f.endsWith(".json")).map((f) => [f.replace(".json", ""), ctx.read("summaries/" + f)]);
  const who = U.identity(ctx), client = who.client, freelancer = who.freelancer || "{{MODEL:FREELANCER_NAME}}";
  const shop = site.fingerprint.shop, wp = site.fingerprint.platform === "wordpress", sampleUrl = Object.fromEntries((site.samples || []).map((s) => [s.id, s.url]));
  const A = {}; let n = 5;

  A.CLIENT = client; A.HOST = site.host; A.FREELANCER = freelancer; A.DATE = longDate(site.audited_at);
  A.REPORT_KIND = wp && shop ? "Website and WooCommerce Audit" : shop ? "Website and Online Store Audit" : "Website Audit";
  A.PAGES_PHRASE = S.analyze ? `${S.analyze.pages} pages from your own sitemaps` : "your key pages";
  A.JOURNEY_PHRASE = S.commerce ? ", walked the buyer path from product page to checkout entry without placing an order" : "";
  A.FIELD_DATA_PHRASE = S.crux ? "Real-visitor numbers from the Chrome UX Report are labelled as field data." : "Timings were taken from one location, so read them as relative rather than absolute.";
  A.WORKING_WELL_NOTE = fj.good.length ? `A note up front, because it matters: **parts of this site are in good shape.** ${fj.good.slice(0, 6).map((g) => `${g.title} (${g.value})`).join(". ")}. I have marked those as Good in the scorecard and left them alone.` : "";

  // 1. five that matter, pre-filled from the scored ranking
  A.FIVE_PREFILL = findings.slice(0, 5).map((f, i) => `${i + 1}. **${esc(f.title)}.** ${stop(esc(clip(f.evidence_value, 320)))} ${esc(firstSentence(f.why_it_matters))} (${f.severity})`).join("\n\n");
  const counts = SEVS.map((s) => [s, findings.filter((f) => f.severity === s).length]).filter(([, c]) => c), qw = findings.filter((f) => f.quick_win);
  A.COUNT_LINE = `This report covers **${findings.length} findings**: ${counts.map(([s, c]) => `${c} ${s}`).join(", ")}. ${qw.length ? `**${qw.length} of them are quick wins**: high impact, low effort, no redesign needed.` : ""}`;

  // 2. scorecard
  A.SCORECARD = table(["Area", "Status", "One-line takeaway"], fj.scorecard.map((r) => [r.area, r.status, r.takeaway]));

  // 3. findings by severity
  A.FINDINGS = SEVS.filter((s) => findings.some((f) => f.severity === s)).map((s) => `### ${s}\n\n` + findings.filter((f) => f.severity === s).map((f) => [
    `**${f.id}. ${esc(f.title)}** (${f.area}${f.quick_win ? ", quick win" : ""})  `,
    `*What I found:* ${stop(esc(clip(f.evidence_value, 700)))} Check it here: ${f.evidence_url}  `,
    `*Why it costs you:* ${esc(f.why_it_matters)}  `,
    `*The fix:* ${esc(f.recommended_fix)}  `,
    `*Effort:* ${EFFORT_TEXT[f.effort] || f.effort}.${f.needs_access ? " Needs access to confirm." : ""}`,
    f.fact_check ? `<!-- MODEL: fact-check ${f.id} against the plugin's own documentation and changelog, then delete this comment. -->` : null,
  ].filter(Boolean).join("\n")).join("\n\n")).join("\n\n");

  // 4. performance
  const P = [];
  if (S.perf && S.perf.pages) {
    P.push(`**Lab measurements.** ${S.perf.profile}`, "", table(["Page", "Main content (phone)", "First byte", "Layout shift", "Blocked main thread", "Requests", "Weight", "Main content (desktop)"], S.perf.pages.filter((p) => p.phone).map((p) => [sampleUrl[p.id] ? new URL(sampleUrl[p.id]).pathname : p.id, sec(p.phone.lcp_ms), sec(p.phone.ttfb_ms), p.phone.cls, `${p.phone.tbt_ms} ms`, p.phone.requests, `${(p.phone.kb / 1024).toFixed(2)} MB`, p.desktop ? sec(p.desktop.lcp_ms) : "-"])), "", `Targets: main content within ${T.LCP_GOOD_MS / 1000} s, first byte within ${T.TTFB_GOOD_MS / 1000} s, layout shift under ${T.CLS_GOOD}, page weight under ${T.PAGE_WEIGHT_KB / 1000} MB.`);
    const h = S.perf.pages[0] && S.perf.pages[0].phone; if (h) P.push("", `**Where the homepage weight goes:** images ${h.img_kb} KB, scripts ${h.js_kb} KB, styling ${h.css_kb} KB, fonts ${h.font_kb} KB, of which ${h.third_party_kb} KB comes from outside services.`);
  }
  if (S.cache && S.cache.first_byte_ms_repeat_requests) P.push("", `**Page cache test.** The same page requested ${S.cache.first_byte_ms_repeat_requests.length} times in a row waited ${S.cache.first_byte_ms_repeat_requests.join(", ")} ms for the first byte, with ${S.cache.cache_hits_seen || 0} cache hits.${S.cache.first_byte_ms_static_file ? ` A static file from the same server answered in ${[].concat(S.cache.first_byte_ms_static_file).join(", ")} ms, which is what the server can do when it does not have to build the page.` : ""}`);
  if (S.crux && S.crux.origin_phone) P.push("", `**Field data: real visitors, last 28 days (Chrome UX Report).**`, "", table(["Metric", "Phone", "Desktop"], Object.keys(typeof S.crux.origin_phone === "object" ? S.crux.origin_phone : {}).map((k) => [k, S.crux.origin_phone[k], (S.crux.origin_desktop || {})[k]])) || `Phone: ${S.crux.origin_phone}`);
  else P.push("", "**Field data.** Real-visitor numbers from the Chrome UX Report were not pulled in this pass, so everything above is lab data from a controlled phone profile.");
  if (S.psi && S.psi.pages) P.push("", "**Google Lighthouse (mobile).**", "", table(["Page", "Performance", "SEO", "Best practices", "Accessibility"], Object.entries(S.psi.pages).filter(([, v]) => v && v.scores).map(([id, v]) => [id, v.scores.performance, v.scores.seo, v.scores.best_practices, v.scores.accessibility])));
  const gp = ctx.read("data/globalping.json");
  if (S.globalping && gp && gp.rows) P.push("", `**From your customers' cities.** One request per city.${S.globalping.redirect_before_page ? " Note: " + S.globalping.redirect_before_page + "." : ""}`, "", table(["City", "Lookup", "Connect", "Secure handshake", "Server wait", "Total", "Answer"], gp.rows.filter((r) => r.total_ms != null).map((r) => [`${r.city}, ${r.country}`, `${r.dns_ms} ms`, `${r.connect_ms} ms`, `${r.tls_ms} ms`, `${r.server_wait_ms} ms`, `${r.total_ms} ms`, r.status === 200 ? "page" : `status ${r.status}`])), "", "Server wait is the time your site itself took to answer. The rest is network distance.");
  if (S.thirdparty && S.thirdparty.per_third_party) P.push("", `**What each outside script costs.** The homepage was loaded as it is, then again with one outside service blocked each time. ${S.thirdparty.profile}`, "", ...S.thirdparty.per_third_party.map((x) => `- ${x}`), "", S.thirdparty.advice);
  if (S.coverage && S.coverage.pages) P.push("", `**Code downloaded and never used.** ${S.coverage.note}`, "", table(["Page", "Styling", "Scripts"], S.coverage.pages.filter((p) => !p.error).map((p) => [sampleUrl[p.id] ? new URL(sampleUrl[p.id]).pathname : p.id, p.css, p.js])));
  if (S.benchmark && S.benchmark.mobile_cwv_pass_rate_pct != null) P.push("", `**For context:** ${S.benchmark.mobile_cwv_pass_rate_pct} percent of ${S.benchmark.platform} sites pass Google's Core Web Vitals on phones (${S.benchmark.source}, ${S.benchmark.as_of}). ${S.benchmark.how_to_use}`);
  A.PERFORMANCE = P.join("\n") || "Browser measurements were not run in this pass.";

  // buyer journey
  A.JOURNEY_SECTION = "";
  if (S.commerce) {
    const c = S.commerce, J = [`## ${n++}. The buyer journey`, "", `${c.note}`, ""];
    for (const st of c.steps || []) J.push(`- **${st.step[0].toUpperCase() + st.step.slice(1)}** (${st.where}): ${Object.entries(st).filter(([k, v]) => !["step", "where"].includes(k) && v != null && v !== false).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v === true ? "yes" : v}`).join(" · ")}`);
    if (c.price_integrity) J.push("", `**Price consistency:** ${c.price_integrity.verdict}. ${Object.entries(c.price_integrity.prices || {}).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(" · ")}`);
    if (c.checkout && c.checkout.reached) J.push("", `**Checkout:** ${c.checkout.visible_fields} visible fields, ${c.checkout.required_fields} required, ${c.checkout.screens_of_scrolling_on_phone} phone screens of scrolling. ${c.checkout.benchmark}. Guest checkout ${c.checkout.guest_checkout_possible ? "is available" : "was not offered"}${c.checkout.express_pay ? ", express payment buttons are present" : ", no express payment buttons"}${(c.checkout.payment_methods || []).length ? `, payment methods shown: ${c.checkout.payment_methods.join(", ")}` : ""}.`, "", "Field order as a customer meets it: " + (c.checkout.field_order || []).join(" · "));
    if (c.catalogue) J.push("", `**Catalogue:** ${c.catalogue.products} products checked${c.catalogue.stock_known ? `, ${c.catalogue.out_of_stock} of the ${c.catalogue.stock_known} with a stock status shown are out of stock` : ""}.`);
    if ((c.page_errors || []).length) J.push("", `**Script faults seen along the path:** ${c.page_errors.slice(0, 4).map((e) => "`" + esc(e) + "`").join(", ")}.`);
    if (c.needs_model) J.push("", `<!-- MODEL: the journey script could not finish a step: ${esc([].concat(c.needs_model).join(" / "))}. Finish it by hand, write what you saw, then delete this comment. -->`);
    A.JOURNEY_SECTION = J.join("\n") + "\n\n---\n\n";
  }

  // plugin register
  A.PLUGIN_SECTION = "";
  const regFile = path.join(ctx.packDir, "plugin-register.csv");
  if (S.wp && fs.existsSync(regFile)) {
    const rows = parseCsv(fs.readFileSync(regFile, "utf8")), head = rows.shift(), ix = (k) => head.indexOf(k), order = { "UPDATE NOW": 0, REPLACE: 1, UPDATE: 2, CHECK: 3, KEEP: 4 };
    const tally = {}; for (const r of rows) tally[r[ix("verdict")]] = (tally[r[ix("verdict")]] || 0) + 1;
    const act = rows.filter((r) => r[ix("verdict")] !== "KEEP").sort((a, b) => (order[a[ix("verdict")]] ?? 9) - (order[b[ix("verdict")]] ?? 9)).slice(0, 15);
    A.PLUGIN_SECTION = [`## ${n++}. Plugin register`, "", `WordPress ${S.wp.core ? S.wp.core.running : "version not shown"}${S.wp.core && S.wp.core.behind ? ` (current release is ${S.wp.core.latest})` : ""}${S.wp.woocommerce ? `, WooCommerce ${S.wp.woocommerce}` : ""}, theme ${S.wp.theme ? S.wp.theme.name || S.wp.theme.slug : "-"}. I could identify **${rows.length} plugins** from the outside: ${Object.entries(tally).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ")}. The full register with a verdict and a reason per plugin is \`plugin-register.csv\` in the pack.`, "", act.length ? table(["Plugin", "Running", "Latest", "Verdict", "Reason"], act.map((r) => [r[ix("name")] || r[ix("plugin")], r[ix("version_running")], r[ix("latest_version")], r[ix("verdict")], r[ix("reason")]])) : "Nothing in the register needs action.", "", "Versions read from the outside are low confidence by nature: some plugins hide them and some publish a stale number. The control panel settles each one in a minute.", "<!-- MODEL: fact-check every verdict in this table against the plugin's own page and changelog, then delete this comment. -->"].join("\n") + "\n\n---\n\n";
  }

  A.N_CHALLENGE = n++; A.N_PLAN = n++; A.N_DEEPER = n++;
  const b = []; if (brief.goal) b.push(`**What you asked for:** ${esc(brief.goal)}`); if ((brief.suspicions || []).length) b.push(`**What you suspected:** ${[].concat(brief.suspicions).map(esc).join(" · ")}`); if ((brief.deliverables || []).length) b.push(`**What you asked to receive:** ${[].concat(brief.deliverables).map(esc).join(", ")}`);
  A.BRIEF_ECHO = b.join("  \n");

  // plan
  const line = (f) => `- **${f.id}** ${esc(f.title)}`, rest = findings.filter((f) => !f.quick_win), bucket = (e) => rest.filter((f) => f.effort === e);
  const plan = []; if (qw.length) plan.push("### Quick wins: this week", "", "High impact, low effort. None of these needs a redesign or a developer sprint.", "", ...qw.map(line), "");
  for (const [label, e, note] of [["Days 0 to 30", "Low", "The remaining settings-level fixes."], ["Days 30 to 60", "Med", "Template and bulk work: done once, fixed on every page that uses the template."], ["Days 60 to 90", "High", "Project-sized work. Worth scoping on its own once the first two blocks have landed."]]) if (bucket(e).length) plan.push(`### ${label}`, "", note, "", ...bucket(e).map(line), "");
  plan.push("After each block, run the re-check script in the pack. It prints each audited number beside that day's value, so progress is a measurement and not an opinion.");
  A.PLAN = plan.join("\n");

  // deeper pass + appendix
  const skipped = mods.filter(([, s]) => s && s.status === "skipped");
  A.DEEPER = [...skipped.filter(([id]) => NOT_RUN[id]).map(([id]) => `- **Not run in this pass:** ${NOT_RUN[id]}.`), ...WITH_ACCESS.map((x) => `- ${x}`)].join("\n");
  const ran = mods.filter(([id, s]) => s && s.status !== "skipped" && s.status !== "failed" && !/^9/.test(id)).length;
  A.APPENDIX = [`- Measured on ${A.DATE}. ${ran} separate instruments ran against the public site.`, S.analyze ? `- ${S.analyze.pages} pages read from your sitemaps, at most four at a time with a pause between requests, so the audit itself put no strain on the server.` : null, S.perf ? `- Speed: ${S.perf.profile}` : null, "- All timings were taken from a single location unless a table says otherwise. Compare them with each other, not with a stopwatch.", "- Nothing was changed. No forms were submitted, no login was attempted" + (S.commerce ? ", and the only button pressed was add to cart. No order was placed and no personal data was entered." : "."), "- Files with this report: `findings.csv` (every finding, with evidence address and exact value), `pages.csv` (one row per page)" + (A.PLUGIN_SECTION ? ", `plugin-register.csv`" : "") + (fs.existsSync(path.join(ctx.packDir, "legacy-redirect-map.csv")) ? ", `legacy-redirect-map.csv`" : "") + ", the screenshots, and `recheck.mjs`.", "- `recheck.mjs` needs only Node.js. Run `node recheck.mjs` on any day: it re-reads your public pages and prints each audited number beside today's."].filter(Boolean).join("\n");
  return A;
}

function bidFindings(ctx, fj) {
  const site = ctx.site, picked = [], perArea = {};
  for (const f of fj.findings) { if (picked.length >= 10) break; if ((perArea[f.area] || 0) >= 2) continue; perArea[f.area] = (perArea[f.area] || 0) + 1; picked.push(f); }
  const lines = picked.map((f, i) => `${i + 1}. ${LANG.letterSafe(`${f.title}. ${firstSentence(f.why_it_matters)}`)}`);
  const hits = LANG.lint(lines.join("\n"), { letter: true });
  const text = [`# BID FINDINGS: ${site.host}`, "", `Internal working file. Audited ${site.audited_at.slice(0, 10)}, bid tier, ${fj.findings.length} findings drafted. Only the block below is letter-ready; everything outside it is for the thread.`, "", "## Letter-ready lines (pick 3 to 5, in the client's order of pain)", "", "```", ...lines, "```", "", hits.length ? "## Language scan: FIX BEFORE PASTING\n\n" + LANG.summarize(hits).map((x) => `- ${x}`).join("\n") : "## Language scan: passed (no dashes, no platform-filter words, no error codes, no contact details)", "", "## Evidence behind each line (verify before quoting a number)", "", table(["#", "id", "Severity", "Where to check", "Exact value"], picked.map((f, i) => [i + 1, f.id, f.severity, f.evidence_url, clip(f.evidence_value, 260)])), "", fj.good.length ? "## Working well (one honest compliment lands better than ten faults)\n\n" + fj.good.slice(0, 6).map((g) => `- ${g.title}: ${g.value}`).join("\n") : "", "", "## Rules", "- A finding in a letter is a gift, not a verdict: one line, one number, no fix unless it is the insight gift.", "- Open each evidence address yourself before quoting it. Sites change between the scan and the send.", "- Do not name plugins as faulty in a letter. Plugin claims need the fact-check gate first."].join("\n");
  ctx.write("BID-FINDINGS.md", text);
  return { file: "BID-FINDINGS.md", lines: lines.length, language_scan: hits.length ? LANG.summarize(hits) : "passed" };
}

module.exports = {
  id: "92-report", name: "Assemble the report", tiers: ["bid", "full"],
  async run(ctx) {
    const fj = ctx.read("findings.json"); if (!fj || !fj.findings) return U.skipped("run 90-findings first");
    if ((ctx.opts.tier || "full") === "bid") return bidFindings(ctx, fj);
    const S = F.loadSummaries(ctx), brief = ctx.read("brief.json") || ctx.site.brief || {}, A = build(ctx, S, fj, brief);
    let md = fs.readFileSync(path.join(U.ROOT, "templates", "report.md.tpl"), "utf8").replace(/\r\n/g, "\n").replace(/\{\{AUTO:([A-Z_]+)\}\}/g, (m, k) => (A[k] != null ? String(A[k]) : m));
    if (!A.BRIEF_ECHO) md = md.replace(/\n\n\n+/g, "\n\n");
    // never overwrite a report the model has already edited: the fresh build goes beside it
    const target = path.join(ctx.outDir, "AUDIT-REPORT.md"), hashFile = path.join(ctx.dataDir, "report.sha1"), sha = (s) => crypto.createHash("sha1").update(s).digest("hex");
    const edited = fs.existsSync(target) && (!fs.existsSync(hashFile) || sha(fs.readFileSync(target, "utf8")) !== fs.readFileSync(hashFile, "utf8").trim()) && !ctx.opts.force;
    const file = edited ? "AUDIT-REPORT.new.md" : "AUDIT-REPORT.md"; ctx.write(file, md); if (!edited) fs.writeFileSync(hashFile, sha(md));
    const hits = LANG.lint(md).filter((h) => h.rule !== "model-slot");
    return { file, kept_edited_report: edited ? "AUDIT-REPORT.md has been edited since it was generated, so it was left alone. Merge from AUDIT-REPORT.new.md, or re-run with --force to replace it." : undefined, lines: md.split("\n").length, findings: fj.findings.length, model_slots: [...new Set(md.match(/\{\{MODEL:[A-Z_]+\}\}/g) || [])], model_comments: (md.match(/<!-- MODEL:/g) || []).length, unresolved_auto: [...new Set(md.match(/\{\{AUTO:[A-Z_]+\}\}/g) || [])], language_scan: hits.length ? LANG.summarize(hits) : "passed", needs_model: "Fill every {{MODEL:...}} slot and resolve every <!-- MODEL: --> comment in AUDIT-REPORT.md. 93-pdf refuses to render until none remain." };
  },
};
U.standalone(module.exports, module);
