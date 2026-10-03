// 35-crux: what Google recorded from the site's REAL Chrome visitors over the last 28 days, plus ~25 weeks of history.
// Field data, not lab. Needs GOOGLE_API_KEY (free). Small sites may have no record; that is reported, not an error.
const U = require("../lib/util");
const T = require("../lib/thresholds");

const METRICS = { largest_contentful_paint: "lcp_ms", interaction_to_next_paint: "inp_ms", cumulative_layout_shift: "cls", experimental_time_to_first_byte: "ttfb_ms", first_contentful_paint: "fcp_ms" };
const GOOD = { lcp_ms: T.LCP_GOOD_MS, inp_ms: T.INP_GOOD_MS, cls: T.CLS_GOOD, ttfb_ms: T.TTFB_GOOD_MS, fcp_ms: T.FCP_GOOD_MS };

function readRecord(rec) {
  const out = {};
  for (const [m, k] of Object.entries(METRICS)) {
    const x = rec.metrics[m]; if (!x) continue; const h = x.histogram || [];
    out[k] = { p75: Number(x.percentiles.p75), good_pct: U.round((h[0] ? h[0].density : 0) * 100), poor_pct: U.round((h[2] ? h[2].density : 0) * 100), passes: Number(x.percentiles.p75) <= GOOD[k] };
  }
  out.core_web_vitals_pass = ["lcp_ms", "inp_ms", "cls"].every((k) => !out[k] || out[k].passes);
  return out;
}

module.exports = {
  id: "35-crux", name: "Real-visitor data (CrUX) + 25-week history", tiers: ["bid", "full"],
  async run(ctx) {
    const key = ctx.env.GOOGLE_API_KEY; if (!key) return U.skipped("no GOOGLE_API_KEY (free; see .env.example)");
    const site = ctx.site, api = (p) => `https://chromeuxreport.googleapis.com/v1/records:${p}?key=${key}`, out = { origin: {}, urls: {}, history: null };
    for (const ff of ["PHONE", "DESKTOP"]) { const r = await U.postJson(api("queryRecord"), { origin: site.origin, formFactor: ff }); out.origin[ff.toLowerCase()] = r.ok ? readRecord(r.json.record) : r.status === 404 ? "no data (not enough Chrome traffic)" : `error ${r.status}`; }
    for (const s of ctx.samples.slice(0, 6)) { const r = await U.postJson(api("queryRecord"), { url: s.url.split("?")[0], formFactor: "PHONE" }); out.urls[s.id] = r.ok ? readRecord(r.json.record) : r.status === 404 ? "no data" : `error ${r.status}`; }
    const h = await U.postJson(api("queryHistoryRecord"), { origin: site.origin, formFactor: "PHONE", metrics: Object.keys(METRICS) });
    if (h.ok) {
      const rec = h.json.record, weeks = rec.collectionPeriods.map((p) => `${p.lastDate.year}-${String(p.lastDate.month).padStart(2, "0")}-${String(p.lastDate.day).padStart(2, "0")}`), hist = { weeks };
      for (const [m, k] of Object.entries(METRICS)) {
        const x = rec.metrics[m]; if (!x) continue; const p = x.percentilesTimeseries.p75s.map((v) => (v == null ? null : Number(v))); const valid = p.filter((v) => v != null); if (!valid.length) continue;
        let worstJump = { delta: 0 }; for (let i = 1; i < p.length; i++) if (p[i] != null && p[i - 1] != null && p[i] - p[i - 1] > worstJump.delta) worstJump = { delta: U.round(p[i] - p[i - 1], 3), week: weeks[i], from: p[i - 1], to: p[i] };
        hist[k] = { first: valid[0], latest: valid[valid.length - 1], best: Math.min(...valid), worst: Math.max(...valid), trend: valid[valid.length - 1] > valid[0] * 1.1 ? "getting worse" : valid[valid.length - 1] < valid[0] * 0.9 ? "improving" : "flat", biggest_single_week_regression: worstJump.delta ? worstJump : null, series: p };
      }
      out.history = hist;
    }
    ctx.write("data/crux.json", out);
    const compact = (o) => (typeof o === "string" ? o : Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && v.p75 != null ? `p75 ${v.p75} (${v.good_pct}% good, ${v.poor_pct}% poor)${v.passes ? "" : " FAILS"}` : v])));
    const hs = out.history ? Object.fromEntries(Object.entries(out.history).filter(([k]) => k !== "weeks").map(([k, v]) => [k, { first: v.first, latest: v.latest, trend: v.trend, worst_week: v.biggest_single_week_regression }])) : "no history";
    return { source: "Chrome UX Report: real visitors, 28-day window", origin_phone: compact(out.origin.phone), origin_desktop: compact(out.origin.desktop), per_page_phone: Object.fromEntries(Object.entries(out.urls).map(([k, v]) => [k, compact(v)])), history_weeks: out.history ? out.history.weeks.length : 0, history: hs };
  },
};
U.standalone(module.exports, module);
