// 00-discover: works out what the site is and what to audit. Writes site.json + urls.json.
// Everything downstream reads these two files, so nothing else is ever site-specific.
const zlib = require("zlib");
const U = require("../lib/util");
const T = require("../lib/thresholds");

function fingerprint(html, headers) {
  const has = (re) => re.test(html);
  const gens = [...html.matchAll(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/gi)].map((m) => m[1]);
  let platform = "other";
  if (has(/\/wp-content\/|\/wp-includes\/|wp-json/i) || gens.some((g) => /wordpress/i.test(g))) platform = "wordpress";
  else if (has(/cdn\.shopify\.com|Shopify\.theme/i)) platform = "shopify";
  else if (has(/bigcommerce\.com|stencil-utils|data-stencil/i)) platform = "bigcommerce";
  else if (has(/static\.wixstatic\.com|wix-warmup/i)) platform = "wix";
  else if (has(/squarespace\.com|Static\.SQUARESPACE/i)) platform = "squarespace";
  else if (has(/assets\.website-files\.com|data-wf-page/i)) platform = "webflow";
  else if (has(/\/static\/version\d+\/|Magento|mage\/cookies/i)) platform = "magento";
  else if (has(/\/sites\/default\/files|Drupal\.settings/i)) platform = "drupal";
  else if (has(/prestashop/i)) platform = "prestashop";
  const shop = platform === "shopify" || platform === "bigcommerce" || platform === "magento" || platform === "prestashop" ||
    has(/woocommerce|wc-ajax|add_to_cart|add-to-cart/i) || gens.some((g) => /woocommerce/i.test(g));
  const themes = U.uniq([...html.matchAll(/\/wp-content\/themes\/([a-z0-9_-]+)\//gi)].map((m) => m[1].toLowerCase()));
  const plugins = U.uniq([...html.matchAll(/\/wp-content\/plugins\/([a-z0-9_-]+)\//gi)].map((m) => m[1].toLowerCase()));
  const builders = [];
  const B = { elementor: /elementor/i, wpbakery: /js_composer|vc_row/i, divi: /et_pb_|\/Divi\//i, bricks: /brxe-|\/themes\/bricks\//i, oxygen: /ct-section|oxygen/i, "beaver-builder": /fl-builder/i, gutenberg: /wp-block-/i, brizy: /brz-/i, siteorigin: /siteorigin|panel-grid/i, shogun: /shogun/i, "slider-revolution": /rs-module|revslider/i };
  for (const [k, re] of Object.entries(B)) if (re.test(html)) builders.push(k);
  const lang = (html.match(/<html[^>]+lang=["']([^"']+)["']/i) || [])[1] || null;
  return { platform, shop, generators: gens, themes, plugins_on_home: plugins, builders, lang, server: headers.server || null, powered_by: headers["x-powered-by"] || null };
}

function classify(url, sitemapName, platform) {
  let p; try { p = new URL(url).pathname.toLowerCase(); } catch { return "other"; }
  // WordPress core names its sitemaps wp-sitemap-posts-<type>-N.xml and wp-sitemap-taxonomies-<tax>-N.xml:
  // match on the type only, or every "posts-page" file reads as a blog post.
  const raw = (sitemapName || "").toLowerCase(), core = raw.match(/^wp-sitemap-(posts|taxonomies|users)-(.+?)-\d+\.xml/);
  const sm = core ? core[2] : raw, isPageMap = core ? core[2] === "page" : /^pages?[-_.]/.test(raw), isTaxMap = !!core && core[1] !== "posts";
  if (p === "/" || /^\/[a-z]{2}(-[a-z]{2})?\/?$/.test(p)) return "home";
  if (/\/(cart|basket|winkelwagen|warenkorb|panier)\/?$/.test(p)) return "cart";
  if (/\/(checkout|kassa|afrekenen|kasse)\/?$/.test(p)) return "checkout";
  if (/\/(my-account|account|mijn-account|mein-konto|login)\/?$/.test(p)) return "account";
  if (/product_cat|product-cat|categories|collections/.test(sm) || /\/(product-category|product-categorie|produkt-kategorie|collections|c)\//.test(p)) return "category";
  if ((!isTaxMap && /product/.test(sm)) || /\/(product|products|produkt|produit|shop\/[^/]+|p)\//.test(p)) return "product";
  if (/\/(shop|webshop|store|winkel)\/?$/.test(p)) return "shop";
  if (/brand/.test(sm) || /\/brands?\//.test(p)) return "brand";
  if (isTaxMap || /(^|[-_])(category|tag|post_tag|author)([-_.]|$)/.test(sm) || /\/(category|tag|author)\//.test(p)) return "archive";
  if ((!isPageMap && /post|news|blog|article/.test(sm)) || /\/(blog|news|nieuws|magazine|journal|\d{4}\/\d{2})\//.test(p)) return "post";
  if (/contact/.test(p)) return "contact";
  if (platform === "bigcommerce" && /categor/.test(sm)) return "category";
  return "page";
}

async function fetchSitemap(url) {
  const r = await U.fetchText(url, { timeout: 40000, headers: { Accept: "application/xml,text/xml,*/*" } });
  if (!r.ok || r.status >= 400) return { url, status: r.status, error: r.error || "http " + r.status };
  let text = r.text;
  if (/\.gz($|\?)/i.test(url) && !/^\s*</.test(text)) {
    try { const raw = await fetch(url, { headers: { "User-Agent": U.UA } }); text = zlib.gunzipSync(Buffer.from(await raw.arrayBuffer())).toString("utf8"); } catch (e) { return { url, status: r.status, error: "gunzip failed" }; }
  }
  const isIndex = /<sitemapindex/i.test(text);
  const locs = [...text.matchAll(/<(?:url|sitemap)>([\s\S]*?)<\/(?:url|sitemap)>/gi)].map((m) => ({
    loc: U.decode((m[1].match(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+)/i) || [])[1] || ""),
    lastmod: (m[1].match(/<lastmod>\s*([^<]+)/i) || [])[1] || null,
  })).filter((x) => x.loc);
  return { url, status: r.status, isIndex, locs, final: r.finalUrl };
}

module.exports = {
  id: "00-discover", name: "Discover site", tiers: ["bid", "full"],
  async run(ctx) {
    const input = ctx.opts.url || (ctx.read("site.json") || {}).input;
    if (!input) throw new Error("no url");
    const start = /^https?:\/\//i.test(input) ? input : "https://" + input;
    const home = await U.fetchText(start);
    if (!home.ok) throw new Error("homepage unreachable: " + home.error);
    const origin = new URL(home.finalUrl).origin, host = U.hostOf(origin), bare = host.replace(/^www\./, "");

    // host variants
    const variants = await U.pool([`http://${bare}/`, `http://www.${bare}/`, `https://${bare}/`, `https://www.${bare}/`], 4, async (v) => {
      const r = await U.fetchText(v, { noBody: true, timeout: 20000 });
      return { url: v, status: r.status, lands_on: r.finalUrl, hops: r.chain.length, chain: r.chain.map((c) => c.status), error: r.error };
    });

    // robots.txt
    const rb = await U.fetchText(origin + "/robots.txt");
    const robotsTxt = rb.status === 200 && !/<html/i.test(rb.text.slice(0, 300)) ? rb.text : "";
    const sitemapLines = [...robotsTxt.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
    const crawlDelay = Number((robotsTxt.match(/^\s*crawl-delay:\s*([\d.]+)/im) || [])[1]) || 0;
    const aiBots = {};
    for (const bot of T.AI_BOTS) {
      const block = robotsTxt.match(new RegExp(`user-agent:\\s*${bot}\\s*[\\r\\n]+((?:\\s*(?:dis)?allow:.*[\\r\\n]*)+)`, "i"));
      aiBots[bot] = block ? (/disallow:\s*\/\s*$/im.test(block[1]) ? "blocked" : "rules") : "not mentioned";
    }
    const starBlock = (robotsTxt.match(/user-agent:\s*\*\s*[\r\n]+((?:\s*(?:(?:dis)?allow|crawl-delay):.*[\r\n]*)+)/i) || [])[1] || "";
    const robots = { present: !!robotsTxt, status: rb.status, bytes: robotsTxt.length, sitemap_lines: sitemapLines, crawl_delay: crawlDelay, blocks_everything: /disallow:\s*\/\s*$/im.test(starBlock), disallow_count: (starBlock.match(/disallow:/gi) || []).length, ai_bots: aiBots, sitemap_host_mismatch: sitemapLines.filter((s) => !U.sameSite(s, host)) };
    ctx.write("data/robots.txt", robotsTxt);

    // sitemaps
    const guesses = ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml", "/sitemap-index.xml", "/xmlsitemap.php", "/sitemap.xml.gz"];
    const queue = sitemapLines.length ? sitemapLines.filter((s) => U.sameSite(s, host)).slice() : [];
    const tried = new Set(), sitemaps = [], urlMap = new Map(), oddities = [];
    if (!queue.length) for (const g of guesses) { const s = await fetchSitemap(origin + g); tried.add(origin + g); if (s.locs && s.locs.length) { queue.push(origin + g); break; } }
    while (queue.length && sitemaps.length < 200) {
      const sm = queue.shift(); if (tried.has(sm) && sitemaps.find((x) => x.url === sm)) continue; tried.add(sm);
      const s = await fetchSitemap(sm);
      sitemaps.push({ url: sm, status: s.status, isIndex: !!s.isIndex, count: s.locs ? s.locs.length : 0, error: s.error, has_lastmod: s.locs ? s.locs.some((l) => l.lastmod) : false });
      if (!s.locs) continue;
      if (s.isIndex) { for (const l of s.locs) if (!tried.has(l.loc)) queue.push(l.loc); }
      else for (const l of s.locs) if (!urlMap.has(l.loc)) urlMap.set(l.loc, { url: l.loc, lastmod: l.lastmod, sitemap: sm.split("/").pop() });
      await U.sleep(200);
    }

    const fp = fingerprint(home.text, home.headers);

    // no sitemap: shallow link walk from the homepage
    if (!urlMap.size) {
      oddities.push("no usable sitemap found; URL list built from homepage links (2 levels)");
      const seen = new Set([home.finalUrl]); let frontier = [home.finalUrl];
      for (let depth = 0; depth < 2 && seen.size < 150; depth++) {
        const next = [];
        await U.pool(frontier.slice(0, 40), 4, async (u) => {
          const r = u === home.finalUrl ? home : await U.fetchText(u);
          for (const m of r.text.matchAll(/<a\b[^>]+href=["']([^"'#]+)["']/gi)) {
            let abs; try { abs = new URL(m[1], u); } catch { continue; }
            abs.hash = ""; const s = abs.toString();
            if (abs.hostname === host && !/\.(jpe?g|png|gif|webp|svg|pdf|zip|css|js)(\?|$)/i.test(s) && !/[?&](add-to-cart|replytocom)=/.test(s) && !seen.has(s) && seen.size < 150) { seen.add(s); next.push(s); }
          }
        }, 300);
        frontier = next;
      }
      for (const s of seen) urlMap.set(s, { url: s, lastmod: null, sitemap: "(link walk)" });
    }

    let urls = [...urlMap.values()].map((u) => Object.assign(u, { t: classify(u.url, u.sitemap, fp.platform), offsite: !U.sameSite(u.url, host) }));
    const offsite = urls.filter((u) => u.offsite).length; if (offsite) oddities.push(`${offsite} sitemap URLs point at another domain`);
    urls = urls.filter((u) => !u.offsite);
    if (!urls.find((u) => u.t === "home")) urls.unshift({ url: home.finalUrl, lastmod: null, sitemap: "(added)", t: "home" });
    const total = urls.length, max = ctx.opts.maxUrls || 1500;
    if (total > max) { // keep every non-product/post URL, sample the long tails evenly
      const keep = urls.filter((u) => !["product", "post", "archive", "brand"].includes(u.t)), tail = urls.filter((u) => ["product", "post", "archive", "brand"].includes(u.t));
      const step = tail.length / Math.max(1, max - keep.length); const sampled = []; for (let i = 0; i < tail.length && sampled.length < max - keep.length; i += step) sampled.push(tail[Math.floor(i)]);
      urls = keep.concat(sampled); oddities.push(`URL list capped: ${total} found, ${urls.length} audited (all key templates kept, long tail sampled evenly)`);
    }
    const counts = {}; for (const u of urls) counts[u.t] = (counts[u.t] || 0) + 1;
    if (sitemaps.length && !sitemaps.some((s) => s.has_lastmod)) oddities.push("sitemaps carry no lastmod dates");
    for (const s of sitemaps.filter((s) => s.error)) oddities.push(`sitemap failed: ${s.url} (${s.error})`);

    // samples: what the browser modules will measure
    const pick = (t, n) => urls.filter((u) => u.t === t).slice(0, 40).sort((a, b) => a.url.length - b.url.length).slice(0, n).map((u) => ({ label: t, url: u.url }));
    let samples = [{ label: "home", url: home.finalUrl }, ...pick("shop", 1), ...pick("category", 2), ...pick("product", 2), ...pick("page", 1), ...pick("post", 1), ...pick("contact", 1)];
    if (fp.shop && fp.platform === "wordpress") for (const [t, p] of [["cart", "/cart/"], ["checkout", "/checkout/"]]) { const f = urls.find((u) => u.t === t); samples.push({ label: t, url: f ? f.url : origin + p, guessed: !f }); }
    samples.forEach((s, i) => (s.id = `${String(i + 1).padStart(2, "0")}-${s.label}`));

    const langPrefixes = {}; for (const u of urls) { const m = new URL(u.url).pathname.match(/^\/([a-z]{2})(?:-[a-z]{2})?\//i); if (m) langPrefixes[m[1].toLowerCase()] = (langPrefixes[m[1].toLowerCase()] || 0) + 1; }

    const site = { input, origin, host, bare_domain: bare, reg_domain: U.regDomain(host), home: home.finalUrl, audited_at: new Date().toISOString(), home_status: home.status, home_ttfb_ms: home.ttfb, home_html_kb: U.round(Buffer.byteLength(home.text) / 1024), variants, robots, sitemaps, fingerprint: fp, counts, total_urls_found: total, urls_audited: urls.length, lang_prefixes: langPrefixes, samples, country: ctx.opts.country || null, cities: ctx.opts.cities || null, brief: ctx.read("brief.json") };
    ctx.write("site.json", site); ctx.write("urls.json", urls); ctx.write("data/home.html", home.text);

    const badVariants = variants.filter((v) => v.hops > T.REDIRECT_HOPS || (v.lands_on && U.hostOf(v.lands_on) !== host) || v.error);
    return { host, origin, platform: fp.platform, shop: fp.shop, theme: fp.themes[0] || null, builders: fp.builders, generators: fp.generators.slice(0, 5), lang: fp.lang, server: fp.server, plugins_seen_on_home: fp.plugins_on_home.length, urls_found: total, urls_audited: urls.length, counts, sitemaps: sitemaps.length, robots: { present: robots.present, sitemap_line: sitemapLines.length > 0, crawl_delay: crawlDelay, blocks_everything: robots.blocks_everything, ai_bots_blocked: Object.entries(aiBots).filter(([, v]) => v === "blocked").map(([k]) => k), ai_bots_mentioned: Object.values(aiBots).filter((v) => v !== "not mentioned").length }, host_variants_with_problems: badVariants.map((v) => ({ url: v.url, lands_on: v.lands_on, hops: v.hops, error: v.error })), lang_prefixes: langPrefixes, samples: samples.map((s) => `${s.id} ${s.url}`), oddities };
  },
};
U.standalone(module.exports, module);
