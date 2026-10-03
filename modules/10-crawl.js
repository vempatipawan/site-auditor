// 10-crawl: fetches every URL in urls.json politely and extracts on-page facts from the raw HTML.
// Nothing inferred: every field comes from the live response. Bulk goes to data/crawl.jsonl.
const fs = require("fs");
const path = require("path");
const U = require("../lib/util");
const T = require("../lib/thresholds");

const first = (re, s) => { const m = s.match(re); return m ? m[1] : null; };
const metaContent = (html, attr, name) => first(new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]*content=["']([\\s\\S]*?)["']`, "i"), html) || first(new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]*${attr}=["']${name}["']`, "i"), html);

function extract(item, r, host) {
  const html = r.text, url = item.url;
  const title = first(/<title[^>]*>([\s\S]*?)<\/title>/i, html);
  const desc = metaContent(html, "name", "description");
  const canonical = first(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)["']/i, html) || first(/<link[^>]+href=["']([^"']*)["'][^>]*rel=["']canonical["']/i, html);
  const robotsMeta = metaContent(html, "name", "robots");
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => U.stripTags(m[1])).filter(Boolean);
  const headingOrder = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  let skipped = 0; for (let i = 1; i < headingOrder.length; i++) if (headingOrder[i] - headingOrder[i - 1] > 1) skipped++;

  const types = []; let ldErrors = 0; const ld = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const data = JSON.parse(m[1].trim()); ld.push(data);
      const walk = (o) => { if (!o) return; if (Array.isArray(o)) return o.forEach(walk); if (typeof o === "object") { if (o["@type"]) types.push([].concat(o["@type"]).join("/")); if (o["@graph"]) walk(o["@graph"]); } }; walk(data);
    } catch { ldErrors++; }
  }
  const hreflang = [...html.matchAll(/<link[^>]+rel=["']alternate["'][^>]*hreflang=["']([^"']*)["'][^>]*href=["']([^"']*)["']/gi)].map((m) => ({ lang: m[1], href: m[2] }));
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  let noAlt = 0, lazy = 0, noDims = 0;
  for (const t of imgs) { const alt = t.match(/\balt=["']([^"']*)["']/i); if (!alt || !alt[1].trim()) noAlt++; if (/loading=["']lazy["']|data-lazy|lazyload/i.test(t)) lazy++; if (!/\bwidth=/i.test(t) || !/\bheight=/i.test(t)) noDims++; }

  const links = [], tels = [], mails = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const h = m[1].trim();
    if (/^tel:/i.test(h)) { tels.push(h.replace(/^tel:/i, "").replace(/[^\d+]/g, "")); continue; }
    if (/^mailto:/i.test(h)) { mails.push(h.replace(/^mailto:/i, "").split("?")[0].toLowerCase()); continue; }
    if (/^(#|javascript:|data:)/i.test(h)) continue;
    try { const a = new URL(h, r.finalUrl); a.hash = ""; links.push(a.toString()); } catch {}
  }
  const internal = U.uniq(links.filter((l) => U.hostOf(l) === host)), external = U.uniq(links.filter((l) => U.hostOf(l) && !U.sameSite(l, host)));
  const text = U.stripTags(html.replace(/<(header|nav|footer)[\s\S]*?<\/\1>/gi, " "));
  const lower = html.toLowerCase();
  const placeholders = T.DEFAULT_WORDLIST_PLACEHOLDER.filter((w) => lower.includes(w));
  const self = canonical ? [url, r.finalUrl].some((x) => x.replace(/\/$/, "").split("?")[0] === canonical.replace(/\/$/, "").split("?")[0]) : null;
  const inStock = /"availability"\s*:\s*"[^"]*InStock/i.test(html) ? true : /"availability"\s*:\s*"[^"]*OutOfStock|class="[^"]*out-of-stock/i.test(html) ? false : null;

  return {
    url, t: item.t, status: r.status, final_url: r.finalUrl, hops: r.chain.length, chain: r.chain.map((c) => `${c.status} ${c.to}`), ms: r.ms, ttfb: r.ttfb,
    title: title ? U.decode(title) : null, title_len: title ? U.decode(title).length : 0, desc: desc ? U.decode(desc) : null, desc_len: desc ? U.decode(desc).length : 0,
    h1: h1s.slice(0, 3), h1_count: h1s.length, heading_skips: skipped, canonical, canonical_self: self, canonical_host: canonical ? U.hostOf(canonical) : null,
    robots_meta: robotsMeta, noindex: robotsMeta ? /noindex/i.test(robotsMeta) : /noindex/i.test(r.headers["x-robots-tag"] || ""),
    og_title: !!metaContent(html, "property", "og:title"), og_desc: !!metaContent(html, "property", "og:description"), og_image: metaContent(html, "property", "og:image"), twitter_card: metaContent(html, "name", "twitter:card"),
    lang: first(/<html[^>]+lang=["']([^"']+)["']/i, html), viewport: metaContent(html, "name", "viewport"),
    ld_types: U.uniq(types), ld_errors: ldErrors, microdata: /itemscope|itemprop=/i.test(html), hreflang,
    imgs: imgs.length, imgs_no_alt: noAlt, imgs_lazy: lazy, imgs_no_dims: noDims,
    scripts: (html.match(/<script\b[^>]*\bsrc=/gi) || []).length, inline_scripts: (html.match(/<script\b(?![^>]*\bsrc=)/gi) || []).length, styles: (html.match(/<link[^>]+rel=["']stylesheet["']/gi) || []).length,
    html_kb: U.round(Buffer.byteLength(html) / 1024), text_chars: text.length, word_count: text ? text.split(/\s+/).length : 0,
    internal_links: internal, external_links: external.slice(0, 60), tels: U.uniq(tels), mails: U.uniq(mails), placeholders, in_stock: inStock,
    plugins: U.uniq([...html.matchAll(/\/wp-content\/plugins\/([a-z0-9_-]+)\//gi)].map((m) => m[1].toLowerCase())),
    cache_hdr: (r.headers["x-cache"] || r.headers["cf-cache-status"] || r.headers["x-cache-status"] || r.headers["x-litespeed-cache"] || r.headers["x-varnish-cache"] || "").slice(0, 30) || null,
    modified: first(/"dateModified"\s*:\s*"([^"]+)"/i, html) || first(/article:modified_time["'][^>]*content=["']([^"']+)/i, html), published: first(/"datePublished"\s*:\s*"([^"]+)"/i, html),
  };
}

module.exports = {
  id: "10-crawl", name: "Crawl every sitemap URL", tiers: ["full"], extract,
  async run(ctx) {
    const urls = ctx.read("urls.json", []), site = ctx.site, host = site.host;
    const out = path.join(ctx.dataDir, "crawl.jsonl"); const stream = fs.createWriteStream(out, { flags: "w" });
    const stagger = Math.max(300, Math.min((site.robots.crawl_delay || 0) * 1000, 3000)); // honour crawl-delay, capped at 3s per worker
    let done = 0; const failures = [];
    const work = async (item) => {
      let r = await U.fetchText(item.url);
      if (!r.ok || r.status === 429 || r.status >= 500) { await U.sleep(2500); r = await U.fetchText(item.url); }
      let rec; if (!r.ok) { failures.push({ url: item.url, error: r.error }); rec = { url: item.url, t: item.t, status: 0, error: r.error }; } else rec = extract(item, r, host);
      stream.write(JSON.stringify(rec) + "\n"); if (++done % 100 === 0) ctx.log(`crawl ${done}/${urls.length}`);
    };
    await U.pool(urls, 4, work, stagger);
    await new Promise((r) => stream.end(r));
    ctx.write("data/crawl-failures.json", failures);
    return { urls: urls.length, fetched: done - failures.length, failures: failures.length, failure_examples: U.top(failures, 3), stagger_ms: stagger };
  },
};
U.standalone(module.exports, module);
