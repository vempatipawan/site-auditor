// 30-perf: lab measurement in a real Chromium. Throttled mid-range phone + desktop, median of 3 runs per page.
// Names the LCP element, the elements that shift, the render-blocking files, the heavy images and the third parties.
// Lab data: always reported as such, never as what real visitors experienced (that is 35-crux).
const U = require("../lib/util");
const T = require("../lib/thresholds");

const OBSERVERS = `
  window.__a = { lcp: null, cls: 0, tbt: 0, shifts: [] };
  const desc = (el) => { if (!el || !el.tagName) return null; const r = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), id: el.id || null, cls: (el.className && el.className.baseVal === undefined ? String(el.className) : "").trim().split(/\\s+/).slice(0, 3).join("."), src: el.currentSrc || el.src || ((getComputedStyle(el).backgroundImage || "").match(/url\\(["']?([^"')]+)/) || [])[1] || null, natural_w: el.naturalWidth || null, shown_w: Math.round(r.width), loading: el.getAttribute && el.getAttribute("loading"), fetchpriority: el.getAttribute && el.getAttribute("fetchpriority"), text: (el.innerText || "").trim().slice(0, 60) || null }; };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__a.lcp = { t: e.startTime, size: e.size, url: e.url || null, el: desc(e.element) }; }).observe({ type: "largest-contentful-paint", buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__a.cls += e.value; for (const s of e.sources || []) { const d = desc(s.node); if (d) window.__a.shifts.push({ v: e.value, el: d.tag + (d.id ? "#" + d.id : "") + (d.cls ? "." + d.cls : "") }); } } }).observe({ type: "layout-shift", buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration > 50) window.__a.tbt += e.duration - 50; }).observe({ type: "longtask", buffered: true }); } catch (e) {}
`;

