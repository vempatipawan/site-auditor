// 60-tracking: every tag on the site, duplicates and dead ones, and a three-state consent test in fresh browsers:
// what loads BEFORE any click, after REJECT, and after ACCEPT. Cookies and tracker requests are logged per state.
const U = require("../lib/util");

const TRACKERS = [[/google-analytics\.com|analytics\.google\.com|\/g\/collect/i, "Google Analytics"], [/googletagmanager\.com/i, "Google Tag Manager"], [/doubleclick\.net|googleadservices|googlesyndication|google\.com\/pagead|\/ccm\/collect/i, "Google Ads"], [/facebook\.(com|net)\/tr|connect\.facebook\.net/i, "Meta Pixel"], [/hs-analytics|hs-scripts|hubspot|hsforms|hscollectedforms|hs-banner/i, "HubSpot"], [/clarity\.ms/i, "Microsoft Clarity"], [/hotjar/i, "Hotjar"], [/tiktok/i, "TikTok"], [/klaviyo/i, "Klaviyo"], [/linkedin\.com\/(px|li)|snap\.licdn/i, "LinkedIn Insight"], [/pinterest|pinimg\.com\/ct/i, "Pinterest"], [/bing\.com\/bat|bat\.bing/i, "Microsoft Ads"], [/snapchat|sc-static/i, "Snapchat"], [/criteo/i, "Criteo"], [/mouseflow|fullstory|luckyorange|smartlook/i, "Session recording"]];
const tracker = (u) => (TRACKERS.find(([re]) => re.test(u)) || [])[1] || null;
const ACCEPT = /^(accept( all)?( cookies)?|allow all( cookies)?|agree|i agree|ok|got it|alle akzeptieren|akzeptieren|alles accepteren|accepteren|tout accepter|accepter|aceptar( todo)?|accetta( tutti)?)$/i;
const REJECT = /^(reject( all)?|decline( all)?|deny( all)?|refuse|only necessary|necessary only|use necessary cookies only|essential only|alle ablehnen|ablehnen|nur notwendige|alles weigeren|weigeren|alleen noodzakelijk|tout refuser|refuser|rechazar( todo)?|rifiuta( tutti)?)$/i;

async function clickByText(page, re) { for (const role of ["button", "link"]) { const els = page.getByRole(role); const n = Math.min(await els.count().catch(() => 0), 60); for (let i = 0; i < n; i++) { const el = els.nth(i); try { const t = ((await el.innerText({ timeout: 300 })) || "").trim(); if (t && t.length < 40 && re.test(t) && (await el.isVisible())) { await el.click({ timeout: 2000 }); return t; } } catch {} } } return null; }

async function state(browser, url, action, ctxOpts) {
  const context = await browser.newContext(ctxOpts), page = await context.newPage(), hits = [], ids = new Set(), gcs = new Set();
  page.on("request", (r) => { const u = r.url(), t = tracker(u); if (t) hits.push(t); for (const m of u.matchAll(/[?&](?:tid|id)=((?:G|GTM|AW|UA)-[A-Z0-9-]+)/g)) ids.add(m[1]); const g = u.match(/[?&]gcs=(G\d+)/); if (g) gcs.add(g[1]); });
  const out = { action };
  try {
    await page.goto(url, { waitUntil: "load", timeout: 75000 }); await U.sleep(4500);
    if (action === "none") { out.banner = await page.evaluate(() => { const c = [...document.querySelectorAll("div,section,aside,dialog")].filter((el) => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return (s.position === "fixed" || s.position === "sticky") && r.height > 40 && r.width > 200 && /cookie|consent|gdpr|privacy|datenschutz/i.test((el.id || "") + " " + (typeof el.className === "string" ? el.className : "") + " " + (el.innerText || "").slice(0, 300)); }); if (!c.length) return null; const r = c[0].getBoundingClientRect(); return { height_px: Math.round(r.height), share_of_screen_pct: Math.round((r.height * r.width) / (innerWidth * innerHeight) * 100), has_reject_on_first_layer: /reject|decline|deny|ablehnen|weigeren|refuser|necessary|notwendig|noodzakelijk/i.test(c[0].innerText || "") }; }); out.consent_default_in_datalayer = await page.evaluate(() => Array.isArray(window.dataLayer) && window.dataLayer.some((e) => e && e[0] === "consent" && e[1] === "default")); }
    else { hits.length = 0; out.clicked = await clickByText(page, action === "accept" ? ACCEPT : REJECT); if (out.clicked) { await U.sleep(1500); await page.reload({ waitUntil: "load" }).catch(() => {}); await U.sleep(4000); } }
    const cookies = await context.cookies(); out.cookies = cookies.map((c) => c.name); out.tracking_cookies = U.uniq(cookies.filter((c) => /^(_ga|_gid|_gcl|_fbp|_fbc|hubspotutk|__hs|_hj|_clck|_clsk|_uet|_tt_|_pin_|__kla|IDE|li_|bcookie|MUID)/i.test(c.name)).map((c) => c.name));
  } catch (e) { out.error = String(e.message).split("\n")[0].slice(0, 120); }
  const tally = {}; for (const h of hits) tally[h] = (tally[h] || 0) + 1; out.trackers = tally; out.ids = [...ids]; out.gcs = [...gcs];
  await context.close(); return out;
}

