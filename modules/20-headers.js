// 20-headers: what the server says about itself. Security headers, cookies, compression, caching, TLS, mixed content.
const tls = require("tls");
const U = require("../lib/util");
const T = require("../lib/thresholds");

function certInfo(host) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 12000 }, () => {
      const c = s.getPeerCertificate(); const proto = s.getProtocol(); s.end();
      if (!c || !c.valid_to) return resolve(null);
      resolve({ issuer: (c.issuer && (c.issuer.O || c.issuer.CN)) || null, valid_to: c.valid_to, days_left: Math.round((new Date(c.valid_to) - Date.now()) / 864e5), tls: proto, san_count: (c.subjectaltname || "").split(",").length });
    });
    s.on("error", () => resolve(null)); s.on("timeout", () => { s.destroy(); resolve(null); });
  });
}

module.exports = {
  id: "20-headers", name: "Headers, TLS, cookies, caching", tiers: ["bid", "full"],
  async run(ctx) {
    const site = ctx.site, home = await U.fetchText(site.home, { headers: { "Accept-Encoding": "br, gzip" } }), h = home.headers;
    const sec = { hsts: h["strict-transport-security"] || null, csp: h["content-security-policy"] ? "present" : h["content-security-policy-report-only"] ? "report-only" : null, xfo: h["x-frame-options"] || null, nosniff: h["x-content-type-options"] || null, referrer: h["referrer-policy"] || null, permissions: h["permissions-policy"] ? "present" : null };
    const hstsAge = Number(((sec.hsts || "").match(/max-age=(\d+)/i) || [])[1] || 0);
    const missing = Object.entries({ "Strict-Transport-Security": sec.hsts && hstsAge > 0, "Content-Security-Policy": sec.csp === "present", "X-Frame-Options": sec.xfo || /frame-ancestors/i.test(h["content-security-policy"] || ""), "X-Content-Type-Options": sec.nosniff, "Referrer-Policy": sec.referrer, "Permissions-Policy": sec.permissions }).filter(([, v]) => !v).map(([k]) => k);

    const cookies = (h["set-cookie"] || "").split("\n").filter(Boolean).map((c) => ({ name: c.split("=")[0].trim(), secure: /;\s*secure/i.test(c), httponly: /;\s*httponly/i.test(c), samesite: (c.match(/samesite=(\w+)/i) || [])[1] || null }));
    const leaks = [["server", h.server], ["x-powered-by", h["x-powered-by"]], ["x-generator", h["x-generator"]], ["x-aspnet-version", h["x-aspnet-version"]]].filter(([, v]) => v && /\d/.test(v)).map(([k, v]) => `${k}: ${v}`);

    // a static asset from the homepage, for cache-control + compression comparison
    const html = ctx.read("data/home.html") ? "" : home.text; const src = home.text || html;
    const asset = (src.match(/<link[^>]+href=["']([^"']+\.css[^"']*)["']/i) || src.match(/<script[^>]+src=["']([^"']+\.js[^"']*)["']/i) || [])[1];
    let stat = null; if (asset) { const a = await U.fetchText(new URL(asset, site.home).toString(), { noBody: true, headers: { "Accept-Encoding": "br, gzip" } }); stat = { url: a.finalUrl, cache_control: a.headers["cache-control"] || null, encoding: a.headers["content-encoding"] || null, ttfb_ms: a.ttfb, via_cdn: /cloudflare|cloudfront|fastly|akamai|bunny|keycdn|stackpath/i.test([a.headers.server, a.headers.via, a.headers["x-cache"], a.headers["cf-ray"] ? "cloudflare" : ""].join(" ")) }; }

    const mixed = U.uniq([...home.text.matchAll(/(?:src|href)=["'](http:\/\/[^"']+\.(?:js|css|png|jpe?g|gif|webp|svg|woff2?))["']/gi)].map((m) => m[1])).slice(0, 10);
    const cdn = /cloudflare/i.test(h.server || "") || h["cf-ray"] ? "Cloudflare" : /cloudfront/i.test(h.via || h["x-cache"] || "") ? "CloudFront" : h["x-served-by"] && /cache-/i.test(h["x-served-by"]) ? "Fastly" : h["x-sucuri-id"] ? "Sucuri" : h["x-kinsta-cache"] ? "Kinsta" : null;
    const cert = await certInfo(site.host);

    let observatory = null; const o = await U.postJson(`https://observatory-api.mdn.mozilla.net/api/v2/scan?host=${site.host}`, {}, { timeout: 60000 });
    if (o.ok && o.json && o.json.grade) observatory = { grade: o.json.grade, score: o.json.score, tests_failed: o.json.tests_failed, tests_passed: o.json.tests_passed, details: o.json.details_url };

    const data = { url: home.finalUrl, status: home.status, headers: h, security: sec, missing, cookies, leaks, static_asset: stat, mixed_content: mixed, cdn, cert, observatory };
    ctx.write("data/headers.json", data);
    return { security_headers_missing: missing, hsts_max_age: hstsAge, observatory, cookies_total: cookies.length, cookies_on_anonymous_visit: cookies.map((c) => c.name), cookies_not_secure: cookies.filter((c) => !c.secure).map((c) => c.name), cookies_no_samesite: cookies.filter((c) => !c.samesite).map((c) => c.name), version_leaks: leaks, html_cache_control: h["cache-control"] || null, html_encoding: h["content-encoding"] || "none", static_asset: stat, cdn, cert, cert_expiring_soon: cert ? cert.days_left < T.CERT_EXPIRY_DAYS : null, mixed_content: mixed.length, mixed_examples: U.top(mixed, 3), alt_svc_http3: /h3/.test(h["alt-svc"] || "") };
  },
};
U.standalone(module.exports, module);
