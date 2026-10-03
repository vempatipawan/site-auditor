// 50-wp: WordPress only. Builds the plugin register with a drafted verdict per plugin, checks versions against
// wordpress.org and the public vulnerability database, and looks for the usual things left open. GET requests only.
const U = require("../lib/util");

const cmp = (a, b) => { const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; } return 0; };
const CATEGORY = [[/seo|yoast|rank-math|all-in-one-seo|seopress/i, "seo"], [/rocket|w3-total|super-cache|litespeed|autoptimize|wp-optimize|perfmatters|flying|nitropack|breeze|hummingbird|swift-performance|fastest-cache|sg-cachepress/i, "speed"], [/revslider|slider|smart-slider|layerslider|metaslider/i, "slider"], [/contact-form|wpforms|gravityforms|ninja-forms|formidable|fluentform|forminator/i, "forms"], [/elementor|js_composer|beaver|divi|bricks|oxygen|brizy|siteorigin/i, "builder"], [/wordfence|sucuri|ithemes-security|better-wp-security|all-in-one-wp-security|solid-security/i, "security"], [/cookie|gdpr|complianz|consent|cookiebot|iubenda/i, "consent"], [/analytics|gtm|tag-manager|site-kit|monsterinsights|pixel|facebook-for/i, "tracking"], [/wpml|polylang|translatepress|weglot|sitepress/i, "multilingual"], [/smush|imagify|shortpixel|ewww|optimole|webp/i, "images"], [/woocommerce|wc-|woo-/i, "commerce"], [/backup|updraft|duplicator|all-in-one-wp-migration/i, "backup"], [/mailchimp|klaviyo|hubspot|mailpoet|activecampaign/i, "marketing"]];
const category = (slug) => (CATEGORY.find(([re]) => re.test(slug)) || [, "other"])[1];

