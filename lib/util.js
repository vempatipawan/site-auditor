// Shared helpers for every audit module. No external dependencies.
const fs = require("fs");
const path = require("path");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const UA_MOBILE = "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const UA_GPTBOT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";

const ROOT = path.join(__dirname, "..");

// ---------- env ----------
let _env = null;
function loadEnv() {
  if (_env) return _env;
  _env = Object.assign({}, process.env);
  const f = path.join(ROOT, ".env");
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[2] && !line.trim().startsWith("#")) _env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return _env;
}

// ---------- small utils ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n, d = 0) => (n == null || isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const median = (a) => { const s = a.filter((x) => x != null && !isNaN(x)).sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (n, d) => (d ? round((n / d) * 100, 1) : 0);
const uniq = (a) => [...new Set(a)];
const top = (a, n = 5) => a.slice(0, n);
const stripTags = (s) => (s || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const decode = (s) => (s || "").replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#8211;|&ndash;/g, "-").replace(/&#8217;/g, "'").replace(/&#038;/g, "&").replace(/\s+/g, " ").trim();

function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } }
const TWO_PART_TLD = /\.(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/i;
function regDomain(host) { const p = host.replace(/^www\./, "").split("."); return (TWO_PART_TLD.test(host) ? p.slice(-3) : p.slice(-2)).join("."); }
function sameSite(u, host) { const h = hostOf(u); return !!h && regDomain(h) === regDomain(host); }
function slug(s) { return (s || "").toLowerCase().replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "home"; }

// ---------- http ----------
function headersToObj(h) { const o = {}; h.forEach((v, k) => { o[k] = o[k] ? o[k] + "\n" + v : v; }); if (h.getSetCookie) { const sc = h.getSetCookie(); if (sc.length) o["set-cookie"] = sc.join("\n"); } return o; }

// Fetch with manual redirect chain, timeout and timing. Never throws.
async function fetchText(url, opt = {}) {
  const { ua = UA, headers = {}, timeout = 30000, method = "GET", maxHops = 6, body, noBody = false } = opt;
  const chain = []; let current = url; const t0 = Date.now(); let ttfb = null;
  for (let hop = 0; hop <= maxHops; hop++) {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), timeout);
    try {
      const tReq = Date.now();
      const res = await fetch(current, { method, body, redirect: "manual", signal: ctrl.signal, headers: Object.assign({ "User-Agent": ua, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en;q=0.9" }, headers) });
      if (ttfb == null || hop > 0) ttfb = Date.now() - tReq;
      const h = headersToObj(res.headers);
      if (res.status >= 300 && res.status < 400 && h.location) {
        const to2 = new URL(h.location, current).toString(); chain.push({ from: current, status: res.status, to: to2 }); current = to2; try { await res.arrayBuffer(); } catch {} continue;
      }
      const text = noBody || method === "HEAD" ? "" : await res.text();
      return { ok: true, status: res.status, headers: h, text, finalUrl: current, chain, ms: Date.now() - t0, ttfb };
    } catch (e) {
      return { ok: false, status: 0, headers: {}, text: "", finalUrl: current, chain, ms: Date.now() - t0, ttfb, error: String((e && e.cause && e.cause.code) || e.name || e.message || e).slice(0, 120) };
    } finally { clearTimeout(to); }
  }
  return { ok: false, status: 599, headers: {}, text: "", finalUrl: current, chain, ms: Date.now() - t0, error: "too many redirects" };
}
async function getJson(url, opt = {}) {
  const r = await fetchText(url, Object.assign({ headers: { Accept: "application/json" } }, opt, { headers: Object.assign({ Accept: "application/json" }, opt.headers || {}) }));
  if (!r.ok) return { ok: false, status: r.status, error: r.error };
  try { return { ok: r.status < 400, status: r.status, json: JSON.parse(r.text) }; } catch { return { ok: false, status: r.status, error: "not json", text: r.text.slice(0, 200) }; }
}
async function postJson(url, payload, opt = {}) {
  return getJson(url, Object.assign({}, opt, { method: "POST", body: JSON.stringify(payload), headers: Object.assign({ "Content-Type": "application/json" }, opt.headers || {}) }));
}
// HEAD with GET fallback (many hosts reject HEAD)
async function probe(url, opt = {}) {
  let r = await fetchText(url, Object.assign({ method: "HEAD", timeout: 15000 }, opt));
  if (!r.ok || [403, 405, 501].includes(r.status)) r = await fetchText(url, Object.assign({ timeout: 20000, noBody: true }, opt));
  return r;
}

// Run fn over items with bounded concurrency and a polite stagger.
async function pool(items, n, fn, stagger = 0) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async (_, w) => {
    await sleep(w * 80);
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = { error: String(e.message || e) }; } if (stagger) await sleep(stagger); }
  }));
  return out;
}

