// 70-schema-ai: structured data field by field on the sample pages, plus how the site presents itself to AI search.
const U = require("../lib/util");

const REQ = {
  Product: { required: ["name", "image", "offers"], recommended: ["description", "sku", "brand", "aggregateRating", "review", "gtin|gtin13|gtin12|gtin8|mpn"] },
  Offer: { required: ["price|lowPrice", "priceCurrency", "availability"], recommended: ["url", "priceValidUntil", "shippingDetails", "hasMerchantReturnPolicy", "itemCondition"] },
  Organization: { required: ["name", "url"], recommended: ["logo", "sameAs", "contactPoint", "address"] },
  LocalBusiness: { required: ["name", "address"], recommended: ["telephone", "openingHoursSpecification|openingHours", "geo", "image", "priceRange"] },
  WebSite: { required: ["name", "url"], recommended: ["potentialAction"] },
  Article: { required: ["headline"], recommended: ["image", "datePublished", "dateModified", "author"] },
  BreadcrumbList: { required: ["itemListElement"], recommended: [] },
};
const hasKey = (o, spec) => spec.split("|").some((k) => o[k] != null && o[k] !== "" && !(Array.isArray(o[k]) && !o[k].length));
function flatten(data, out = []) { if (!data) return out; if (Array.isArray(data)) { data.forEach((d) => flatten(d, out)); return out; } if (typeof data === "object") { if (data["@type"]) out.push(data); if (data["@graph"]) flatten(data["@graph"], out); for (const k of ["offers", "mainEntity", "itemReviewed"]) if (data[k] && typeof data[k] === "object") flatten(data[k], out); } return out; }
const typeOf = (n) => [].concat(n["@type"]).map(String);
const matchType = (n, t) => typeOf(n).some((x) => x === t || (t === "Article" && /Article|BlogPosting|NewsArticle/.test(x)) || (t === "LocalBusiness" && /LocalBusiness|Store|Restaurant|Bakery|.+Business$/.test(x)) || (t === "Offer" && /^(Offer|AggregateOffer)$/.test(x)));

module.exports = {
  id: "70-schema-ai", name: "Structured data and AI-search readiness", tiers: ["bid", "full"],
  async run(ctx) {
    const site = ctx.site, samples = ctx.samples.filter((s) => !["cart", "checkout"].includes(s.label)).slice(0, ctx.opts.tier === "bid" ? 3 : 8), pages = [];
    for (const s of samples) {
      const r = await U.fetchText(s.url); const html = r.text, nodes = [], errors = [];
      for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { flatten(JSON.parse(m[1].trim()), nodes); } catch (e) { errors.push(String(e.message).slice(0, 80)); } }
      const checks = []; for (const [t, spec] of Object.entries(REQ)) for (const n of nodes.filter((x) => matchType(x, t))) checks.push({ type: t, missing_required: spec.required.filter((k) => !hasKey(n, k)), missing_recommended: spec.recommended.filter((k) => !hasKey(n, k)) });
      const offer = nodes.find((n) => matchType(n, "Offer")); const schemaPrice = offer ? String(offer.price || offer.lowPrice || "") : null;
      const vis = html.match(/class=["'][^"']*(?:woocommerce-Price-amount|price--withoutTax|product-price|price__current|price-item)[^"']*["'][^>]*>([\s\S]{0,160}?)<\/(?:span|bdi|div|p)>/i); const visiblePrice = vis ? (U.stripTags(vis[1]).match(/[\d][\d.,' ]*\d|\d/) || [])[0] : null;
      const numeric = (p) => (p ? Number(String(p).replace(/[' ]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".")) : null);
      pages.push({ id: s.id, url: s.url, types: U.uniq(nodes.flatMap(typeOf)), parse_errors: errors, checks, microdata: /itemscope/i.test(html), schema_price: schemaPrice, visible_price: visiblePrice, price_mismatch: schemaPrice && visiblePrice && numeric(schemaPrice) && numeric(visiblePrice) ? Math.abs(numeric(schemaPrice) - numeric(visiblePrice)) > 0.01 : null, raw_text_chars: U.stripTags(html).length, h1_in_raw_html: /<h1\b/i.test(html) });
      await U.sleep(250);
    }

    // how AI crawlers are treated
    const bot = async (url) => { const a = await U.fetchText(url), b = await U.fetchText(url, { ua: U.UA_GPTBOT }); return { url, normal_status: a.status, gptbot_status: b.status, normal_text: U.stripTags(a.text).length, gptbot_text: U.stripTags(b.text).length, served_differently: a.status !== b.status || Math.abs(U.stripTags(a.text).length - U.stripTags(b.text).length) > Math.max(800, U.stripTags(a.text).length * 0.3) }; };
    const botTests = []; for (const s of samples.slice(0, 2)) botTests.push(await bot(s.url));
    const llms = await U.fetchText(site.origin + "/llms.txt", { timeout: 12000 }); const hasLlms = llms.status === 200 && !/<html/i.test(llms.text.slice(0, 300)) && llms.text.trim().length > 20;
    const ai = { robots_rules: site.robots.ai_bots, blocked: Object.entries(site.robots.ai_bots).filter(([, v]) => v === "blocked").map(([k]) => k), policy: Object.values(site.robots.ai_bots).every((v) => v === "not mentioned") ? "no AI-crawler policy stated (allowed by default)" : "deliberate rules present", llms_txt: hasLlms, gptbot_fetch: botTests };

    ctx.write("data/schema.json", { pages, ai });
    const prodPages = pages.filter((p) => /product/.test(p.id)), agg = (t, key) => U.uniq(pages.flatMap((p) => p.checks.filter((c) => c.type === t).flatMap((c) => c[key])));
    return { pages_checked: pages.length, pages_with_no_structured_data: pages.filter((p) => !p.types.length).map((p) => p.id), types_by_page: Object.fromEntries(pages.map((p) => [p.id, p.types.slice(0, 8)])), parse_errors: pages.filter((p) => p.parse_errors.length).map((p) => p.id), product: { pages: prodPages.length, with_Product: prodPages.filter((p) => p.types.includes("Product")).length, missing_required: agg("Product", "missing_required").concat(agg("Offer", "missing_required")), missing_recommended: agg("Product", "missing_recommended").concat(agg("Offer", "missing_recommended")) }, organization_missing: agg("Organization", "missing_required").concat(agg("Organization", "missing_recommended")), has_Organization: pages.some((p) => p.types.some((t) => /Organization|LocalBusiness|Store/.test(t))), has_WebSite_search: pages.some((p) => p.checks.some((c) => c.type === "WebSite" && !c.missing_recommended.includes("potentialAction"))), microdata_pages: pages.filter((p) => p.microdata).map((p) => p.id), price_mismatch: pages.filter((p) => p.price_mismatch).map((p) => `${p.id}: schema ${p.schema_price} vs page ${p.visible_price}`), h1_missing_in_raw_html: pages.filter((p) => !p.h1_in_raw_html).map((p) => p.id), ai };
  },
};
U.standalone(module.exports, module);
