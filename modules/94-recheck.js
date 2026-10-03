// 94-recheck: writes client-pack/recheck.mjs, a dependency-free script the client runs with `node recheck.mjs`.
// It re-reads their public pages and prints each audited number beside today's value (the Said & Co pattern).
// The script body is templates/recheck.mjs.tpl; this module only fills in what was measured on this site.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const U = require("../lib/util");
const LANG = require("../lib/language");

const norm = (u) => { try { const x = new URL(u); x.hash = ""; x.search = ""; return x.toString().replace(/\/$/, ""); } catch { return u; } };
const LABELS = { home: "Homepage", shop: "Shop page", category: "Category page", product: "Product page", page: "Content page", post: "Article", contact: "Contact page" };

module.exports = {
  id: "94-recheck", name: "Client re-check script", tiers: ["full"],
  async run(ctx) {
    const site = ctx.site, who = U.identity(ctx), origin = site.origin;
    const crawlFile = path.join(ctx.dataDir, "crawl.jsonl"), rows = fs.existsSync(crawlFile) ? fs.readFileSync(crawlFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [], rowOf = new Map(rows.map((r) => [norm(r.url), r]));
    const cache = ctx.summary("31-cache"), headers = ctx.summary("20-headers"), subs = ctx.summary("22-subdomains"), exposure = ctx.summary("51-exposure"), wp = ctx.read("data/wp.json"), links = ctx.read("data/links.json"), analysis = ctx.read("data/analysis.json");
    const A = { client: who.client, host: site.host, origin, date: new Date(site.audited_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase() };

    if (cache && cache.first_byte_ms_repeat_requests) A.first_byte = { url: origin + "/", audited_ms: cache.first_byte_ms_repeat_requests, audited_cache_hits: cache.cache_hits_seen || 0, audited_cookies: cache.cookies_set_on_anonymous_visit || null };

    // one page per template, read from the crawl so "audited" and "today" are parsed the same way
    const seen = new Set(); A.pages = [];
    for (const s of site.samples || []) { if (["cart", "checkout", "account"].includes(s.label) || seen.has(s.label) || A.pages.length >= 5) continue; const r = rowOf.get(norm(s.url)); if (!r || r.status !== 200) continue; seen.add(s.label);
      A.pages.push({ label: LABELS[s.label] || s.label, url: r.url, audited: { title: r.title || "", description_chars: r.desc_len || 0, main_headings: r.h1_count || 0, structured_data_items: (r.ld_types || []).length, share_image: r.og_image ? "yes" : "no", stylesheets: r.styles, script_files: r.scripts, images_without_description: r.imgs_no_alt, html_kb: r.html_kb } }); }

    A.variants = (site.variants || []).filter((v) => !v.error).map((v) => ({ url: v.url, audited_hops: v.hops }));

    const open = [], ex = (wp && wp.exposure) || {};
    if (ex.debug_log_public) open.push({ label: "Your site's internal error log", url: origin + "/wp-content/debug.log" });
    if (ex.readme_html_public) open.push({ label: "The default WordPress readme file", url: origin + "/readme.html" });
    for (const f of (exposure && exposure.sensitive_files_public) || []) open.push({ label: f.what || "A file that should be private", url: origin + f.path });
    for (const s of (subs && subs.nonprod_public) || []) if (!(subs.protected || []).includes(s.host)) open.push({ label: "Test copy of the site: " + s.host, url: "https://" + s.host + "/" });
    A.open_files = open.slice(0, 10);

    // only addresses that answered with a real "not found": a timeout on audit day is not proof of a dead link
    A.dead_links = ((links && links.broken_internal) || []).filter((l) => l.status >= 400).sort((a, b) => (b.pages || 0) - (a.pages || 0)).slice(0, 8).map((l) => ({ url: l.url, pages: l.pages || null, audited: l.status ? "does not load" : "no answer" }));
    A.sitemap_problems = ((analysis && analysis.sitemap_non200 && analysis.sitemap_non200.examples) || []).map((e) => { const m = String(e).match(/^(\S+)\s+(\S+)/); return m ? { url: m[2], audited: /^\d+$/.test(m[1]) && m[1] !== "0" ? "does not load" : "no answer" } : null; }).filter(Boolean).filter((x) => !A.dead_links.some((d) => d.url === x.url));
    A.headers_missing = (headers && headers.security_headers_missing) || [];

    const prepared = `Prepared for ${who.client}, ${A.date.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())}${who.freelancer ? ", by " + who.freelancer : ""}.`;
    const tpl = fs.readFileSync(path.join(U.ROOT, "templates", "recheck.mjs.tpl"), "utf8");
    const js = tpl.replace("__PREPARED_LINE__", () => prepared).replace("__AUDIT_JSON__", () => JSON.stringify(A, null, 2));
    const file = ctx.write("client-pack/recheck.mjs", js);
    let syntax = "ok"; try { execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }); } catch (e) { syntax = String(e.stderr || e.message).split("\n").slice(0, 4).join(" "); }
    const hits = LANG.lint(js.replace(/const AUDIT = [\s\S]*?\n};\n/, "")); // the client's own titles and addresses are theirs; scan only our words
    const sections = { first_byte: !!A.first_byte, pages: A.pages.length, address_variants: A.variants.length, should_be_closed: A.open_files.length, dead_addresses: A.dead_links.length + A.sitemap_problems.length, protections: A.headers_missing.length };
    if (syntax !== "ok") return { status: "failed", reason: "generated script does not parse: " + syntax };
    return { file: "client-pack/recheck.mjs", kb: U.round(Buffer.byteLength(js) / 1024, 1), checks: sections, prepared_by: who.freelancer || "MISSING: pass --freelancer", syntax, language_scan: hits.length ? LANG.summarize(hits) : "passed", how_to_verify: "node client-pack/recheck.mjs  (every line should read 'same' on audit day)" };
  },
};
U.standalone(module.exports, module);
