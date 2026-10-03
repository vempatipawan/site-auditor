// 11-analyze: turns data/crawl.jsonl into at-scale metrics. Every metric = a count plus up to 5 example URLs.
// Writes data/analysis.json (full), pages.csv (client evidence, one row per page) and a small summary.
const fs = require("fs");
const path = require("path");
const U = require("../lib/util");
const T = require("../lib/thresholds");

const M = (list, fmt) => ({ count: list.length, examples: U.top(list, 5).map(fmt || ((p) => p.url)) });
const csvCell = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
const norm = (u) => { try { const x = new URL(u); x.hash = ""; x.search = ""; return x.toString().replace(/\/$/, ""); } catch { return u; } };

module.exports = {
  id: "11-analyze", name: "Analyze crawl at scale", tiers: ["full"],
  async run(ctx) {
    const f = path.join(ctx.dataDir, "crawl.jsonl"); if (!fs.existsSync(f)) return U.skipped("no crawl data");
    const all = fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const site = ctx.site, ok = all.filter((p) => p.status === 200 && p.title !== undefined), n = ok.length;
    const money = (p) => ["home", "product", "category", "shop"].includes(p.t), byT = (t) => ok.filter((p) => p.t === t);
    const A = { pages: n, crawled: all.length };

    // status + redirects inside the sitemap
    const statuses = {}; for (const p of all) statuses[p.status] = (statuses[p.status] || 0) + 1; A.statuses = statuses;
    A.sitemap_non200 = M(all.filter((p) => p.status !== 200), (p) => `${p.status} ${p.url}`);
    A.sitemap_redirects = M(all.filter((p) => p.hops > 0), (p) => `${p.url} -> ${p.final_url}`);
    A.final_url_has_params = M(ok.filter((p) => /\?/.test(p.final_url || "") && !/\?/.test(p.url)), (p) => p.final_url);

    // titles
    const sep = /\s+[|\-–—·:»]\s+/; const tail = {}; for (const p of ok) if (p.title) { const parts = p.title.split(sep); if (parts.length > 1) { const b = parts[parts.length - 1].trim(); tail[b] = (tail[b] || 0) + 1; } }
    const bestTail = Object.entries(tail).sort((a, b) => b[1] - a[1])[0];
    // brand = the most common title suffix if it is a real word on 30%+ of pages, else the domain label
    const brand = bestTail && bestTail[1] >= n * 0.3 && /^[\p{L}\d][\p{L}\d .&'-]{2,}$/u.test(bestTail[0]) && !/[|\-–—·:»]\s*$/.test(bestTail[0]) ? bestTail[0] : site.reg_domain.split(".")[0]; A.brand_guess = brand;
    const tGroups = {}; for (const p of ok) if (p.title) (tGroups[p.title.toLowerCase()] = tGroups[p.title.toLowerCase()] || []).push(p.url);
    A.title_missing = M(ok.filter((p) => !p.title));
    A.title_default = M(ok.filter((p) => p.title && /^(home|home page|homepage|untitled|new page|page|shop|webshop|products?)(\s*[|\-–—·:»]\s*)?$/i.test(p.title.trim())), (p) => `"${p.title}" ${p.url}`);
    A.title_broken_separator = M(ok.filter((p) => p.title && /(^\s*[|\-–—·:»])|([|\-–—·:»]\s*$)|([|–—·»]\s*[|–—·»])/.test(p.title)), (p) => `"${p.title}" ${p.url}`);
    A.title_long = M(ok.filter((p) => p.title_len > T.TITLE_MAX), (p) => `${p.title_len} chars ${p.url}`);
    A.title_short = M(ok.filter((p) => p.title && p.title_len < T.TITLE_MIN), (p) => `"${p.title}" ${p.url}`);
    A.title_no_brand = brand ? M(ok.filter((p) => p.title && !p.title.toLowerCase().includes(brand.toLowerCase()))) : { count: 0, examples: [] };
    const dupT = Object.entries(tGroups).filter(([, v]) => v.length > 1); A.title_duplicate = { count: dupT.reduce((s, [, v]) => s + v.length, 0), groups: dupT.length, examples: U.top(dupT, 5).map(([k, v]) => `"${k}" x${v.length}: ${v.slice(0, 2).join(" , ")}`) };

    // descriptions
    const dGroups = {}; for (const p of ok) if (p.desc) (dGroups[p.desc.toLowerCase()] = dGroups[p.desc.toLowerCase()] || []).push(p.url);
    A.desc_missing = M(ok.filter((p) => !p.desc)); A.desc_missing_by_template = {}; for (const p of ok) if (!p.desc) A.desc_missing_by_template[p.t] = (A.desc_missing_by_template[p.t] || 0) + 1;
    A.desc_short = M(ok.filter((p) => p.desc && p.desc_len < T.DESC_MIN)); A.desc_long = M(ok.filter((p) => p.desc_len > T.DESC_MAX));
    A.desc_artefacts = M(ok.filter((p) => p.desc && /\[\/?[a-z_]+[^\]]*\]|\[&hellip;\]|&[a-z]+;|vc_row|et_pb_|<\/?[a-z]/i.test(p.desc)), (p) => `"${p.desc.slice(0, 70)}" ${p.url}`);
    const dupD = Object.entries(dGroups).filter(([, v]) => v.length > 1); A.desc_duplicate = { count: dupD.reduce((s, [, v]) => s + v.length, 0), groups: dupD.length, examples: U.top(dupD, 3).map(([k, v]) => `x${v.length}: "${k.slice(0, 60)}"`) };

    // headings
    A.h1_missing = M(ok.filter((p) => p.h1_count === 0)); A.h1_multiple = M(ok.filter((p) => p.h1_count > 1), (p) => `${p.h1_count} H1s ${p.url}`); A.heading_skips = M(ok.filter((p) => p.heading_skips > 2));

    // canonicals + indexing
    A.canonical_missing = M(ok.filter((p) => !p.canonical)); A.canonical_not_self = M(ok.filter((p) => p.canonical && p.canonical_self === false), (p) => `${p.url} -> ${p.canonical}`);
    A.canonical_other_host = M(ok.filter((p) => p.canonical_host && p.canonical_host !== site.host), (p) => `${p.url} -> ${p.canonical}`); A.canonical_http = M(ok.filter((p) => /^http:/i.test(p.canonical || "")));
    A.noindex_money_pages = M(ok.filter((p) => p.noindex && money(p))); A.noindex_in_sitemap = M(ok.filter((p) => p.noindex));
    const junkRe = /(sample-page|hello-world|uncategorized|\/copy-|-copy\/?$|-kopie\/?$|-kopie-|\/test\/?$|\/test-|lorem|\/elementor-\d+|\/home-2\/?$|-2\/?$)/i;
    A.utility_pages_indexable = M(ok.filter((p) => ["cart", "checkout", "account"].includes(p.t) && !p.noindex), (p) => `${p.t}: ${p.url}`);
    A.junk_pages_indexable = M(ok.filter((p) => junkRe.test(p.url) && !p.noindex));
    A.params_in_sitemap = M(ok.filter((p) => /\?/.test(p.url)));

    // content
    A.thin_pages = M(ok.filter((p) => ["product", "category", "page", "shop"].includes(p.t) && p.text_chars < T.THIN_HTML_TEXT_CHARS), (p) => `${p.text_chars} chars ${p.url}`);
    A.placeholders = M(ok.filter((p) => p.placeholders && p.placeholders.length), (p) => `"${p.placeholders.join('","')}" ${p.url}`);
    A.og_image_missing = M(ok.filter((p) => !p.og_image)); A.og_title_missing = M(ok.filter((p) => !p.og_title)); A.og_image_missing_by_template = {}; for (const p of ok) if (!p.og_image) A.og_image_missing_by_template[p.t] = (A.og_image_missing_by_template[p.t] || 0) + 1;
    A.lang_missing = M(ok.filter((p) => !p.lang)); A.langs = {}; for (const p of ok) if (p.lang) A.langs[p.lang] = (A.langs[p.lang] || 0) + 1;
    A.viewport_missing = M(ok.filter((p) => !p.viewport)); A.zoom_disabled = M(ok.filter((p) => /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(p.viewport || "")));

    // images
    const imgs = ok.reduce((s, p) => s + p.imgs, 0), noAlt = ok.reduce((s, p) => s + p.imgs_no_alt, 0), lazy = ok.reduce((s, p) => s + p.imgs_lazy, 0), noDims = ok.reduce((s, p) => s + p.imgs_no_dims, 0);
    A.images = { total: imgs, missing_alt: noAlt, missing_alt_pct: U.pct(noAlt, imgs), lazy_pct: U.pct(lazy, imgs), no_dimensions_pct: U.pct(noDims, imgs), worst_alt: U.top(ok.slice().sort((a, b) => b.imgs_no_alt - a.imgs_no_alt), 3).map((p) => `${p.imgs_no_alt}/${p.imgs} ${p.url}`) };

    // structured data
    const has = (p, re) => (p.ld_types || []).some((t) => re.test(t)); const prod = byT("product");
    A.schema = { pages_with_jsonld: ok.filter((p) => p.ld_types.length).length, jsonld_parse_errors: M(ok.filter((p) => p.ld_errors)), microdata_only: M(ok.filter((p) => p.microdata && !p.ld_types.length)), products: prod.length, products_with_Product: prod.filter((p) => has(p, /product/i)).length, products_with_rating: prod.filter((p) => has(p, /aggregaterating|review/i)).length, home_has_Organization: byT("home").some((p) => has(p, /organization|localbusiness|store/i)), home_has_WebSite: byT("home").some((p) => has(p, /website/i)), breadcrumb_pages: ok.filter((p) => has(p, /breadcrumb/i)).length, types_seen: U.uniq(ok.flatMap((p) => p.ld_types)).slice(0, 25) };

    // hreflang reciprocity
    const withHl = ok.filter((p) => p.hreflang && p.hreflang.length), byUrl = new Map(ok.map((p) => [norm(p.url), p])); const notRecip = [], noSelf = [], noXdef = [];
    for (const p of withHl) { if (!p.hreflang.some((h) => norm(h.href) === norm(p.url))) noSelf.push(p); if (!p.hreflang.some((h) => /x-default/i.test(h.lang))) noXdef.push(p);
      for (const h of p.hreflang) { const tgt = byUrl.get(norm(h.href)); if (tgt && tgt !== p && !(tgt.hreflang || []).some((x) => norm(x.href) === norm(p.url))) { notRecip.push(p); break; } } }
    A.hreflang = { pages_with_hreflang: withHl.length, langs: U.uniq(withHl.flatMap((p) => p.hreflang.map((h) => h.lang))), missing_self: M(noSelf), missing_x_default: M(noXdef), not_reciprocal: M(notRecip) };

    // link graph: inbound counts, orphans, depth
    const inbound = new Map(ok.map((p) => [norm(p.url), 0])); const adj = new Map();
    for (const p of ok) { const outs = U.uniq((p.internal_links || []).map(norm)); adj.set(norm(p.url), outs); for (const o of outs) if (inbound.has(o) && o !== norm(p.url)) inbound.set(o, inbound.get(o) + 1); }
    const depth = new Map([[norm(site.home), 0]]); let frontier = [norm(site.home)];
    while (frontier.length) { const next = []; for (const u of frontier) for (const o of adj.get(u) || []) if (inbound.has(o) && !depth.has(o)) { depth.set(o, depth.get(u) + 1); next.push(o); } frontier = next; }
    const linkCounts = ok.map((p) => (p.internal_links || []).length).sort((a, b) => a - b);
    A.links = { orphans: M(ok.filter((p) => p.t !== "home" && inbound.get(norm(p.url)) === 0)), deep_pages: M(ok.filter((p) => (depth.get(norm(p.url)) ?? 99) > 4 && inbound.get(norm(p.url)) > 0), (p) => `depth ${depth.get(norm(p.url))} ${p.url}`), median_internal_links_per_page: U.median(linkCounts), max_internal_links: linkCounts[linkCounts.length - 1] || 0 };
    const crawled = new Set(all.map((p) => norm(p.url))); const intTargets = U.uniq(ok.flatMap((p) => p.internal_links || [])).filter((l) => !crawled.has(norm(l))), extTargets = U.uniq(ok.flatMap((p) => p.external_links || []));
    ctx.write("data/link-targets.json", { internal: intTargets, external: extTargets });

    // speed + weight as seen by a plain fetch
    const avg = (arr, k) => U.round(arr.reduce((s, p) => s + (p[k] || 0), 0) / Math.max(1, arr.length)); A.by_template = {};
    for (const t of U.uniq(ok.map((p) => p.t))) { const g = byT(t); A.by_template[t] = { pages: g.length, avg_ttfb_ms: avg(g, "ttfb"), avg_html_kb: avg(g, "html_kb"), avg_scripts: avg(g, "scripts"), avg_styles: avg(g, "styles"), avg_words: avg(g, "word_count") }; }
    A.slowest = U.top(ok.slice().sort((a, b) => b.ttfb - a.ttfb), 5).map((p) => `${p.ttfb}ms ${p.url}`);
    A.cache_headers = {}; for (const p of ok) { const k = p.cache_hdr || "(none)"; A.cache_headers[k] = (A.cache_headers[k] || 0) + 1; }

    // catalogue + contact identity + freshness
    const stock = prod.filter((p) => p.in_stock !== null); A.catalogue = { products: prod.length, stock_known: stock.length, out_of_stock: stock.filter((p) => p.in_stock === false).length, out_of_stock_examples: U.top(stock.filter((p) => p.in_stock === false), 5).map((p) => p.url), copy_slugs: M(prod.filter((p) => /(copy|kopie|-2)\/?$/i.test(p.url))) };
    const tally = (k) => { const c = {}; for (const p of ok) for (const v of p[k] || []) c[v] = (c[v] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v, cnt]) => `${v} (${cnt} pages)`); };
    A.contact_identity = { phones: tally("tels"), emails: tally("mails") };
    const dates = ok.filter((p) => p.t === "post" && p.published).map((p) => p.published).sort(); A.freshness = { posts: byT("post").length, newest_post: dates[dates.length - 1] || null, oldest_post: dates[0] || null };
    A.plugins_seen = U.uniq(ok.flatMap((p) => p.plugins || [])).sort();

    // samples were picked before the crawl existed. Swap any the crawl proved unrepresentative (redirects, noindex,
    // canonical pointing elsewhere, out of stock) so the browser modules measure a page a shopper can actually buy from.
    const fit = (p) => p.status === 200 && !p.hops && !p.noindex && p.canonical_self !== false && p.in_stock !== false;
    const rowOf = new Map(all.map((p) => [norm(p.url), p])), samples = site.samples || [], used = new Set(samples.map((s) => norm(s.url))), swaps = [];
    for (const s of samples) {
      if (["home", "shop", "cart", "checkout"].includes(s.label)) continue; const row = rowOf.get(norm(s.url)); if (!row || fit(row)) continue;
      const alt = ok.filter((p) => p.t === s.label && fit(p) && !used.has(norm(p.url))).sort((a, b) => a.url.length - b.url.length)[0]; if (!alt) continue;
      const why = row.status !== 200 ? `status ${row.status}` : row.hops ? "redirects" : row.noindex ? "noindex" : row.canonical_self === false ? `canonical points at ${row.canonical}` : "out of stock";
      swaps.push(`${s.id}: ${s.url} -> ${alt.url} (${why})`); used.add(norm(alt.url)); s.url = alt.url; s.repicked = why;
    }
    if (swaps.length) { site.samples = samples; ctx.write("site.json", site); } A.samples_repicked = swaps;

    ctx.write("data/analysis.json", A);

    // pages.csv: the client's page-by-page evidence sheet
    const cols = ["URL", "Type", "Status", "Title", "Title length", "Meta description present", "Meta description length", "H1 count", "Indexable", "Canonical matches URL", "Images", "Images missing alt", "Images lazy-loaded", "Stylesheets", "Scripts", "HTML size KB", "Response ms", "Structured data types", "Inbound internal links"];
    const rows = ok.map((p) => [p.url, p.t, p.status, p.title, p.title_len, p.desc ? "yes" : "NO", p.desc_len, p.h1_count, p.noindex ? "NO" : "yes", p.canonical_self === null ? "none" : p.canonical_self ? "yes" : "NO", p.imgs, p.imgs_no_alt, p.imgs_lazy, p.styles, p.scripts, p.html_kb, p.ttfb, (p.ld_types || []).join(" / "), inbound.get(norm(p.url))]);
    ctx.write("pages.csv", [cols, ...rows].map((r) => r.map(csvCell).join(",")).join("\n"));

    // summary: counts + one example each, only for metrics that fired
    const S = { pages: n, brand_guess: brand, statuses, by_template: A.by_template, images: A.images, schema: A.schema, hreflang: { pages: withHl.length, langs: A.hreflang.langs, not_reciprocal: notRecip.length, missing_x_default: noXdef.length, missing_self: noSelf.length }, links: { orphans: A.links.orphans.count, deep_pages: A.links.deep_pages.count, median_internal_links_per_page: A.links.median_internal_links_per_page, max_internal_links: A.links.max_internal_links }, catalogue: A.catalogue, contact_identity: A.contact_identity, freshness: A.freshness, langs: A.langs, desc_missing_by_template: A.desc_missing_by_template, slowest: A.slowest, cache_headers: A.cache_headers, plugins_seen: A.plugins_seen.length, samples_repicked: swaps, issues: {} };
    for (const [k, v] of Object.entries(A)) if (v && typeof v === "object" && typeof v.count === "number" && v.count > 0) S.issues[k] = { count: v.count, groups: v.groups, eg: (v.examples || []).slice(0, 2) };
    return S;
  },
};
U.standalone(module.exports, module);
