// 12-links: checks every link target the crawl saw but did not fetch. Broken internal links, broken outbound links, chains.
const fs = require("fs");
const path = require("path");
const U = require("../lib/util");

module.exports = {
  id: "12-links", name: "Broken links and redirect chains", tiers: ["full"],
  async run(ctx) {
    const t = ctx.read("data/link-targets.json"); if (!t) return U.skipped("run 11-analyze first");
    const skip = /\.(jpe?g|png|gif|webp|svg|pdf|zip|mp4)(\?|$)|[?&](add-to-cart|replytocom|s|orderby|filter_)=|\/wp-login|\/feed\/?$/i;
    const internal = t.internal.filter((u) => !skip.test(u)).slice(0, 400), external = t.external.filter((u) => !/(facebook|instagram|linkedin|twitter|x|tiktok|pinterest|youtube|wa\.me|whatsapp)\.com|wa\.me|maps\.(app\.)?goo/i.test(u)).slice(0, 200);
    const chk = async (u) => { const r = await U.probe(u); return { url: u, status: r.status, hops: r.chain.length, lands_on: r.chain.length ? r.finalUrl : null, error: r.error || null }; };
    const ri = await U.pool(internal, 4, chk, 250), re = await U.pool(external, 6, chk, 100);
    // a timeout is not a broken link: retry those one at a time, slowly, before judging
    for (const list of [ri, re]) for (let i = 0; i < list.length; i++) if (!list[i].status) { await U.sleep(1200); list[i] = await chk(list[i].url); }

    // which pages carry each broken link
    const crawl = fs.readFileSync(path.join(ctx.dataDir, "crawl.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const foundOn = (target, key) => { const hits = crawl.filter((p) => (p[key] || []).includes(target)); return { pages: hits.length, first: hits[0] ? hits[0].url : null }; };
    const bad = (x) => x.status === 404 || x.status === 410 || x.status >= 500;
    const bi = ri.filter(bad).map((x) => Object.assign(x, foundOn(x.url, "internal_links"))), be = re.filter(bad).map((x) => Object.assign(x, foundOn(x.url, "external_links")));
    const chains = ri.filter((x) => x.hops > 1);
    ctx.write("data/links.json", { internal: ri, external: re, broken_internal: bi, broken_external: be });
    const fmt = (x) => `${x.status || x.error} ${x.url} (linked from ${x.pages} pages, e.g. ${x.first})`;
    return { internal_checked: ri.length, external_checked: re.length, broken_internal: bi.length, broken_internal_examples: U.top(bi.sort((a, b) => b.pages - a.pages), 5).map(fmt), broken_external: be.length, broken_external_examples: U.top(be.sort((a, b) => b.pages - a.pages), 4).map(fmt), unverified_after_retry: ri.concat(re).filter((x) => !x.status).length, internal_links_that_redirect: ri.filter((x) => x.hops > 0).length, chains_over_1_hop: chains.length, chain_examples: U.top(chains, 3).map((x) => `${x.url} -> ${x.lands_on} (${x.hops} hops)`), http_links_on_https_site: t.internal.filter((u) => /^http:/.test(u)).length };
  },
};
U.standalone(module.exports, module);
