// 90-findings: applies lib/rules.js to the module summaries and produces drafted, scored, ranked findings.
// Merges model-findings.json (what only the model can see) when present. Enforces the evidence gate.
const U = require("../lib/util");
const { RULES } = require("../lib/rules");

const KEYS = { discover: "00-discover", crawl: "10-crawl", analyze: "11-analyze", links: "12-links", headers: "20-headers", dns: "21-dns", subs: "22-subdomains", wayback: "23-wayback", perf: "30-perf", cache: "31-cache", coverage: "32-coverage", inp: "33-inp", thirdparty: "34-thirdparty", crux: "35-crux", psi: "36-psi", globalping: "37-globalping", benchmark: "38-benchmark", responsive: "40-responsive", a11y: "41-a11y", wp: "50-wp", exposure: "51-exposure", tracking: "60-tracking", schema: "70-schema-ai", commerce: "80-commerce" };
const SEV = { Critical: 0, High: 1, Medium: 2, Low: 3 }, EFFORT_W = { Low: 1, Med: 1.6, High: 2.5 };
const csv = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
const val = (x, r) => (typeof x === "function" ? x(r) : x);

function loadSummaries(ctx) { const S = {}; for (const [k, id] of Object.entries(KEYS)) { const s = ctx.summary(id); if (s && s.status !== "skipped" && s.status !== "failed") S[k] = s; } return S; }

module.exports = {
  id: "90-findings", name: "Draft, score and rank findings", tiers: ["bid", "full"], loadSummaries, KEYS,
  async run(ctx) {
    const S = loadSummaries(ctx); if (!S.discover) return { status: "failed", reason: "no discover summary" };
    const findings = [], good = [], ruleErrors = [];
    for (const rule of RULES) {
      let r; try { r = rule.test(S); } catch (e) { ruleErrors.push(`${rule.id}: ${e.message}`); continue; } if (!r) continue;
      if (rule.good) { good.push({ area: rule.area, title: rule.title, value: r.value, module: rule.module }); continue; }
      r.total = (S.analyze && S.analyze.pages) || S.discover.urls_found || 1;
      findings.push({ rule: rule.id, module: rule.module, area: rule.area, title: val(rule.title, r), severity: val(rule.severity, r), impact: rule.impact, effort: rule.effort, reach_urls: r.reach || 1, evidence_url: r.url || S.discover.origin, evidence_value: r.value, why_it_matters: val(rule.why, r), recommended_fix: val(rule.fix, r), source: "rule", needs_access: false, fact_check: !!rule.fact_check });
    }
    const model = ctx.read("model-findings.json", []); for (const m of Array.isArray(model) ? model : []) findings.push(Object.assign({ source: "model", module: "model", effort: "Med", impact: 60, severity: "Medium", reach_urls: 1, evidence_url: S.discover.origin, needs_access: false }, m));

    for (const f of findings) f.priority_score = U.round((f.impact * (1 + Math.log10(Math.max(1, f.reach_urls)) / 3)) / (EFFORT_W[f.effort] || 1.6), 1);
    findings.sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.priority_score - a.priority_score);
    const counters = { Critical: 0, High: 0, Medium: 0, Low: 0 }; findings.forEach((f, i) => { counters[f.severity]++; f.id = `${f.severity[0]}${counters[f.severity]}`; f.priority_rank = i + 1; f.quick_win = f.impact >= 60 && f.effort === "Low"; });

    // evidence gate: nothing without a value and a place to check it
    const gate = findings.filter((f) => !f.evidence_value || !f.evidence_url || !f.recommended_fix || !f.why_it_matters).map((f) => f.id + " " + f.title);
    // scorecard: one line per area, worst severity wins, good areas listed with the reason
    const areas = {}; for (const f of findings) if (!areas[f.area] || SEV[f.severity] < SEV[areas[f.area].status]) areas[f.area] = { area: f.area, status: f.severity, takeaway: f.title };
    for (const g of good) if (!areas[g.area]) areas[g.area] = { area: g.area, status: "Good", takeaway: `${g.title}: ${g.value}` };
    const scorecard = Object.values(areas).sort((a, b) => (SEV[a.status] ?? 9) - (SEV[b.status] ?? 9));

    ctx.write("findings.json", { findings, good, scorecard });
    const cols = ["id", "module", "area", "title", "severity", "impact", "effort", "reach_urls", "evidence_url", "evidence_value", "why_it_matters", "recommended_fix", "priority_rank", "quick_win"];
    ctx.write("findings.csv", [cols.join(","), ...findings.map((f) => cols.map((c) => csv(f[c])).join(","))].join("\n"));
    return { findings: findings.length, by_severity: counters, quick_wins: findings.filter((f) => f.quick_win).length, good_areas: good.length, from_model: findings.filter((f) => f.source === "model").length, need_fact_check: findings.filter((f) => f.fact_check).map((f) => f.id), evidence_gate: gate.length ? { FAILED: gate } : "passed", rule_errors: ruleErrors, modules_with_data: Object.keys(S).length };
  },
};
U.standalone(module.exports, module);