async function oneRun(browser, url, mode, host, deep) {
  const mobile = mode === "mobile", context = await browser.newContext(mobile ? U.MOBILE_CTX : U.DESKTOP_CTX), page = await context.newPage();
  await page.addInitScript(OBSERVERS);
  const cdp = mobile ? await U.throttleMobile(context, page) : await context.newCDPSession(page); if (!mobile) await cdp.send("Network.enable");
  const reqs = new Map(); cdp.on("Network.responseReceived", (e) => reqs.set(e.requestId, { url: e.response.url, type: e.type, mime: e.response.mimeType, status: e.response.status, proto: e.response.protocol, bytes: 0 })); cdp.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });
  const rec = { mode };
  try {
    const resp = await page.goto(url, { waitUntil: "load", timeout: 90000 }); rec.status = resp ? resp.status() : null;
    await U.sleep(mobile ? 5000 : 3000); await page.evaluate(() => window.scrollTo(0, 400)).catch(() => {}); await U.sleep(1200);
    const m = await page.evaluate(() => { const nav = performance.getEntriesByType("navigation")[0] || {}, a = window.__a || {}; const agg = {}; for (const s of a.shifts || []) agg[s.el] = (agg[s.el] || 0) + s.v;
      return { ttfb: nav.responseStart, fcp: (performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime || null, lcp: a.lcp ? a.lcp.t : null, lcp_el: a.lcp ? Object.assign({ url: a.lcp.url }, a.lcp.el) : null, cls: a.cls || 0, tbt: a.tbt || 0, dom_nodes: document.getElementsByTagName("*").length, rendered_text_chars: (document.body.innerText || "").length,
        blocking: performance.getEntriesByType("resource").filter((r) => r.renderBlockingStatus === "blocking").map((r) => r.name), shift_sources: Object.entries(agg).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([el, v]) => `${el} (${v.toFixed(3)})`) }; });
    Object.assign(rec, m);
    const list = [...reqs.values()], kb = (f) => Math.round(list.filter(f).reduce((s, r) => s + r.bytes, 0) / 1024);
    rec.requests = list.length; rec.kb = kb(() => true); rec.js_kb = kb((r) => r.type === "Script"); rec.css_kb = kb((r) => r.type === "Stylesheet"); rec.img_kb = kb((r) => r.type === "Image"); rec.font_kb = kb((r) => r.type === "Font"); rec.third_party_kb = kb((r) => !U.sameSite(r.url, host));
    if (deep) {
      const tp = {}; for (const r of list) if (!U.sameSite(r.url, host)) { const h = U.hostOf(r.url); tp[h] = tp[h] || { kb: 0, n: 0 }; tp[h].kb += r.bytes / 1024; tp[h].n++; }
      rec.third_parties = Object.entries(tp).sort((a, b) => b[1].kb - a[1].kb).slice(0, 8).map(([h, v]) => ({ host: h, kb: Math.round(v.kb), requests: v.n }));
      rec.protocols = U.uniq(list.map((r) => r.proto).filter(Boolean)); rec.errors_4xx_5xx = list.filter((r) => r.status >= 400).map((r) => `${r.status} ${r.url.slice(0, 110)}`).slice(0, 6);
      const mimeOf = new Map(list.filter((r) => r.type === "Image").map((r) => [r.url, r]));
      const imgs = await page.evaluate(() => [...document.images].map((i) => { const r = i.getBoundingClientRect(); return { src: i.currentSrc || i.src, natural_w: i.naturalWidth, shown_w: Math.round(r.width), top: Math.round(r.top + scrollY), loading: i.getAttribute("loading"), has_dims: i.hasAttribute("width") && i.hasAttribute("height"), fp: i.getAttribute("fetchpriority"), srcset: i.hasAttribute("srcset") }; }).filter((i) => i.src && !i.src.startsWith("data:")));
      const dpr = mobile ? 2.75 : 1, vh = mobile ? 851 : 900;
      for (const i of imgs) { const r = mimeOf.get(i.src); i.kb = r ? Math.round(r.bytes / 1024) : null; i.mime = r ? r.mime : null; i.oversized = i.shown_w > 0 && i.natural_w > i.shown_w * Math.min(dpr, 2) * T.IMG_OVERSIZE_RATIO; }
      rec.images = { total: imgs.length, legacy_format: imgs.filter((i) => /jpeg|png/.test(i.mime || "")).length, modern_format: imgs.filter((i) => /webp|avif/.test(i.mime || "")).length, oversized: imgs.filter((i) => i.oversized).length, oversized_examples: imgs.filter((i) => i.oversized).sort((a, b) => (b.kb || 0) - (a.kb || 0)).slice(0, 3).map((i) => `${i.natural_w}px file shown at ${i.shown_w}px, ${i.kb} KB: ${i.src.slice(0, 120)}`), lazy_above_fold: imgs.filter((i) => i.loading === "lazy" && i.top < vh).length, not_lazy_below_fold: imgs.filter((i) => i.loading !== "lazy" && i.top > vh * 2).length, missing_dimensions: imgs.filter((i) => !i.has_dims).length, fetchpriority_high: imgs.filter((i) => i.fp === "high").length, no_srcset: imgs.filter((i) => !i.srcset && i.natural_w > 600).length, heaviest: imgs.filter((i) => i.kb).sort((a, b) => b.kb - a.kb).slice(0, 3).map((i) => `${i.kb} KB ${i.src.slice(0, 120)}`) };
      const head = await page.evaluate(() => ({ preload_images: [...document.querySelectorAll('link[rel="preload"][as="image"]')].map((l) => l.href || l.getAttribute("imagesrcset")), preload_fonts: document.querySelectorAll('link[rel="preload"][as="font"]').length, preconnect: [...document.querySelectorAll('link[rel="preconnect"]')].map((l) => l.href), families: [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, "")))] }));
      rec.fonts = { families_loaded: head.families, preloaded: head.preload_fonts, remote_font_hosts: U.uniq(list.filter((r) => r.type === "Font" && !U.sameSite(r.url, host)).map((r) => U.hostOf(r.url)).filter(Boolean)) };
      const lcpSrc = rec.lcp_el && (rec.lcp_el.url || rec.lcp_el.src); rec.preload = { images: head.preload_images.slice(0, 4), lcp_image_preloaded: !!lcpSrc && head.preload_images.some((p) => p && (p === lcpSrc || lcpSrc.includes(p.split("/").pop().split("?")[0]))), preload_but_not_lcp: head.preload_images.length > 0 && !!lcpSrc && !head.preload_images.some((p) => p && lcpSrc.includes(p.split("/").pop().split("?")[0])), preconnect: head.preconnect.slice(0, 5) };
    }
  } catch (e) { rec.error = String(e.message).split("\n")[0].slice(0, 160); }
  await context.close(); return rec;
}

