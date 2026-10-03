// 38-benchmark: puts the site's numbers in context against its own platform.
// Tries the HTTP Archive API, falls back to the dated table in lib/thresholds.js.
const U = require("../lib/util");
const T = require("../lib/thresholds");

const NAME = { wordpress: "WordPress", shopify: "Shopify", bigcommerce: "BigCommerce", wix: "Wix", squarespace: "Squarespace" };

module.exports = {
  id: "38-benchmark", name: "Platform benchmark", tiers: ["bid", "full"],
  async run(ctx) {
    const fp = ctx.site.fingerprint, tech = fp.platform === "wordpress" && fp.shop ? "WooCommerce" : NAME[fp.platform];
    if (!tech) return U.skipped("no benchmark for this platform");
    let live = null; const r = await U.getJson(`https://reports-api.httparchive.org/v1/cwv?technology=${encodeURIComponent(tech)}&geo=ALL&rank=ALL`, { timeout: 12000 });
    if (r.ok && Array.isArray(r.json) && r.json.length) { const latest = r.json.sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]; const m = (latest.vitals || []).find((v) => v.name === "overall"); if (m && m.mobile && m.mobile.tested) live = { as_of: latest.date, pct: U.round((m.mobile.good_number / m.mobile.tested) * 100) }; }
    const tbl = T.PLATFORM_CWV_PASS;
    return { platform: tech, mobile_cwv_pass_rate_pct: live ? live.pct : tbl[tech], as_of: live ? live.as_of : tbl.asOf, source: live ? "HTTP Archive API (live)" : "HTTP Archive Core Web Vitals Technology Report (dated table)", how_to_use: "A site that fails Core Web Vitals sits with the failing share of its platform; one that passes is ahead of most sites built the same way." };
  },
};
U.standalone(module.exports, module);
