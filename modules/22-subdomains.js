// 22-subdomains: every hostname that ever got a certificate for this domain (certificate transparency),
// then a plain GET on each to see which staging / dev / old copies are open to the public and to search engines.
const U = require("../lib/util");
const T = require("../lib/thresholds");

module.exports = {
  id: "22-subdomains", name: "Subdomains and exposed staging copies", tiers: ["bid", "full"],
  async run(ctx) {
    const site = ctx.site, d = site.reg_domain;
    let rows = null; for (let i = 0; i < 3 && !rows; i++) { const r = await U.getJson(`https://crt.sh/?q=%25.${d}&output=json`, { timeout: 60000 }); if (r.ok && Array.isArray(r.json)) rows = r.json; else await U.sleep(4000); }
    if (!rows) return { status: "partial", reason: "crt.sh did not answer (it is often busy); re-run this module alone", subdomains: [] };
    const names = U.uniq(rows.flatMap((r) => String(r.name_value || "").split("\n")).map((n) => n.trim().toLowerCase().replace(/^\*\./, "")).filter((n) => n.endsWith(d) && n !== d && n !== "www." + d && !n.includes("@"))).slice(0, 60);
    const lastSeen = {}; for (const r of rows) for (const n of String(r.name_value || "").split("\n")) { const k = n.trim().toLowerCase().replace(/^\*\./, ""); if (!lastSeen[k] || r.not_before > lastSeen[k]) lastSeen[k] = r.not_before; }

    const checked = await U.pool(names, 4, async (n) => {
      const r = await U.fetchText(`https://${n}/`, { timeout: 15000 }); const live = r.ok && r.status < 500;
      const rec = { host: n, cert_last_issued: (lastSeen[n] || "").slice(0, 10), status: r.status || 0, error: r.error || null, lands_on: r.finalUrl && U.hostOf(r.finalUrl) !== n ? r.finalUrl : null, looks_nonprod: T.STAGING_NAME_RE.test(n.replace("." + d, "")) };
      if (live && r.status === 200 && !rec.lands_on) {
        rec.title = U.decode((r.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").slice(0, 70);
        rec.noindex = /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(r.text) || /noindex/i.test(r.headers["x-robots-tag"] || "");
        rec.wordpress = /wp-content|wp-includes/i.test(r.text); rec.password_wall = r.status === 401 || /type=["']password["']/i.test(r.text.slice(0, 20000)) && r.text.length < 30000;
        const rb = await U.fetchText(`https://${n}/robots.txt`, { timeout: 10000 }); rec.robots_blocks_all = rb.status === 200 && /user-agent:\s*\*[\s\S]{0,80}disallow:\s*\/\s*$/im.test(rb.text);
        rec.open_to_search_engines = !rec.noindex && !rec.robots_blocks_all && !rec.password_wall;
      } else if (r.status === 401 || r.status === 403) rec.password_wall = true;
      return rec;
    }, 200);
    ctx.write("data/subdomains.json", checked);
    const live = checked.filter((c) => c.status === 200 && !c.lands_on), exposed = live.filter((c) => c.looks_nonprod);
    return { found: names.length, live: live.length, redirecting_to_main: checked.filter((c) => c.lands_on).length, dead: checked.filter((c) => !c.status).length, nonprod_public: exposed.map((c) => ({ host: c.host, title: c.title, wordpress: c.wordpress, open_to_search_engines: c.open_to_search_engines, cert_last_issued: c.cert_last_issued })), other_live: live.filter((c) => !c.looks_nonprod).map((c) => `${c.host} "${c.title || ""}"`).slice(0, 10), protected: checked.filter((c) => c.password_wall).map((c) => c.host).slice(0, 8) };
  },
};
U.standalone(module.exports, module);
