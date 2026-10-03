// 23-wayback: the site's public history. Recovers every URL the Internet Archive has seen, finds the ones that
// used to work and now dead-end, and drafts a redirect map for them. Replaces the "needs Search Console" legacy-URL sweep.
const U = require("../lib/util");

const norm = (u) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname).replace(/\/$/, "").toLowerCase(); } catch { return u; } };
const ASSET = /\.(jpe?g|png|gif|webp|svg|ico|css|js|json|xml|txt|pdf|zip|woff2?|ttf|eot|mp4|map)(\?|$)/i;
const NOISE = /(wp-json|wp-admin|wp-login|wp-content|wp-includes|xmlrpc|\/feed\/?$|\/embed\/?$|\/amp\/?$|[?&](add-to-cart|s|p|replytocom|orderby)=|\/page\/\d+|\/\.well-known|\/cdn-cgi|\/cart|\/checkout|\/my-account|add-to-cart|%|\/tag\/|\/author\/)/i;

module.exports = {
  id: "23-wayback", name: "Site history and legacy URLs (Wayback)", tiers: ["bid", "full"],
  async run(ctx) {
    const site = ctx.site, d = site.bare_domain, bid = ctx.opts.tier === "bid";
    const q = `https://web.archive.org/cdx/search/cdx?url=${d}/*&output=json&fl=original,timestamp,statuscode,mimetype&filter=statuscode:200&filter=mimetype:text/html&collapse=urlkey&limit=20000`;
    const cdx = async (u, t = 40000) => { let x = null; for (let i = 0; i < 3 && !(x && x.ok); i++) { x = await U.getJson(u, { timeout: t }); if (!x.ok) await U.sleep(4000); } return x; };
    const r = await cdx(q, 90000);
    if (!r || !r.ok || !Array.isArray(r.json)) return { status: "partial", reason: "Wayback CDX did not answer; re-run this module alone" };
    const rows = r.json.slice(1).map(([original, ts]) => ({ url: original, ts })).filter((x) => !ASSET.test(x.url) && !NOISE.test(x.url));
    const first = await cdx(`https://web.archive.org/cdx/search/cdx?url=${d}&output=json&fl=timestamp&limit=1`);
    const last = await cdx(`https://web.archive.org/cdx/search/cdx?url=${d}&output=json&fl=timestamp&limit=-1`);
    const yr = await cdx(`https://web.archive.org/cdx/search/cdx?url=${d}&output=json&fl=timestamp&collapse=timestamp:4&limit=40`);
    const ts = (j) => (j && j.ok && j.json[1] ? `${j.json[1][0].slice(0, 4)}-${j.json[1][0].slice(4, 6)}` : null);

    const live = new Set(ctx.read("urls.json", []).map((u) => norm(u.url)));
    const byKey = new Map(); for (const x of rows) { const k = norm(x.url); if (!byKey.has(k)) byKey.set(k, x); }
    const legacy = [...byKey.entries()].filter(([k]) => !live.has(k) && k !== d).map(([k, v]) => ({ key: k, url: `https://${site.host}${new URL(v.url).pathname}`, last_seen: v.ts.slice(0, 4) }));
    ctx.write("data/wayback-urls.json", { total_html_urls: byKey.size, legacy });

    // check which legacy URLs still resolve. Bid tier only counts them.
    let checked = []; const budget = bid ? 0 : Math.min(legacy.length, 300);
    if (budget) { const sample = legacy.slice().sort((a, b) => b.last_seen.localeCompare(a.last_seen)).slice(0, budget);
      checked = await U.pool(sample, 4, async (l) => { const p = await U.probe(l.url); return Object.assign({}, l, { status: p.status, lands_on: p.chain.length ? p.finalUrl : null }); }, 250);
      const liveList = ctx.read("urls.json", []).map((u) => u.url);
      const dead = checked.filter((c) => c.status === 404 || c.status === 410);
      // draft redirect map: best live URL sharing the longest slug token overlap
      const tokens = (u) => new URL(u).pathname.toLowerCase().split(/[\/\-_]+/).filter((t) => t.length > 2);
      const map = dead.map((c) => { const t = new Set(tokens(c.url)); let best = null, score = 0; for (const lu of liveList) { const s = tokens(lu).filter((x) => t.has(x)).length; if (s > score) { score = s; best = lu; } } return { from: new URL(c.url).pathname, to: best && score >= 1 ? new URL(best).pathname : "/", confidence: score >= 2 ? "good" : score === 1 ? "review" : "fallback-home", last_seen: c.last_seen }; });
      ctx.write("data/legacy-redirect-map.json", map);
      ctx.write("client-pack/legacy-redirect-map.csv", ["from,to,confidence,last_seen_in_archive", ...map.map((m) => `${m.from},${m.to},${m.confidence},${m.last_seen}`)].join("\n"));
    }
    const dead = checked.filter((c) => c.status === 404 || c.status === 410);
    return { first_capture: ts(first), last_capture: ts(last), years_with_captures: yr && yr.ok ? yr.json.slice(1).map((x) => x[0].slice(0, 4)) : null, archived_html_urls: byKey.size, legacy_urls_not_in_sitemap: legacy.length, legacy_checked: checked.length, legacy_now_dead: dead.length, legacy_redirecting: checked.filter((c) => c.lands_on).length, legacy_still_live_but_not_in_sitemap: checked.filter((c) => c.status === 200 && !c.lands_on).length, dead_examples: U.top(dead, 6).map((c) => `${c.url} (last seen ${c.last_seen})`), redirect_map: dead.length ? "client-pack/legacy-redirect-map.csv" : null };
  },
};
U.standalone(module.exports, module);
