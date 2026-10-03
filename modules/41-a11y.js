// 41-a11y: automated accessibility scan (axe-core) on each key template plus a real keyboard walk.
// Automated checks find roughly a third of accessibility problems. This never claims legal conformance.
const fs = require("fs");
const U = require("../lib/util");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const FOCUS = () => { const el = document.activeElement; if (!el || el === document.body) return null; const r = el.getBoundingClientRect(), s = getComputedStyle(el); const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), cy = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1); const top = document.elementFromPoint(cx, cy); const inView = r.bottom > 0 && r.top < innerHeight && r.width > 0; return { key: el.tagName + "|" + (el.id || "") + "|" + (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 30) + "|" + Math.round(r.top + scrollY), label: (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("title") || el.tagName).toString().trim().replace(/\s+/g, " ").slice(0, 40), visible_ring: (parseFloat(s.outlineWidth) > 0 && s.outlineStyle !== "none") || (s.boxShadow && s.boxShadow !== "none"), in_view: inView, obscured: inView && top && !(el === top || el.contains(top) || top.contains(el)), has_name: !!(el.getAttribute("aria-label") || (el.innerText || "").trim() || el.getAttribute("title") || el.value || el.querySelector("img[alt]:not([alt=''])")) }; };

module.exports = {
  id: "41-a11y", name: "Accessibility: axe-core + keyboard walk", tiers: ["full"],
  async run(ctx) {
    const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"), samples = ctx.samples.filter((s) => !s.guessed).slice(0, 6), browser = await U.launch(), pages = [];
    const context = await browser.newContext(Object.assign({}, U.DESKTOP_CTX, { bypassCSP: true }));
    for (const s of samples) {
      const page = await context.newPage(), rec = { id: s.id };
      try {
        await page.goto(s.url, { waitUntil: "load", timeout: 75000 }); await U.sleep(2000); await U.dismissBanners(page); await U.sleep(400);
        await page.evaluate(axeSrc); const res = await page.evaluate((tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] }), TAGS);
        rec.violations = res.violations.map((v) => ({ rule: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, eg: (v.nodes[0].target || []).join(" ").slice(0, 90), wcag: v.tags.filter((t) => /^wcag\d{3,}/.test(t)).slice(0, 2) }));
        if (s === samples[0]) { // keyboard walk on the homepage
          await page.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement) document.activeElement.blur(); }); const steps = []; for (let i = 0; i < 40; i++) { await page.keyboard.press("Tab"); await U.sleep(90); steps.push(await page.evaluate(FOCUS)); }
          const real = steps.filter(Boolean); let trap = null; for (let i = 3; i < real.length; i++) if (real[i].key === real[i - 1].key && real[i].key === real[i - 2].key) { trap = real[i].label; break; }
          rec.keyboard = { tab_stops: real.length, first_stop: real[0] ? real[0].label : null, skip_link: !!(real[0] && /skip|spring naar|zum inhalt|aller au contenu|direkt zum/i.test(real[0].label)), no_visible_focus_ring: real.filter((x) => !x.visible_ring).length, focus_hidden_behind_something: real.filter((x) => x.obscured).length, focus_off_screen: real.filter((x) => !x.in_view).length, controls_without_a_name: real.filter((x) => !x.has_name).length, possible_trap_at: trap, eg_no_ring: U.top(real.filter((x) => !x.visible_ring).map((x) => x.label), 3) };
        }
      } catch (e) { rec.error = String(e.message).split("\n")[0].slice(0, 140); }
      pages.push(rec); await page.close();
    }
    await browser.close(); ctx.write("data/a11y.json", pages);
    const byRule = {}; for (const p of pages) for (const v of p.violations || []) { const r = (byRule[v.rule] = byRule[v.rule] || { rule: v.rule, impact: v.impact, help: v.help, wcag: v.wcag, nodes: 0, pages: [], eg: v.eg }); r.nodes += v.nodes; r.pages.push(p.id); }
    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 }, rules = Object.values(byRule).sort((a, b) => order[a.impact] - order[b.impact] || b.nodes - a.nodes);
    return { scope: "Automated axe-core scan (WCAG 2.0/2.1/2.2 A and AA rules plus best practice) and a 40-step keyboard walk on the homepage. Automated checks catch roughly a third of real problems; this is not a conformance statement.", pages_scanned: pages.filter((p) => !p.error).length, distinct_rules_failed: rules.length, by_impact: rules.reduce((m, r) => ((m[r.impact] = (m[r.impact] || 0) + 1), m), {}), top_rules: U.top(rules, 10).map((r) => `[${r.impact}] ${r.help}: ${r.nodes} elements on ${r.pages.length} page(s) ${r.wcag.join(" ")} e.g. ${r.eg}`), site_wide_rules: rules.filter((r) => r.pages.length === pages.filter((p) => !p.error).length && pages.length > 1).map((r) => r.rule), keyboard: (pages[0] || {}).keyboard || null, errors: pages.filter((p) => p.error).map((p) => `${p.id}: ${p.error}`) };
  },
};
U.standalone(module.exports, module);
