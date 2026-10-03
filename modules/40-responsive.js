// 40-responsive: width sweep for overflow, a real cross-engine matrix (Chrome, Safari engine, Firefox x phone/desktop),
// tap-target and text-size checks, and the screenshots the model later reviews by eye.
const path = require("path");
const U = require("../lib/util");
const T = require("../lib/thresholds");

const WIDTHS = [320, 360, 390, 414, 768, 1024, 1280, 1440];
const OVERFLOW = () => { const vw = window.innerWidth, over = document.documentElement.scrollWidth > vw + 2; const off = []; if (over) for (const el of document.querySelectorAll("body *")) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > vw + 4 && r.left < vw && getComputedStyle(el).position !== "fixed") { off.push(el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "") + ` (+${Math.round(r.right - vw)}px)`); if (off.length >= 3) break; } } return { over, scroll_w: document.documentElement.scrollWidth, vw, off }; };
const TAPS = (min) => { const vis = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; }; const els = [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, [role=button]")].filter(vis); const small = els.filter((el) => { const r = el.getBoundingClientRect(); return (r.width < min || r.height < min) && !(el.tagName === "A" && el.closest("p, li, td")); }); const sizes = {}; for (const p of document.querySelectorAll("p, li")) if (vis(p) && (p.innerText || "").length > 40) { const f = Math.round(parseFloat(getComputedStyle(p).fontSize)); sizes[f] = (sizes[f] || 0) + 1; } const body = Object.entries(sizes).sort((a, b) => b[1] - a[1])[0]; return { controls: els.length, small: small.length, small_eg: small.slice(0, 4).map((el) => { const r = el.getBoundingClientRect(); return `${(el.getAttribute("aria-label") || el.innerText || el.className || el.tagName).toString().trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`; }), body_font_px: body ? Number(body[0]) : null }; };

module.exports = {
  id: "40-responsive", name: "Responsive, cross-browser, screenshots", tiers: ["bid", "full"],
  async run(ctx) {
    const bid = ctx.opts.tier === "bid", pw = require("playwright"), samples = ctx.samples.filter((s) => s.label !== "checkout" || !s.guessed).slice(0, bid ? 2 : 6), shots = [], matrix = [], sweep = [];
    const engines = []; for (const e of bid ? ["chromium"] : ["chromium", "webkit", "firefox"]) { try { const b = await pw[e].launch({ headless: true }); engines.push([e, b]); } catch { ctx.log(`${e} not installed, skipped (npx playwright install ${e})`); } }
    const shot = async (page, name, caption, full) => { const file = path.join(ctx.shotDir, name + ".jpg"); try { await page.screenshot({ path: file, type: "jpeg", quality: 62, fullPage: !!full, timeout: 45000 }); shots.push({ file: "screenshots/" + name + ".jpg", caption, full: !!full }); } catch {} };

    for (const [ename, browser] of engines) {
      for (const device of ["mobile", "desktop"]) {
        const opts = device === "mobile" ? (ename === "firefox" ? { viewport: { width: 393, height: 851 }, userAgent: U.UA_MOBILE } : ename === "webkit" ? Object.assign({}, pw.devices["iPhone 13"]) : U.MOBILE_CTX) : U.DESKTOP_CTX;
        const context = await browser.newContext(opts);
        for (const s of samples) {
          const page = await context.newPage(), errs = [], perrs = []; page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 120)); }); page.on("pageerror", (e) => perrs.push(String(e.message).slice(0, 120)));
          const cell = { engine: ename, device, id: s.id };
          try { const resp = await page.goto(s.url, { waitUntil: "load", timeout: 75000 }); cell.status = resp ? resp.status() : null; await U.sleep(2200);
            if (ename === "chromium" && device === "mobile" && s === samples[0]) await shot(page, `first-view-${s.id}-phone`, `${s.id} phone, as first seen (banner included)`);
            const banner = await U.dismissBanners(page); if (banner) await U.sleep(500);
            const o = await page.evaluate(OVERFLOW); cell.overflow = o.over; cell.overflow_offenders = o.off; cell.console_errors = errs.length; cell.page_errors = perrs.length; cell.error_eg = U.top(U.uniq(perrs.concat(errs)), 2);
            await shot(page, `${ename}-${device}-${s.id}`, `${s.id} ${ename === "webkit" ? "Safari engine" : ename} ${device}`);
            if (ename === "chromium") { await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 900) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)); } window.scrollTo(0, 0); }).catch(() => {}); await U.sleep(500); await shot(page, `full-${device}-${s.id}`, `${s.id} full page, ${device}`, true);
              if (device === "mobile") { cell.taps = await page.evaluate(TAPS, T.TAP_TARGET_PX); cell.viewport_meta = await page.evaluate(() => (document.querySelector('meta[name="viewport"]') || {}).content || null); } }
          } catch (e) { cell.error = String(e.message).split("\n")[0].slice(0, 120); }
          matrix.push(cell); await page.close();
        }
        await context.close();
      }
    }
    // width sweep, Chromium only, first two samples
    const chromium = engines.find(([n]) => n === "chromium"); if (chromium) for (const s of samples.slice(0, 2)) { const context = await chromium[1].newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage(); try { await page.goto(s.url, { waitUntil: "load", timeout: 75000 }); await U.sleep(1500); await U.dismissBanners(page); for (const w of WIDTHS) { await page.setViewportSize({ width: w, height: 900 }); await U.sleep(450); const o = await page.evaluate(OVERFLOW); sweep.push({ id: s.id, width: w, overflow: o.over, by_px: o.over ? o.scroll_w - o.vw : 0, offenders: o.off }); } } catch {} await context.close(); }
    for (const [, b] of engines) await b.close();
    ctx.write("data/responsive.json", { matrix, sweep, shots }); ctx.write("data/shots.json", shots);

    const bad = matrix.filter((c) => c.overflow || c.error), taps = matrix.filter((c) => c.taps);
    return { engines_tested: engines.map(([n]) => (n === "webkit" ? "webkit (Safari engine)" : n)), cells: matrix.length, cells_with_layout_overflow: matrix.filter((c) => c.overflow).map((c) => `${c.engine}/${c.device}/${c.id}: ${c.overflow_offenders.join(", ")}`), cells_failed_to_load: matrix.filter((c) => c.error).map((c) => `${c.engine}/${c.device}/${c.id}: ${c.error}`), clean_cells: matrix.length - bad.length, console_errors_by_engine: Object.fromEntries(engines.map(([n]) => [n, matrix.filter((c) => c.engine === n).reduce((s, c) => s + (c.console_errors || 0) + (c.page_errors || 0), 0)])), error_examples: U.top(U.uniq(matrix.flatMap((c) => c.error_eg || [])), 4), width_sweep_overflow: sweep.filter((x) => x.overflow).map((x) => `${x.id} at ${x.width}px: +${x.by_px}px (${x.offenders.join(", ")})`), width_sweep_clean: sweep.length > 0 && !sweep.some((x) => x.overflow), tap_targets: taps.map((c) => `${c.id}: ${c.taps.small} of ${c.taps.controls} controls under ${T.TAP_TARGET_PX}px (${c.taps.small_eg.join("; ")})`), body_text_px: U.uniq(taps.map((c) => c.taps.body_font_px).filter(Boolean)), viewport_meta: (taps[0] || {}).viewport_meta || null, zoom_disabled: /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test((taps[0] || {}).viewport_meta || ""), screenshots: shots.length, needs_model: "Review the contact sheets in sheets/ for what scripts cannot judge: hierarchy, contrast, spacing, typography, photography, mobile treated as an afterthought, banner covering the call to action." };
  },
};
U.standalone(module.exports, module);
