// 32-coverage: how much of the CSS and JavaScript each template downloads is never used on that page.
// Chrome DevTools coverage, per template, in bytes. This is what page-builder and plugin bloat looks like as a number.
const U = require("../lib/util");

module.exports = {
  id: "32-coverage", name: "Unused CSS and JavaScript", tiers: ["full"],
  async run(ctx) {
    const samples = ctx.samples.filter((s) => !["cart", "checkout"].includes(s.label)).slice(0, 5), browser = await U.launch(), out = [];
    for (const s of samples) {
      const context = await browser.newContext(U.MOBILE_CTX), page = await context.newPage();
      try {
        await page.coverage.startJSCoverage({ resetOnNavigation: false }); await page.coverage.startCSSCoverage({ resetOnNavigation: false });
        await page.goto(s.url, { waitUntil: "load", timeout: 90000 }); await U.sleep(2500);
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } }).catch(() => {}); await U.sleep(800);
        const [js, css] = [await page.coverage.stopJSCoverage(), await page.coverage.stopCSSCoverage()];
        // CSS gives flat used ranges. JS gives nested function ranges with hit counts: paint outer first, inner overrides.
        const used = (e) => { if (e.ranges) return e.ranges.reduce((n, r) => n + (r.end - r.start), 0); const len = (e.source || "").length, mark = new Uint8Array(len); const rs = (e.functions || []).flatMap((f) => f.ranges).sort((a, b) => b.endOffset - b.startOffset - (a.endOffset - a.startOffset)); for (const r of rs) mark.fill(r.count > 0 ? 1 : 0, r.startOffset, Math.min(r.endOffset, len)); let n = 0; for (let i = 0; i < len; i++) n += mark[i]; return n; };
        const files = [...js.map((e) => ({ kind: "js", url: e.url, total: (e.source || e.text || "").length, used: Math.min(used(e), (e.source || e.text || "").length) })), ...css.map((e) => ({ kind: "css", url: e.url, total: (e.text || "").length, used: used(e) }))].filter((f) => f.total > 2000 && /^https?:/.test(f.url));
        const sum = (k, f) => files.filter((x) => x.kind === k).reduce((n, x) => n + f(x), 0);
        out.push({ id: s.id, js_kb: Math.round(sum("js", (x) => x.total) / 1024), js_unused_kb: Math.round(sum("js", (x) => x.total - x.used) / 1024), css_kb: Math.round(sum("css", (x) => x.total) / 1024), css_unused_kb: Math.round(sum("css", (x) => x.total - x.used) / 1024), worst: files.sort((a, b) => b.total - b.used - (a.total - a.used)).slice(0, 5).map((f) => `${Math.round((f.total - f.used) / 1024)} of ${Math.round(f.total / 1024)} KB unused: ${f.url.split("?")[0].split("/").slice(-3).join("/")}`) });
      } catch (e) { out.push({ id: s.id, error: String(e.message).split("\n")[0].slice(0, 140) }); }
      await context.close();
    }
    await browser.close(); ctx.write("data/coverage.json", out);
    return { note: "Uncompressed source bytes, measured after a full scroll on a phone profile. Code used only after a click counts as unused here.", pages: out.map((p) => (p.error ? p : { id: p.id, css: `${p.css_unused_kb} of ${p.css_kb} KB unused (${U.pct(p.css_unused_kb, p.css_kb)}%)`, js: `${p.js_unused_kb} of ${p.js_kb} KB unused (${U.pct(p.js_unused_kb, p.js_kb)}%)`, css_unused_pct: U.pct(p.css_unused_kb, p.css_kb), js_unused_pct: U.pct(p.js_unused_kb, p.js_kb) })), worst_files_home: out[0] && out[0].worst };
  },
};
U.standalone(module.exports, module);
