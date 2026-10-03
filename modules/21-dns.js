// 21-dns: domain registration, DNS, email authentication, where the server physically is. All free, no key.
const U = require("../lib/util");
const T = require("../lib/thresholds");

const TYPES = { A: 1, AAAA: 28, NS: 2, MX: 15, TXT: 16, CAA: 257, CNAME: 5 };
async function doh(name, type) {
  const r = await U.getJson(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { timeout: 15000 });
  if (!r.ok || !r.json.Answer) return [];
  return r.json.Answer.filter((a) => a.type === TYPES[type]).map((a) => String(a.data).replace(/^"|"$/g, "").replace(/" "/g, ""));
}

module.exports = {
  id: "21-dns", name: "Domain, DNS, email authentication", tiers: ["bid", "full"], doh,
  async run(ctx) {
    const site = ctx.site, d = site.reg_domain;
    const [A, AAAA, NS, MX, TXT, CAA, DMARC] = await Promise.all([doh(site.host, "A"), doh(site.host, "AAAA"), doh(d, "NS"), doh(d, "MX"), doh(d, "TXT"), doh(d, "CAA"), doh(`_dmarc.${d}`, "TXT")]);
    const spf = TXT.filter((t) => /^v=spf1/i.test(t)), dmarc = DMARC.find((t) => /^v=DMARC1/i.test(t)) || null;
    const selectors = ["default", "google", "selector1", "selector2", "k1", "k2", "s1", "s2", "mail", "dkim", "smtp", "mandrill", "mailjet", "sendgrid", "zoho", "protonmail", "hs1", "hs2", "klaviyo", "mte1"]; const dkimFound = [];
    await U.pool(selectors, 6, async (s) => { const r = await doh(`${s}._domainkey.${d}`, "TXT"); const c = await doh(`${s}._domainkey.${d}`, "CNAME"); if (r.some((t) => /v=DKIM1|k=rsa|p=/i.test(t)) || c.length) dkimFound.push(s); });
    const dmarcPolicy = dmarc ? (dmarc.match(/\bp=(\w+)/i) || [])[1] || null : null;
    const spfLookups = spf[0] ? (spf[0].match(/\b(include:|a:|mx:|ptr|exists:|redirect=)/gi) || []).length : 0;
    const email = { mx: MX.slice(0, 4), provider: /google|googlemail/i.test(MX.join()) ? "Google Workspace" : /outlook|protection\.outlook/i.test(MX.join()) ? "Microsoft 365" : /zoho/i.test(MX.join()) ? "Zoho" : MX.length ? "other" : "none", spf: spf[0] || null, spf_count: spf.length, spf_all: spf[0] ? (spf[0].match(/[~\-+?]all/) || [])[0] || null : null, spf_dns_lookups: spfLookups, dmarc, dmarc_policy: dmarcPolicy, dkim_selectors_found: dkimFound };
    const issues = [];
    if (MX.length) { if (!spf.length) issues.push("no SPF record"); if (spf.length > 1) issues.push("more than one SPF record (invalidates SPF)"); if (spf[0] && /\+all/.test(spf[0])) issues.push("SPF ends in +all (allows anyone)"); if (spfLookups > 10) issues.push(`SPF needs ${spfLookups} DNS lookups (limit is 10)`); if (!dmarc) issues.push("no DMARC record"); else if (dmarcPolicy === "none") issues.push("DMARC policy is p=none (monitor only, spoofed mail is still delivered)"); if (!dkimFound.length) issues.push("no DKIM key found on common selectors (may use a custom selector)"); }

    // registration
    let reg = null; const r = await U.getJson(`https://rdap.org/domain/${d}`, { timeout: 25000 });
    if (r.ok && r.json.events) { const ev = (n) => (r.json.events.find((e) => e.eventAction === n) || {}).eventDate || null; const exp = ev("expiration"); reg = { registered: ev("registration"), expires: exp, days_to_expiry: exp ? Math.round((new Date(exp) - Date.now()) / 864e5) : null, age_years: ev("registration") ? U.round((Date.now() - new Date(ev("registration"))) / 31557600000, 1) : null, registrar: ((r.json.entities || []).find((e) => (e.roles || []).includes("registrar")) || {}).vcardArray ? String((((r.json.entities || []).find((e) => (e.roles || []).includes("registrar")).vcardArray[1] || []).find((v) => v[0] === "fn") || [])[3] || "") : null, status: (r.json.status || []).slice(0, 3) }; }

    // server location + host
    let server = null; if (A[0]) { const g = await U.getJson(`https://ipwho.is/${A[0]}`, { timeout: 15000 }); if (g.ok && g.json.success) server = { ip: A[0], country: g.json.country, country_code: g.json.country_code, city: g.json.city, org: (g.json.connection || {}).org || null, isp: (g.json.connection || {}).isp || null, asn: (g.json.connection || {}).asn || null }; else server = { ip: A[0] }; }
    const green = await U.getJson(`https://api.thegreenwebfoundation.org/api/v3/greencheck/${site.host}`, { timeout: 15000 });

    ctx.write("data/dns.json", { A, AAAA, NS, MX, TXT, CAA, email, reg, server, green: green.ok ? green.json : null });
    return { registration: reg || "not available over RDAP for this TLD", domain_expiring_soon: reg && reg.days_to_expiry != null ? reg.days_to_expiry < T.DOMAIN_EXPIRY_DAYS : null, server, ipv6: AAAA.length > 0, nameservers: NS.slice(0, 3), caa: CAA.length ? CAA.slice(0, 3) : "none", email, email_auth_issues: issues, green_hosting: green.ok ? !!green.json.green : null, green_host_name: green.ok ? green.json.hosted_by || null : null, verification_txt: TXT.filter((t) => /verification|verify|=/.test(t) && !/^v=spf1/i.test(t)).map((t) => t.split("=")[0].slice(0, 40)).slice(0, 8) };
  },
};
U.standalone(module.exports, module);
