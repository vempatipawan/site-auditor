// 34-thirdparty: what each outside script actually costs. The homepage is loaded once as-is, then once per third party
// with that one domain blocked. The difference in main-thread blocking and load time is that script's price.
const U = require("../lib/util");

const LABEL = [[/googletagmanager|google-analytics|analytics\.google/i, "Google Tag Manager / Analytics"], [/hs-scripts|hsforms|hs-banner|hs-analytics|hubspot|hscollectedforms/i, "HubSpot"], [/clarity\.ms/i, "Microsoft Clarity"], [/hotjar/i, "Hotjar"], [/facebook|fbcdn|connect\.facebook/i, "Meta Pixel"], [/klaviyo/i, "Klaviyo"], [/tiktok/i, "TikTok Pixel"], [/doubleclick|googleadservices|googlesyndication/i, "Google Ads"], [/youtube|ytimg/i, "YouTube embed"], [/vimeo/i, "Vimeo embed"], [/fonts\.(googleapis|gstatic)/i, "Google Fonts"], [/trustpilot/i, "Trustpilot"], [/tawk|intercom|crisp|livechat|zendesk|zdassets|drift/i, "Live chat"], [/cookiebot|onetrust|cookieyes|iubenda|complianz/i, "Cookie banner"], [/recaptcha|gstatic\.com\/recaptcha/i, "reCAPTCHA"], [/stripe/i, "Stripe"], [/paypal/i, "PayPal"], [/mollie/i, "Mollie"], [/jsdelivr|cdnjs|unpkg|code\.jquery/i, "Public CDN libraries"]];
const label = (h) => (LABEL.find(([re]) => re.test(h)) || [, h])[1];

async function load(browser, url, block) {
  const context = await browser.newContext(U.MOBILE_CTX), page = await context.newPage();
  await page.addInitScript(`window.__tbt=0;window.__lcp=0;try{new PerformanceObserver(l=>{for(const e of l.getEntries())if(e.duration>50)window.__tbt+=e.duration-50}).observe({type:"longtask",buffered:true})}catch(e){};try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lcp=e.startTime}).observe({type:"largest-contentful-paint",buffered:true})}catch(e){}`);
  const cdp = await context.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  if (block) await page.route((u) => block.some((b) => u.hostname === b || u.hostname.endsWith("." + b)), (r) => r.abort());
  let out = null; try { await page.goto(url, { waitUntil: "load", timeout: 90000 }); await U.sleep(4000); out = await page.evaluate(() => ({ tbt: Math.round(window.__tbt), lcp: Math.round(window.__lcp), load: Math.round((performance.getEntriesByType("navigation")[0] || {}).loadEventEnd || 0) })); } catch (e) { out = { error: String(e.message).split("\n")[0].slice(0, 100) }; }
  await context.close(); return out;
}

module.exports = {
  id: "34-thirdparty", name: "Cost of each third-party script", tiers: ["full"],
  async run(ctx) {
    const perf = ctx.read("data/perf.json"); if (!perf || !perf[0] || !perf[0].third_parties) return U.skipped("run 30-perf first");
    const url = ctx.site.home, groups = {}; for (const t of perf[0].third_parties) { const l = label(t.host); groups[l] = groups[l] || { hosts: [], kb: 0 }; groups[l].hosts.push(t.host); groups[l].kb += t.kb; }
    const targets = Object.entries(groups).sort((a, b) => b[1].kb - a[1].kb).slice(0, 6), browser = await U.launch();
    const base = [await load(browser, url), await load(browser, url)].filter((b) => !b.error); if (!base.length) { await browser.close(); return { status: "failed", reason: "baseline load failed" }; }
    const b0 = { tbt: U.median(base.map((b) => b.tbt)), lcp: U.median(base.map((b) => b.lcp)), load: U.median(base.map((b) => b.load)) }, rows = [];
    for (const [name, g] of targets) { const r = await load(browser, url, g.hosts); if (r.error) continue; rows.push({ third_party: name, hosts: g.hosts, kb: g.kb, main_thread_saved_ms: Math.round(b0.tbt - r.tbt), load_saved_ms: Math.round(b0.load - r.load), lcp_saved_ms: Math.round(b0.lcp - r.lcp) }); }
    const allBlocked = await load(browser, url, targets.flatMap(([, g]) => g.hosts)); await browser.close();
    ctx.write("data/thirdparty.json", { baseline: b0, rows, allBlocked });
    rows.sort((a, b) => b.main_thread_saved_ms - a.main_thread_saved_ms);
    return { profile: "Lab, phone viewport, 4x CPU slowdown, unthrottled network. Single runs: read differences under ~150 ms as noise.", baseline: b0, with_all_third_parties_blocked: allBlocked, per_third_party: rows.map((r) => `${r.third_party}: ${r.kb} KB, main thread ${r.main_thread_saved_ms >= 0 ? "-" : "+"}${Math.abs(r.main_thread_saved_ms)} ms, load ${r.load_saved_ms >= 0 ? "-" : "+"}${Math.abs(r.load_saved_ms)} ms when removed`), most_expensive: rows[0] && rows[0].main_thread_saved_ms > 150 ? rows[0].third_party : null, advice: "Nothing here says remove a tool. It says which ones to load after consent, after first interaction, or only on the pages that use them." };
  },
};
U.standalone(module.exports, module);