module.exports = {
  id: "30-perf", name: "Lab performance (throttled phone + desktop)", tiers: ["bid", "full"],
  async run(ctx) {
    const site = ctx.site, bid = ctx.opts.tier === "bid", runs = bid ? 1 : 3;
    let samples = ctx.samples.filter((s) => s.label !== "checkout"); if (bid) samples = [samples[0], samples.find((s) => s.label === "product") || samples[1]].filter(Boolean);
    const browser = await U.launch(), out = [];
    for (const s of samples) {
      const mob = []; for (let i = 0; i < runs; i++) { mob.push(await oneRun(browser, s.url, "mobile", site.host, i === 0)); await U.sleep(800); }
      const desk = bid ? null : await oneRun(browser, s.url, "desktop", site.host, false);
      const okRuns = mob.filter((r) => !r.error), med = (k) => U.round(U.median(okRuns.map((r) => r[k])), k === "cls" ? 3 : 0), first = mob[0];
      out.push({ id: s.id, url: s.url, runs: okRuns.length, error: okRuns.length ? null : first.error, mobile: { lcp_ms: med("lcp"), fcp_ms: med("fcp"), ttfb_ms: med("ttfb"), cls: med("cls"), tbt_ms: med("tbt"), requests: med("requests"), kb: med("kb"), js_kb: med("js_kb"), css_kb: med("css_kb"), img_kb: med("img_kb"), font_kb: med("font_kb"), third_party_kb: med("third_party_kb"), lcp_spread_ms: okRuns.length > 1 ? [Math.round(Math.min(...okRuns.map((r) => r.lcp))), Math.round(Math.max(...okRuns.map((r) => r.lcp)))] : null }, desktop: desk && !desk.error ? { lcp_ms: U.round(desk.lcp), ttfb_ms: U.round(desk.ttfb), cls: U.round(desk.cls, 3), tbt_ms: U.round(desk.tbt), kb: desk.kb, requests: desk.requests } : null, lcp_element: first.lcp_el, shift_sources: first.shift_sources, render_blocking: first.blocking || [], dom_nodes: first.dom_nodes, rendered_text_chars: first.rendered_text_chars, third_parties: first.third_parties, protocols: first.protocols, failed_requests: first.errors_4xx_5xx, images: first.images, fonts: first.fonts, preload: first.preload });
      ctx.log(`perf ${s.id}: LCP ${out[out.length - 1].mobile.lcp_ms}ms CLS ${out[out.length - 1].mobile.cls} ${out[out.length - 1].mobile.kb}KB`);
    }
    await browser.close(); ctx.write("data/perf.json", out);
    const lcpDesc = (e) => (e ? `${e.tag}${e.id ? "#" + e.id : ""}${e.cls ? "." + e.cls : ""}${e.natural_w ? ` ${e.natural_w}px file shown at ${e.shown_w}px` : ""}${e.loading === "lazy" ? " LAZY-LOADED" : ""}${e.fetchpriority ? ` fetchpriority=${e.fetchpriority}` : ""}${e.url || e.src ? " " + String(e.url || e.src).split("/").pop().slice(0, 60) : e.text ? ` "${e.text}"` : ""}` : null);
    const home = out[0] || {};
    // Chrome reports no contentful paint for content that starts invisible (opacity 0 entrance animations, fade-in preloaders).
    const unpainted = out.filter((p) => !p.error && p.mobile && p.mobile.lcp_ms == null).map((p) => p.id);
    return { profile: "Lab. Phone = 4x CPU slowdown, ~1.6 Mbps, 150 ms latency. Median of " + runs + " run(s). Desktop = unthrottled, 1 run.", main_content_time_not_reported: unpainted.length ? unpainted : undefined, needs_model: unpainted.length ? `Chrome reported no main-content paint time on ${unpainted.join(", ")} although the page renders. The usual cause is content that fades in from invisible (entrance animations or a fade-in loader): Chrome does not count it, so Google's own speed measurement of this page is blind too. Open the full-size screenshot, check the site's animation settings, and write it up as a model finding if confirmed.` : undefined, pages: out.map((p) => ({ id: p.id, error: p.error || undefined, phone: p.mobile, desktop: p.desktop, lcp_element: lcpDesc(p.lcp_element), lcp_preloaded: p.preload ? p.preload.lcp_image_preloaded : null, shifts_from: p.shift_sources, render_blocking_files: p.render_blocking.length, dom_nodes: p.dom_nodes })), home_detail: { render_blocking_examples: U.top((home.render_blocking || []).map((u) => u.split("?")[0].split("/").slice(-2).join("/")), 6), third_parties: home.third_parties, images: home.images, fonts: home.fonts, preload: home.preload, protocols: home.protocols, failed_requests: home.failed_requests }, worst_lcp: out.filter((p) => p.mobile.lcp_ms).sort((a, b) => b.mobile.lcp_ms - a.mobile.lcp_ms).slice(0, 1).map((p) => `${p.id} ${p.mobile.lcp_ms} ms`)[0] || null, pages_failing_lcp: out.filter((p) => p.mobile.lcp_ms > T.LCP_GOOD_MS).length, pages_failing_cls: out.filter((p) => p.mobile.cls > T.CLS_GOOD).length };
  },
};
U.standalone(module.exports, module);
