// 33-inp: taps real controls on a CPU-throttled phone profile and times how long the page takes to respond,
// then uses Long Animation Frames to name the script that held the main thread. Nothing is submitted, nothing is bought.
const U = require("../lib/util");
const T = require("../lib/thresholds");

const INIT = `
  window.__i = { events: [], loaf: [] };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__i.events.push({ id: e.interactionId, name: e.name, dur: e.duration, start: e.startTime, delay: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart }); }).observe({ type: "event", durationThreshold: 16, buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__i.loaf.push({ start: e.startTime, dur: e.duration, blocking: e.blockingDuration, scripts: (e.scripts || []).map((s) => ({ src: s.sourceURL || s.invoker || "inline", dur: s.duration, fn: s.sourceFunctionName || null })) }); }).observe({ type: "long-animation-frame", buffered: true }); } catch (e) {}
`;
// controls that open or toggle something without navigating away or submitting a form
const SELECTOR = ["button[aria-expanded]", "[aria-controls]:not(a[href^='http'])", ".menu-toggle", ".navbar-toggler", "[class*='hamburger']", "[class*='burger']", "[class*='menu-button']", "summary", "[role='tab']", ".accordion-button", "[class*='accordion'] button", "button[class*='search']", "[class*='quantity'] button", ".plus", "[class*='filter'] button", "[class*='swiper-button-next']", "[class*='slick-next']"].join(",");

module.exports = {
  id: "33-inp", name: "Interaction responsiveness (INP) with script blame", tiers: ["full"],
  async run(ctx) {
    const site = ctx.site, samples = ctx.samples.filter((s) => ["home", "product", "category", "shop"].includes(s.label)).slice(0, 4), browser = await U.launch(), out = [];
    for (const s of samples) {
      const context = await browser.newContext(U.MOBILE_CTX), page = await context.newPage(); await page.addInitScript(INIT);
      const cdp = await context.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      const rec = { id: s.id, interactions: [] };
      try {
        await page.goto(s.url, { waitUntil: "load", timeout: 90000 }); await U.sleep(3000); await U.dismissBanners(page); await U.sleep(600);
        const handles = await page.$$(SELECTOR); let done = 0;
        for (const h of handles) {
          if (done >= 6) break;
          try { if (!(await h.isVisible())) continue; const box = await h.boundingBox(); if (!box || box.width < 8 || box.height < 8) continue;
            const label = await h.evaluate((el) => (el.getAttribute("aria-label") || el.innerText || el.className || el.tagName).toString().trim().replace(/\s+/g, " ").slice(0, 40)); const before = page.url();
            const mark = await page.evaluate(() => performance.now()); await h.tap({ timeout: 2500 }).catch(() => h.click({ timeout: 2500 })); await U.sleep(900);
            if (page.url() !== before) { await page.goBack({ waitUntil: "load" }).catch(() => {}); continue; }
            const r = await page.evaluate((m) => { const ev = window.__i.events.filter((e) => e.start >= m - 5); if (!ev.length) return null; const worst = ev.sort((a, b) => b.dur - a.dur)[0]; const frames = window.__i.loaf.filter((f) => f.start + f.dur >= worst.start && f.start <= worst.start + worst.dur); const scripts = frames.flatMap((f) => f.scripts).sort((a, b) => b.dur - a.dur); return { ms: Math.round(worst.dur), input_delay: Math.round(worst.delay), processing: Math.round(worst.proc), script: scripts[0] ? { src: scripts[0].src, ms: Math.round(scripts[0].dur), fn: scripts[0].fn } : null }; }, mark);
            if (r) { rec.interactions.push(Object.assign({ control: label }, r)); done++; }
          } catch {}
        }
        rec.load_long_frames = await page.evaluate(() => { const by = {}; for (const f of window.__i.loaf) for (const s of f.scripts) { const k = s.src.split("?")[0]; by[k] = (by[k] || 0) + s.dur; } return Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([src, ms]) => ({ src, ms: Math.round(ms) })); });
      } catch (e) { rec.error = String(e.message).split("\n")[0].slice(0, 140); }
      out.push(rec); await context.close();
    }
    await browser.close(); ctx.write("data/inp.json", out);
    const short = (u) => { try { const x = new URL(u); return (U.sameSite(u, site.host) ? "" : x.hostname + " ") + x.pathname.split("/").slice(-2).join("/"); } catch { return String(u).slice(0, 60); } };
    const all = out.flatMap((p) => p.interactions.map((i) => Object.assign({ page: p.id }, i))).sort((a, b) => b.ms - a.ms);
    return { profile: "Lab. 4x CPU slowdown, phone viewport. Google's target for real visitors is 200 ms.", interactions_tested: all.length, slower_than_200ms: all.filter((i) => i.ms > T.INP_GOOD_MS).length, worst: U.top(all, 5).map((i) => `${i.ms} ms on ${i.page} tapping "${i.control}"${i.script ? `, held by ${short(i.script.src)} (${i.script.ms} ms)` : ""}`), main_thread_hogs_during_load: Object.fromEntries(out.filter((p) => p.load_long_frames && p.load_long_frames.length).map((p) => [p.id, p.load_long_frames.slice(0, 3).map((x) => `${x.ms} ms ${short(x.src)}`)])), errors: out.filter((p) => p.error).map((p) => `${p.id}: ${p.error}`), note: all.length ? undefined : "No tappable non-navigating controls were found automatically; test the menu and add-to-cart by hand if INP matters for this client." };
  },
};
U.standalone(module.exports, module);
