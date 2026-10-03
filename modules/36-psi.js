// 36-psi: Google's own Lighthouse run, so the numbers match what the client sees when they test the site themselves.
// Needs GOOGLE_API_KEY (the keyless pool is exhausted most days). Our own lab run in 30-perf never depends on this.
const U = require("../lib/util");

module.exports = {
  id: "36-psi", name: "PageSpeed Insights (Google Lighthouse)", tiers: ["full"],
  async run(ctx) {
    const key = ctx.env.GOOGLE_API_KEY; if (!key) return U.skipped("no GOOGLE_API_KEY (free; see .env.example)");
    const out = {};
    for (const s of ctx.samples.filter((x) => !["cart", "checkout"].includes(x.label)).slice(0, 3)) {
      const u = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(s.url)}&strategy=mobile&category=performance&category=seo&category=best-practices&category=accessibility&key=${key}`;
      const r = await U.getJson(u, { timeout: 120000 }); if (!r.ok) { out[s.id] = `error ${r.status}`; continue; }
      ctx.write(`data/psi/${s.id}.json`, r.json);
      const lh = r.json.lighthouseResult, a = lh.audits, sc = (c) => Math.round(((lh.categories[c] || {}).score || 0) * 100);
      const failed = Object.values(a).filter((x) => x.score !== null && x.score < 0.5 && x.details && (x.details.overallSavingsMs > 100 || x.details.overallSavingsBytes > 20000)).sort((x, y) => (y.details.overallSavingsMs || 0) - (x.details.overallSavingsMs || 0)).slice(0, 6).map((x) => `${x.title}${x.details.overallSavingsMs ? ` (~${Math.round(x.details.overallSavingsMs)} ms)` : ""}`);
      out[s.id] = { scores: { performance: sc("performance"), seo: sc("seo"), best_practices: sc("best-practices"), accessibility: sc("accessibility") }, lcp: a["largest-contentful-paint"].displayValue, tbt: a["total-blocking-time"].displayValue, cls: a["cumulative-layout-shift"].displayValue, top_opportunities: failed };
    }
    return { strategy: "mobile", pages: out };
  },
};
U.standalone(module.exports, module);