module.exports = {
  id: "50-wp", name: "WordPress: plugin register, versions, exposure", tiers: ["bid", "full"],
  async run(ctx) {
    const site = ctx.site; if (site.fingerprint.platform !== "wordpress") return U.skipped("not WordPress");
    const O = site.origin, home = (await U.fetchText(site.home)).text;
    const get = (p, o) => U.fetchText(O + p, Object.assign({ timeout: 15000 }, o));

    // core
    const latest = await U.getJson("https://api.wordpress.org/core/version-check/1.7/"); const latestCore = latest.ok ? latest.json.offers[0].version : null;
    let core = (site.fingerprint.generators.find((g) => /^WordPress\s+[\d.]+/i.test(g)) || "").replace(/^WordPress\s+/i, "") || null, coreSource = core ? "generator tag" : null;
    if (!core) { const feed = await get("/feed/"); const m = feed.text.match(/<generator>[^<]*\?v=([\d.]+)/i); if (m) { core = m[1]; coreSource = "feed"; } }
    const php = (site.fingerprint.powered_by || "").match(/PHP\/([\d.]+)/i); const woo = (site.fingerprint.generators.find((g) => /woocommerce/i.test(g)) || "").replace(/[^\d.]/g, "") || null;

    // REST root reveals plugin namespaces even when assets are hidden
    const rest = await U.getJson(O + "/wp-json/", { timeout: 20000 }); const namespaces = rest.ok && rest.json.namespaces ? rest.json.namespaces.filter((n) => !/^(wp\/|oembed|wp-site-health|wp-block-editor)/.test(n)) : [];

    // plugin register
    // plugins show up two ways: asset paths in the HTML, and REST namespaces (which survive asset-combining plugins)
    const NS_MAP = { wordfence: "wordfence", leadin: "leadin", "lazy-blocks": "lazy-blocks", kbp: "kadence-blocks-pro", wpml: "sitepress-multilingual-cms", yoast: "wordpress-seo", rankmath: "seo-by-rank-math", "contact-form-7": "contact-form-7", elementor: "elementor", "wp-rocket": "wp-rocket", jetpack: "jetpack", redirection: "redirection", litespeed: "litespeed-cache", wpforms: "wpforms-lite", gravityforms: "gravityforms", complianz: "complianz-gdpr", mailpoet: "mailpoet", "google-site-kit": "google-site-kit", "wp-mail-smtp": "wp-mail-smtp", updraftplus: "updraftplus", akismet: "akismet", mollie: "mollie-payments-for-woocommerce", "wc-stripe": "woocommerce-gateway-stripe", "wordfence-login-security": "wordfence", wc: null, "wc-admin": null, wccom: null, "wc-analytics": null, "wc-telemetry": null, "wccom-site": null };
    const fromNs = U.uniq(namespaces.map((n) => n.split("/")[0]).map((n) => (n in NS_MAP ? NS_MAP[n] : n.startsWith("kb-") ? "kadence-blocks" : n)).filter(Boolean));
    const an = ctx.read("data/analysis.json"); const fromAssets = U.uniq([...(an ? an.plugins_seen : []), ...site.fingerprint.plugins_on_home]);
    const slugs = U.uniq([...fromAssets, ...fromNs]).slice(0, 70);
    const verIn = (slug) => { const m = [...home.matchAll(new RegExp(`/plugins/${slug}/[^"'\\s]*?[?&]ver=([\\d.]+)`, "gi"))].map((x) => x[1]); const c = {}; m.forEach((v) => (c[v] = (c[v] || 0) + 1)); return (Object.entries(c).sort((a, b) => b[1] - a[1])[0] || [])[0] || null; };
    const plugins = await U.pool(slugs, 4, async (slug) => {
      const p = { slug, category: category(slug), version: null, version_source: null, found_via: fromAssets.includes(slug) ? "page assets" : "REST namespace" };
      // most reliable first: the platform's own generator tag, then ?ver= on the plugin's assets, then the readme (its Stable tag can lag the running version)
      if (slug === "woocommerce" && woo) { p.version = woo; p.version_source = "generator tag"; p.version_confidence = "high"; }
      if (!p.version) { const v0 = verIn(slug); if (v0 && v0 !== core) { p.version = v0; p.version_source = "asset ?ver="; p.version_confidence = "medium"; } }
      const rd = await get(`/wp-content/plugins/${slug}/readme.txt`); if (rd.status === 200 && /===/.test(rd.text.slice(0, 400))) { const st = rd.text.match(/^\s*Stable tag:\s*([\d.]+)/im); if (st && !p.version) { p.version = st[1]; p.version_source = "readme.txt Stable tag"; p.version_confidence = "low"; } p.readme_public = true; p.name = (rd.text.match(/^===\s*(.+?)\s*===/m) || [])[1] || null; }
      const info = await U.getJson(`https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=${slug}&request[fields][active_installs]=1`, { timeout: 20000 });
      if (info.ok && info.json.version) { p.on_wordpress_org = true; p.name = p.name || info.json.name; p.latest = info.json.version; p.last_updated = (info.json.last_updated || "").slice(0, 10); p.tested_up_to = info.json.tested; p.active_installs = info.json.active_installs; p.years_since_update = p.last_updated ? U.round((Date.now() - new Date(p.last_updated)) / 31557600000, 1) : null; } else p.on_wordpress_org = false;
      const vu = await U.getJson(`https://www.wpvulnerability.net/plugin/${slug}/`, { timeout: 20000 });
      if (vu.ok && vu.json.data && Array.isArray(vu.json.data.vulnerability)) { const all = vu.json.data.vulnerability; p.closed = !!vu.json.data.closed; p.vulns_known_total = all.length;
        if (p.version) p.vulns_affecting = all.filter((v) => { const o = v.operator || {}; if (o.max_version && cmp(p.version, o.max_version) > (o.max_operator === "le" ? 0 : -1)) return false; if (o.min_version && cmp(p.version, o.min_version) < 0) return false; return !!o.max_version; }).map((v) => ({ name: v.name, severity: ((v.impact || {}).cvss || {}).severity || null, cve: ((v.source || []).find((s) => /CVE/i.test(s.id || "")) || {}).id || null })).slice(0, 5); }
      // drafted verdict. The model fact-checks before it ships.
      const behind = p.version && p.latest && cmp(p.version, p.latest) < 0;
      if (p.vulns_affecting && p.vulns_affecting.length && p.version_confidence === "low") { p.vulns_possible = p.vulns_affecting; p.vulns_affecting = []; }
      p.verdict = !p.on_wordpress_org && !p.readme_public && p.found_via === "REST namespace" && !p.vulns_known_total ? "CHECK" : p.vulns_affecting && p.vulns_affecting.length ? "UPDATE NOW" : p.closed ? "REPLACE" : p.years_since_update > 2 ? "REPLACE" : behind ? "UPDATE" : "KEEP";
      p.reason = p.vulns_affecting && p.vulns_affecting.length ? `version ${p.version} has ${p.vulns_affecting.length} published vulnerability report(s)` : p.closed ? "closed on wordpress.org, no more updates" : p.years_since_update > 2 ? `no release for ${p.years_since_update} years` : behind ? `running ${p.version}, latest is ${p.latest}` : p.on_wordpress_org ? (p.version ? "current and maintained" : "maintained; running version not visible from outside") : "premium or custom: version not publicly checkable";
      if (p.vulns_possible) p.reason += `. NOTE: the readme suggests ${p.version}, a version with published vulnerability reports; confirm the running version with access`;
      return p;
    }, 150);
    // REST namespaces that are not a standalone plugin (core, WooCommerce internals) are listed, not judged
    const unrecognised = plugins.filter((p) => p.verdict === "CHECK").map((p) => p.slug); for (let i = plugins.length - 1; i >= 0; i--) if (plugins[i].verdict === "CHECK") plugins.splice(i, 1);
    const overlaps = Object.entries(plugins.reduce((m, p) => { if (["seo", "speed", "slider", "forms", "builder", "security", "consent", "images"].includes(p.category)) (m[p.category] = m[p.category] || []).push(p.slug); return m; }, {})).filter(([, v]) => v.length > 1).map(([k, v]) => `${k}: ${v.join(", ")}`);

    // theme
    const themeSlug = site.fingerprint.themes[0]; let theme = null;
    if (themeSlug) { const st = await get(`/wp-content/themes/${themeSlug}/style.css`); const f = (k) => (st.text.match(new RegExp(`^\\s*${k}:\\s*(.+)$`, "im")) || [])[1] || null; theme = { slug: themeSlug, name: f("Theme Name"), version: f("Version"), parent: f("Template"), author: f("Author"), all_themes_seen: site.fingerprint.themes }; }

    // things left open (plain GETs, nothing sent)
    const E = {};
    const users = await U.getJson(O + "/wp-json/wp/v2/users?per_page=10", { timeout: 15000 }); E.rest_user_list = users.ok && Array.isArray(users.json) && users.json.length ? users.json.map((u) => u.slug).slice(0, 6) : false;
    const au = await get("/?author=1", { noBody: true }); E.author_archive_reveals_login = /\/author\/([^/]+)/.test(au.finalUrl) ? au.finalUrl.match(/\/author\/([^/]+)/)[1] : false;
    const x = await get("/xmlrpc.php"); E.xmlrpc_open = x.status === 405 || /XML-RPC server accepts POST/i.test(x.text);
    const lg = await get("/wp-login.php", { noBody: true }); E.default_login_url_public = lg.status === 200;
    const rh = await get("/readme.html"); E.readme_html_public = rh.status === 200 && /wordpress/i.test(rh.text.slice(0, 2000));
    // only the first 300 bytes are requested, to confirm it is a real PHP log. Contents are never stored.
    const dl = await get("/wp-content/debug.log", { headers: { Range: "bytes=0-300" } }); E.debug_log_public = [200, 206].includes(dl.status) && /^\[\d{2}-\w{3}-\d{4} /.test(dl.text); if (E.debug_log_public) E.debug_log_first_entry_date = dl.text.slice(1, 12);
    const up = await get("/wp-content/uploads/"); E.uploads_directory_listing = up.status === 200 && /<title>Index of/i.test(up.text);
    const pl = await get("/wp-content/plugins/"); E.plugins_directory_listing = pl.status === 200 && /<title>Index of/i.test(pl.text);
    E.plugin_readmes_public = plugins.filter((p) => p.readme_public).length;

    const perf = { cart_fragments_on_home: /wc-cart-fragments|cart-fragments(\.min)?\.js/i.test(home), jquery_migrate: /jquery-migrate/i.test(home), jquery_version: (home.match(/jquery(?:\.min)?\.js\?ver=([\d.]+)/i) || [])[1] || null, emoji_script: /wp-emoji-release/i.test(home), block_library_css_on_home: /block-library\/style/i.test(home), admin_ajax_in_source: /admin-ajax\.php/i.test(home), dashicons_for_visitors: /dashicons(\.min)?\.css/i.test(home), speculation_rules: /type=["']speculationrules["']/i.test(home) };

    ctx.write("data/wp.json", { core, coreSource, latestCore, php: php ? php[1] : null, woo, namespaces, plugins, overlaps, theme, exposure: E, perf });
    ctx.write("client-pack/plugin-register.csv", ["plugin,name,category,version_running,latest_version,last_updated,verdict,reason", ...plugins.map((p) => [p.slug, p.name || "", p.category, p.version || "unknown", p.latest || "n/a", p.last_updated || "n/a", p.verdict, p.reason].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n"));
    const v = (k) => plugins.filter((p) => p.verdict === k);
    return { core: { running: core, latest: latestCore, behind: core && latestCore ? cmp(core, latestCore) < 0 : null, source: coreSource }, php_version_exposed: php ? php[1] : null, woocommerce: woo, theme, rest_namespaces: namespaces.slice(0, 20), plugins_found: plugins.length, verdicts: { "UPDATE NOW": v("UPDATE NOW").map((p) => `${p.slug} ${p.version} (${p.vulns_affecting.map((x) => x.cve || x.severity || "vuln").join(", ")})`), REPLACE: v("REPLACE").map((p) => `${p.slug} (${p.reason})`), UPDATE: v("UPDATE").map((p) => `${p.slug} ${p.version} -> ${p.latest} (${p.version_confidence} confidence, from ${p.version_source})`), KEEP: v("KEEP").length }, unrecognised_rest_namespaces: unrecognised, possibly_vulnerable_confirm_with_access: plugins.filter((p) => p.vulns_possible).map((p) => `${p.slug} (readme says ${p.version})`), version_unknown: plugins.filter((p) => !p.version).map((p) => p.slug), premium_or_custom: plugins.filter((p) => !p.on_wordpress_org).map((p) => p.slug), overlapping_plugins: overlaps, exposure: E, performance_flags: perf, register_file: "client-pack/plugin-register.csv", needs_model: "Fact-check every plugin verdict against the plugin's own documentation before it ships." };
  },
};
U.standalone(module.exports, module);