module.exports = {
  id: "60-tracking", name: "Tags, duplicates and the three-state consent test", tiers: ["bid", "full"],
  async run(ctx) {
    const site = ctx.site, html = (await U.fetchText(site.home)).text, count = (re) => { const c = {}; for (const m of html.matchAll(re)) c[m[1] || m[0]] = (c[m[1] || m[0]] || 0) + 1; return c; };
    const source = { ga4: count(/\b(G-[A-Z0-9]{6,12})\b/g), universal_analytics_dead_since_2023: count(/\b(UA-\d{4,10}-\d{1,3})\b/g), gtm: count(/\b(GTM-[A-Z0-9]{5,9})\b/g), google_ads: count(/\b(AW-\d{8,12})\b/g), meta_pixel: count(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{8,20})['"]/g), hubspot_portal: count(/js(?:-eu1)?\.hs-scripts\.com\/(\d+)\.js/g), clarity: count(/clarity\.ms\/tag\/([a-z0-9]+)/gi), hotjar: count(/hjid\s*:\s*(\d+)/g), tiktok: count(/ttq\.load\(\s*['"]([A-Z0-9]+)['"]/g), klaviyo: count(/klaviyo\.com\/onsite\/js\/[^"']*company_id=([A-Za-z0-9]+)/g) };
    const loaderCount = { gtag_js_loaders: (html.match(/googletagmanager\.com\/gtag\/js/g) || []).length, gtm_loaders: (html.match(/googletagmanager\.com\/gtm\.js/g) || []).length, fbevents_loaders: (html.match(/connect\.facebook\.net\/[^"']*fbevents\.js/g) || []).length };
    const cmp = [[/cookiebot/i, "Cookiebot"], [/onetrust|optanon/i, "OneTrust"], [/cookieyes|cky-/i, "CookieYes"], [/complianz|cmplz/i, "Complianz"], [/iubenda/i, "iubenda"], [/hs-banner|hs-eu-cookie/i, "HubSpot banner"], [/borlabs/i, "Borlabs"], [/real-cookie-banner/i, "Real Cookie Banner"], [/moove_gdpr|gdpr-cookie-compliance/i, "GDPR Cookie Compliance"], [/cookie-law-info|cli-/i, "CookieYes (legacy)"], [/usercentrics/i, "Usercentrics"], [/termly/i, "Termly"], [/klaro/i, "Klaro"]].filter(([re]) => re.test(html)).map(([, n]) => n);

    const browser = await U.launch(), before = await state(browser, site.home, "none", U.MOBILE_CTX); let reject = null, accept = null;
    if (ctx.opts.tier !== "bid") { reject = await state(browser, site.home, "reject", U.DESKTOP_CTX); accept = await state(browser, site.home, "accept", U.DESKTOP_CTX); }
    await browser.close();
    const srcIds = new Set(Object.values(source).flatMap((o) => Object.keys(o))), runtimeOnly = U.uniq([...(before.ids || []), ...((accept && accept.ids) || [])]).filter((i) => !srcIds.has(i));
    const dup = Object.entries(source).flatMap(([k, o]) => Object.entries(o).filter(([, n]) => n > 1 && !/gtm|ga4/.test(k)).map(([id, n]) => `${id} appears ${n}x in source`));
    if (loaderCount.gtag_js_loaders > 1) dup.push(`gtag.js is loaded ${loaderCount.gtag_js_loaders} times`); if (loaderCount.fbevents_loaders > 1) dup.push(`Meta Pixel script is loaded ${loaderCount.fbevents_loaders} times`);
    ctx.write("data/tracking.json", { source, loaderCount, cmp, before, reject, accept, runtimeOnly });
    const fired = (s) => (s ? Object.keys(s.trackers) : null);
    return { tags_in_source: Object.fromEntries(Object.entries(source).filter(([, o]) => Object.keys(o).length).map(([k, o]) => [k, Object.keys(o)])), loaders: loaderCount, duplicates: dup, dead_universal_analytics: Object.keys(source.universal_analytics_dead_since_2023), ids_seen_only_at_runtime: runtimeOnly, consent_tool: cmp.length ? cmp : "none detected", banner_on_phone: before.banner || "no banner seen", consent_mode_default_set: before.consent_default_in_datalayer, consent_signals_sent_to_google: before.gcs, BEFORE_ANY_CLICK: { trackers_firing: fired(before), tracking_cookies: before.tracking_cookies, all_cookies: (before.cookies || []).length }, AFTER_REJECT: reject ? { button_clicked: reject.clicked || "NO REJECT BUTTON FOUND", trackers_firing: fired(reject), tracking_cookies: reject.tracking_cookies } : "not run in bid tier", AFTER_ACCEPT: accept ? { button_clicked: accept.clicked || "no accept button found", trackers_firing: fired(accept), tracking_cookies: accept.tracking_cookies } : "not run in bid tier", verdict: (before.tracking_cookies || []).length || (fired(before) || []).filter((t) => !/Tag Manager/.test(t)).length ? "Trackers or tracking cookies are active before the visitor has made any choice." : "Nothing tracking-related fired before a choice was made.", note: "Whether this is a legal problem depends on the visitor's country. It is reported as observed behaviour, not as legal advice." };
  },
};
U.standalone(module.exports, module);
