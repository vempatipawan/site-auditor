// 51-exposure: files that should never be public, the small standard files that should be, third-party script hygiene,
// and blacklist status. Plain GETs only. A hit is confirmed by content shape, never by status code alone.
const U = require("../lib/util");

const SENSITIVE = [
  ["/.git/HEAD", (t) => /^ref:\s*refs\//.test(t.trim()), "source code repository"],
  ["/.env", (t) => /^[A-Z_]+=.+/m.test(t) && !/<html/i.test(t), "environment file with credentials"],
  ["/wp-config.php.bak", (t) => /DB_PASSWORD|DB_NAME/.test(t), "WordPress config backup"],
  ["/wp-config.php~", (t) => /DB_PASSWORD|DB_NAME/.test(t), "WordPress config backup"],
  ["/wp-config.old", (t) => /DB_PASSWORD|DB_NAME/.test(t), "WordPress config backup"],
  ["/phpinfo.php", (t) => /<title>phpinfo\(\)|PHP Version/i.test(t), "server configuration page"],
  ["/info.php", (t) => /<title>phpinfo\(\)|PHP Version/i.test(t), "server configuration page"],
  ["/.DS_Store", (t) => t.startsWith("\u0000\u0000\u0000\u0001Bud1"), "folder listing file"],
  ["/backup.zip", null, "site backup archive"], ["/backup.sql", (t) => /CREATE TABLE|INSERT INTO/i.test(t), "database dump"], ["/database.sql", (t) => /CREATE TABLE|INSERT INTO/i.test(t), "database dump"], ["/dump.sql", (t) => /CREATE TABLE|INSERT INTO/i.test(t), "database dump"],
  ["/composer.json", (t) => /"require"\s*:/.test(t), "dependency manifest"], ["/package.json", (t) => /"dependencies"\s*:/.test(t), "dependency manifest"],
  ["/error_log", (t) => /^\[\d{2}-\w{3}-\d{4}/.test(t), "PHP error log"], ["/server-status", (t) => /Apache Server Status/i.test(t), "server status page"],
];
const STANDARD = ["/.well-known/security.txt", "/llms.txt", "/ads.txt", "/humans.txt", "/favicon.ico", "/apple-touch-icon.png", "/site.webmanifest", "/manifest.json"];

module.exports = {
  id: "51-exposure", name: "Exposed files, script hygiene, blacklists", tiers: ["bid", "full"],
  async run(ctx) {
    const site = ctx.site, O = site.origin, host = site.host;
    // a guaranteed-missing path tells us whether the server answers 200 to everything (soft 404)
    const bogus = await U.fetchText(`${O}/zz-audit-${Date.now()}.txt`, { timeout: 15000 }); const soft404 = bogus.status === 200;
    const found = [];
    await U.pool(SENSITIVE, 4, async ([p, test, label]) => {
      const r = await U.fetchText(O + p, { timeout: 15000, headers: { Range: "bytes=0-600" } });
      if (![200, 206].includes(r.status)) return;
      const isArchive = !test && /zip|octet-stream/i.test(r.headers["content-type"] || "") && !soft404;
      if ((test && test(r.text)) || isArchive) found.push({ path: p, what: label, status: r.status });
    }, 150);
    const std = {}; await U.pool(STANDARD, 4, async (p) => { const r = await U.fetchText(O + p, { timeout: 12000, headers: { Range: "bytes=0-400" } }); std[p] = [200, 206].includes(r.status) && !(soft404 && /<html/i.test(r.text)) && !/<html/i.test(r.text.slice(0, 200)); });

    // third-party scripts: unpinned versions and missing integrity
    const html = (await U.fetchText(site.home)).text; const scripts = [...html.matchAll(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>/gi)].map((m) => ({ src: new URL(m[2], site.home).toString(), attrs: m[1] + m[3] })).filter((s) => !U.sameSite(s.src, host));
    const unpinned = scripts.filter((s) => /@latest|\/latest\//i.test(s.src)).map((s) => s.src), cdnLibs = scripts.filter((s) => /(cdnjs|jsdelivr|unpkg|code\.jquery|ajax\.googleapis|bootstrapcdn)/i.test(s.src)), noSri = cdnLibs.filter((s) => !/integrity=/i.test(s.attrs)).map((s) => s.src);
    const oldJq = (html.match(/jquery[.-]([12]\.\d+(?:\.\d+)?)(?:\.min)?\.js/i) || [])[1] || null;
    const e404 = await U.fetchText(`${O}/zz-audit-missing-page-${Date.now()}/`, { timeout: 20000 });

    // blacklists (keyed, optional)
    const env = ctx.env; let safeBrowsing = "not run (no GOOGLE_API_KEY)", virusTotal = "not run (no VIRUSTOTAL_API_KEY)";
    if (env.GOOGLE_API_KEY) { const r = await U.postJson(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${env.GOOGLE_API_KEY}`, { client: { clientId: "site-auditor", clientVersion: "1" }, threatInfo: { threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"], platformTypes: ["ANY_PLATFORM"], threatEntryTypes: ["URL"], threatEntries: [{ url: site.home }] } }); safeBrowsing = r.ok ? (r.json.matches ? r.json.matches.map((m) => m.threatType) : "clean") : `error ${r.status}`; }
    if (env.VIRUSTOTAL_API_KEY) { const r = await U.getJson(`https://www.virustotal.com/api/v3/domains/${site.reg_domain}`, { headers: { "x-apikey": env.VIRUSTOTAL_API_KEY } }); if (r.ok) { const s = r.json.data.attributes.last_analysis_stats; virusTotal = { malicious: s.malicious, suspicious: s.suspicious, harmless: s.harmless, reputation: r.json.data.attributes.reputation }; } else virusTotal = `error ${r.status}`; }

    ctx.write("data/exposure.json", { soft404, found, std, thirdparty_scripts: scripts.map((s) => s.src), unpinned, noSri, safeBrowsing, virusTotal });
    return { sensitive_files_public: found, server_answers_200_to_missing_pages: soft404, missing_page_status: e404.status, standard_files: std, third_party_scripts: scripts.length, third_party_domains: U.uniq(scripts.map((s) => U.hostOf(s.src))).slice(0, 20), unpinned_scripts: unpinned, cdn_libraries_without_integrity: noSri.slice(0, 5), old_jquery: oldJq, safe_browsing: safeBrowsing, virustotal: virusTotal };
  },
};
U.standalone(module.exports, module);
