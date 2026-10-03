// 37-globalping: first-byte time measured from the cities where the client's customers actually are,
// split into DNS, connect, TLS and server wait. Works without a key (250 tests/hr); GLOBALPING_TOKEN raises it to 500.
const U = require("../lib/util");

const BY_COUNTRY = { nl: ["Amsterdam", "Rotterdam", "Brussels", "Frankfurt"], be: ["Brussels", "Amsterdam", "Paris", "Frankfurt"], de: ["Berlin", "Frankfurt", "Munich", "Vienna"], at: ["Vienna", "Munich", "Frankfurt", "Zurich"], ch: ["Zurich", "Geneva", "Frankfurt", "Milan"], fr: ["Paris", "Marseille", "Brussels", "Frankfurt"], gb: ["London", "Manchester", "Dublin", "Amsterdam"], uk: ["London", "Manchester", "Dublin", "Amsterdam"], ie: ["Dublin", "London", "Manchester", "Amsterdam"], us: ["New York", "Chicago", "Dallas", "Los Angeles"], ca: ["Toronto", "Vancouver", "Montreal", "New York"], au: ["Sydney", "Melbourne", "Brisbane", "Singapore"], nz: ["Auckland", "Sydney", "Melbourne", "Singapore"], in: ["Mumbai", "Delhi", "Bangalore", "Singapore"], ae: ["Dubai", "Mumbai", "Frankfurt", "Singapore"], dk: ["Copenhagen", "Stockholm", "Hamburg", "Amsterdam"], se: ["Stockholm", "Copenhagen", "Oslo", "Frankfurt"] };

module.exports = {
  id: "37-globalping", name: "First-byte time from the customers' cities", tiers: ["bid", "full"],
  async run(ctx) {
    const site = ctx.site, tld = site.host.split(".").pop().toLowerCase(), brief = site.brief || {};
    const dns = ctx.read("data/dns.json") || {}, serverCc = dns.server && dns.server.country_code ? dns.server.country_code.toLowerCase() : null;
    // customer country: explicit flag, then the brief, then a country TLD, then where the server sits, then US
    const country = String(ctx.opts.country || brief.country_code || (BY_COUNTRY[tld] ? tld : null) || (BY_COUNTRY[serverCc] ? serverCc : "us")).toLowerCase();
    const cities = (ctx.opts.cities ? String(ctx.opts.cities).split(",").map((c) => c.trim()) : BY_COUNTRY[country] || BY_COUNTRY.us).slice(0, 6);
    const headers = ctx.env.GLOBALPING_TOKEN ? { Authorization: `Bearer ${ctx.env.GLOBALPING_TOKEN}` } : {};
    const measure = async (u) => {
      const make = await U.postJson("https://api.globalping.io/v1/measurements", { type: "http", target: u.hostname, locations: cities.map((c) => ({ city: c, limit: 1 })), measurementOptions: { protocol: "HTTPS", request: Object.assign({ method: "GET", path: u.pathname }, u.search.length > 1 ? { query: u.search.slice(1) } : {}) } }, { headers, timeout: 30000 });
      if (!make.json || !make.json.id) return { fail: `Globalping refused the measurement (${make.status}); the hourly free limit may be used up` };
      for (let i = 0; i < 25; i++) { await U.sleep(2000); const r = await U.getJson(`https://api.globalping.io/v1/measurements/${make.json.id}`, { headers }); if (r.ok && r.json.status === "finished") return { id: make.json.id, rows: r.json.results.map((x) => { const t = x.result.timings || {}; return { city: x.probe.city, country: x.probe.country, network: x.probe.network, status: x.result.statusCode, location: (x.result.headers || {}).location || null, dns_ms: t.dns, connect_ms: t.tcp, tls_ms: t.tls, server_wait_ms: t.firstByte, download_ms: t.download, total_ms: t.total }; }) }; }
      return { fail: "measurement did not finish in 50s" };
    };
    // Ask for the clean origin, not the address this machine was redirected to: redirects can differ per visitor country.
    const first = await measure(new URL(site.origin + "/")); if (first.fail) return { status: "partial", reason: first.fail };
    let rows = first.rows, redirect = null;
    const redirected = rows.filter((r) => r.status >= 300 && r.status < 400 && r.location);
    if (redirected.length >= rows.length / 2) { // most cities were sent elsewhere first: time the page they end up on, and keep the hop as its own cost
      const tally = {}; for (const r of redirected) tally[r.location] = (tally[r.location] || 0) + 1; const target = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
      let next = null; try { const t = new URL(target, site.origin + "/"); if (U.sameSite(t.toString(), site.host)) next = await measure(t); } catch {}
      redirect = { status: redirected[0].status, to: target, median_hop_ms: U.median(redirected.map((r) => r.total_ms)), followed: !!(next && next.rows) };
      if (next && next.rows) rows = next.rows;
    }
    ctx.write("data/globalping.json", { id: first.id, country, redirect, first_request: first.rows, rows });
    const ok = rows.filter((r) => r.server_wait_ms != null), final200 = ok.length && ok.every((r) => r.status === 200);
    return { country_assumed: country, redirect_before_page: redirect ? `every visit is first answered with a ${redirect.status} redirect to ${redirect.to} (median ${redirect.median_hop_ms} ms for that extra round trip); the rows below time ${redirect.followed ? "the page after the redirect" : "the redirect itself, the follow-up could not be measured"}` : null, final_status_all_200: final200, measured_from: rows.map((r) => `${r.city}, ${r.country}`), rows: ok.map((r) => `${r.city}: dns ${r.dns_ms} + connect ${r.connect_ms} + tls ${r.tls_ms} + server wait ${r.server_wait_ms} + download ${r.download_ms} = ${r.total_ms} ms (status ${r.status})`), median_server_wait_ms: U.median(ok.map((r) => r.server_wait_ms)), median_total_ms: U.median(ok.map((r) => r.total_ms)), slowest_city: ok.length ? ok.slice().sort((a, b) => b.total_ms - a.total_ms)[0].city : null, note: "One request per city. Server wait is the time the site itself took to answer; the rest is network." };
  },
};
U.standalone(module.exports, module);