// ---------- run context ----------
function makeCtx(outDir, opts = {}) {
  outDir = path.resolve(outDir);
  const d = (p) => { const f = path.join(outDir, p); fs.mkdirSync(f, { recursive: true }); return f; };
  const ctx = {
    outDir, dataDir: d("data"), sumDir: d("summaries"), shotDir: d("screenshots"), sheetDir: d("sheets"), packDir: d("client-pack"),
    opts, env: loadEnv(),
    log: (...a) => console.log("   ", ...a),
    read: (rel, fallback = null) => { const f = path.join(outDir, rel); if (!fs.existsSync(f)) return fallback; try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } },
    write: (rel, obj) => { const f = path.join(outDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof obj === "string" ? obj : JSON.stringify(obj, null, 2)); return f; },
    summary: (id) => ctx.read(`summaries/${id}.json`),
    get site() { return ctx.read("site.json", {}); },
    get samples() { return (ctx.read("site.json", {}).samples || []); },
  };
  return ctx;
}

// One flag parser for audit.js and for standalone modules. --max-urls 500 -> opts.maxUrls = 500; a bare --force -> true.
function parseFlags(argv) {
  const opts = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; if (!a.startsWith("--")) { rest.push(a); continue; }
    const eq = a.indexOf("="), key = (eq > 0 ? a.slice(2, eq) : a.slice(2)).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
    let v = eq > 0 ? a.slice(eq + 1) : argv[i + 1] != null && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    if (typeof v === "string" && /^\d+$/.test(v) && key === "maxUrls") v = Number(v);
    opts[key] = v;
  }
  return { opts, rest };
}

// Lets any module run on its own: node modules/30-perf.js <outDir> [url] [--tier bid] [--force] ...
function standalone(mod, mainModule) {
  if (require.main !== mainModule) return;
  const { opts, rest } = parseFlags(process.argv.slice(2)), outDir = rest[0];
  if (!outDir) { console.error(`usage: node modules/${mod.id}.js <outDir> [url] [--flags]`); process.exit(1); }
  const ctx = makeCtx(outDir, Object.assign({ tier: "full", url: rest[1] }, opts));
  const t0 = Date.now();
  mod.run(ctx).then((s) => { s = Object.assign({ status: "ok" }, s, { ms: Date.now() - t0 }); ctx.write(`summaries/${mod.id}.json`, s); console.log(JSON.stringify(s, null, 2).slice(0, 4000)); })
    .catch((e) => { console.error(e); process.exit(1); });
}

const skipped = (reason) => ({ status: "skipped", reason });

// Who the report is for and from. Flags beat brief.json beats what the site itself says. Never hard-coded.
function identity(ctx) {
  const brief = ctx.read("brief.json") || ctx.site.brief || {}, an = ctx.summary("11-analyze") || {}, o = ctx.opts || {};
  const guess = an.brand_guess ? an.brand_guess.replace(/^\w/, (c) => c.toUpperCase()) : ctx.site.host;
  return { client: o.client || brief.client_name || brief.client || guess, freelancer: o.freelancer || brief.freelancer || null, contact: o.preparedFor || brief.contact_name || null, brief };
}

// Shared Playwright launcher. Browser modules run one at a time so timings stay honest.
async function launch(engine = "chromium") {
  const pw = require("playwright");
  return pw[engine].launch({ headless: true });
}
const MOBILE_CTX = { viewport: { width: 393, height: 851 }, userAgent: UA_MOBILE, isMobile: true, hasTouch: true, deviceScaleFactor: 2.75 };
const DESKTOP_CTX = { viewport: { width: 1440, height: 900 }, userAgent: UA, deviceScaleFactor: 1 };
async function throttleMobile(context, page) {
  const c = await context.newCDPSession(page);
  await c.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await c.send("Network.enable");
  await c.send("Network.emulateNetworkConditions", { offline: false, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 });
  return c;
}
// Click away the usual cookie banners so they do not pollute screenshots or interaction tests.
async function dismissBanners(page) {
  const sels = ["#onetrust-accept-btn-handler", "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll", ".cky-btn-accept", ".cmplz-accept", "#cookie_action_close_header", ".cc-allow", ".cc-btn.cc-dismiss", "[data-cookiebanner='accept_button']", "#hs-eu-confirmation-button", ".moove-gdpr-infobar-allow-all", "#wt-cli-accept-all-btn", ".iubenda-cs-accept-btn", "button[aria-label*='ccept' i]"];
  for (const s of sels) { try { const el = await page.$(s); if (el && (await el.isVisible())) { await el.click({ timeout: 1500 }); await sleep(400); return s; } } catch {} }
  try { const b = page.getByRole("button", { name: /^(accept( all)?|allow all|agree|i agree|got it|alle akzeptieren|akzeptieren|accepteren|alles accepteren|tout accepter|aceptar)/i }).first(); if (await b.isVisible({ timeout: 500 })) { await b.click({ timeout: 1500 }); return "role-button"; } } catch {}
  return null;
}

module.exports = { UA, UA_MOBILE, UA_GPTBOT, ROOT, loadEnv, sleep, round, median, pct, uniq, top, stripTags, decode, hostOf, regDomain, sameSite, slug, fetchText, getJson, postJson, probe, pool, makeCtx, parseFlags, standalone, skipped, identity, launch, MOBILE_CTX, DESKTOP_CTX, throttleMobile, dismissBanners };
