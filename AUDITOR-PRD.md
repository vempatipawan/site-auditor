# PRD: Site Auditor Engine

Version 1 · 2026-09-20 · Owner: Pawan Agent · Location: `tools/site-auditor/`

Trigger phrase: **"website auditor: launch"** + URL (+ optional job post, tier, client slug).

---

## 1. Why this exists

Four outside-in audits have been built by hand: Frozen Solutions (BigCommerce, 750 URLs), Craft Coffee & Pastry (WooCommerce), Said & Co Bullion (WooCommerce, 30 pp), Golfyr (bid-scan inside a cover letter). Each one won attention. Each one re-invented its own scripts with the client's domain hard-coded, and the model read raw data to write every finding. Frozen alone cost roughly 40 percent of a usage window.

The audit is the wedge that wins WordPress jobs. It has to become a product: one command, one standard, a fraction of the tokens.

**Scope:** URL only. No logins, no analytics, no control panel. The paid, with-access Milestone 1 audit is the freelancer's delivery work and is out of scope.
**Fixes are included** in the free audit. **No Loom script.** **Free data sources only.**

## 2. The token principle

> **Scripts measure. The model judges.**

| Work | Who | Tokens |
|---|---|---|
| Fetching, crawling, parsing, timing, counting, comparing to thresholds | node scripts | 0 |
| Turning a breached threshold into a drafted finding with evidence, fix, effort | rules engine + fix library | 0 |
| Assembling the report skeleton, CSVs, PDF, client pack | templates | 0 |
| Looking at screenshots | model, via contact sheets | low |
| Picking the five that matter, challenging the brief, fact-checking, humanizing, red-team | model | the only real spend |

Hard rules that enforce it:

1. **No raw data in the thread.** Every module writes bulk output to `data/` and returns a **summary object of at most ~60 lines** to `summaries/<module>.json`. A 750-URL crawl reaches the model as counts plus the 5 worst examples per issue.
2. **One file to read.** The orchestrator ends by writing `DIGEST.md` (target 300 to 450 lines). The model reads that and nothing else unless a line in it says `needs_model`.
3. **Findings arrive pre-drafted.** `90-findings.js` applies `lib/rules.js` to the summaries. Each rule carries severity, impact, effort, a plain-English "why it costs you", and the fix. The model edits, merges, re-ranks. It does not compose 20 findings from scratch.
4. **Screenshots come as contact sheets.** `96-contactsheet.js` tiles thumbnails into a few PNGs so 30 screenshots cost 3 image reads, not 30. The model opens a full-size shot only when a thumbnail shows a problem.
5. **Nothing site-specific is hard-coded.** `00-discover.js` writes `site.json` (platform, templates, sample URLs, selectors). Every other module reads it.
6. **Every module is independently re-runnable** (`node modules/30-perf.js <outDir>`), so one failure never forces a full re-run.
7. **Keys are optional.** Key in `.env` means the module runs. No key means `{status:"skipped", reason:"no GOOGLE_API_KEY"}` and the digest prints "not run". Never an error, never a prompt to the founder.

Expected model reading per audit: `DIGEST.md` (~400 lines) + 3 to 5 contact sheets + the job post. Everything else is writing.

## 3. Tiers

| Tier | Flag | Use | Runtime | What runs |
|---|---|---|---|---|
| **Bid-scan** | `--tier bid` | Findings to drop inside a cover letter (Golfyr pattern) | ~3 to 6 min | discover, headers, dns, subdomains, wayback (inventory only), wp, exposure, cache, perf (home + 1 money page, 1 run), tracking inventory, schema/AI, crux, observatory. **No full crawl.** |
| **Full** | `--tier full` (default) | The client PDF pack (Frozen/Craft/Said pattern) | ~20 to 60 min by site size | everything |

Both tiers end in the same `DIGEST.md` and `findings.csv`. Bid-scan skips the report/PDF stages and instead prints `BID-FINDINGS.md`: the top 8 to 10 findings phrased for a letter.

## 4. Folder layout

```
tools/site-auditor/
  AUDIT-CHECKLIST.md        portable "what an audit contains"
  AUDITOR-PRD.md            this file
  README.md                 launch SOP for the thread that runs an audit
  .env.example              key names + how to get each one (never commit .env)
  package.json              playwright, axe-core, marked
  audit.js                  orchestrator
  lib/
    util.js                 fetch with UA/timeout/redirect chain, pool, sleep, env loader, io helpers, summary writer
    thresholds.js           every pass/fail number in one place, each with its source
    rules.js                finding rules: condition -> drafted finding
    fixes.js                fix library: why-it-costs-you + fix + effort, keyed by rule id
  modules/                  one file per instrument (section 6)
  templates/
    report.md.tpl           report skeleton with {{MODEL:...}} slots
    recheck.mjs.tpl         client-runnable re-verification script
    pdf.css                 the midnight-and-gold editorial design (from Frozen render-pdf.js)
  runs/                     default output root (git-ignored)
```

Output of one run (`--out`, default `runs/<host>-<YYYY-MM-DD>/`):

```
site.json  urls.json  brief.json(optional, model-written)
data/           raw bulk output, never read by the model
summaries/      one small JSON per module
screenshots/    full-size PNGs     sheets/   contact sheets
findings.json  findings.csv  pages.csv  model-findings.json(optional)
DIGEST.md  AUDIT-DIGEST.json
AUDIT-REPORT.md  AUDIT-REPORT.pdf  BID-FINDINGS.md
client-pack/    what gets attached: PDF, CSVs, screenshots, recheck.mjs, redirect map
```

For real client work pass `--out clients/<slug>/proposals/<job>/audit` so the run is committed with the bid.

## 5. Orchestrator (`audit.js`)

```
node audit.js <url> [--tier bid|full] [--out <dir>] [--only 30,31] [--skip 34,40]
                    [--max-urls 1500] [--country nl] [--cities "Amsterdam,Berlin"] [--competitors a.com,b.com]
```

Stages, with parallelism inside a stage and ordering between stages:

1. **Discover** (serial): `00-discover`. Everything depends on `site.json`.
2. **Network stage** (parallel, no browser): `10-crawl`, `20-headers`, `21-dns`, `22-subdomains`, `23-wayback`, `35-crux`, `36-psi`, `37-globalping`, `38-benchmark`, `50-wp`, `51-exposure`, `70-schema-ai`.
3. **Analyze** (serial, after crawl): `11-analyze`, `12-links`.
4. **Browser stage** (serial, one Chromium at a time so timings stay honest): `30-perf`, `31-cache`, `32-coverage`, `33-inp`, `34-thirdparty`, `40-responsive`, `41-a11y`, `60-tracking`, `80-commerce`.
5. **Synthesize** (serial): `90-findings`, `96-contactsheet`, `91-digest`, and for full tier `92-report`, `94-recheck`, `95-pack`. `93-pdf` runs only after the model has filled the report slots.

Each module: `module.exports = { id, name, tier, needs:[], run(ctx) }` and is also directly runnable. `run` returns a summary object; the orchestrator writes it to `summaries/<id>.json` with `{status: ok|skipped|failed|partial, ms, reason?}`. A failed module never stops the run. Progress goes to stdout as one line per module, so the thread sees ~30 lines total.

Politeness: browser UA, concurrency 4, 300 ms stagger, honour `Crawl-delay`, cap at `--max-urls`. No POSTs to the target except the add-to-cart click in `80-commerce`. No login attempts. No form submissions.

## 6. Modules

Format: **what it measures → bulk file → what the summary contains.**

### Recon
- **00-discover** → `site.json`, `urls.json`. Host variants and the canonical host. robots.txt (raw, sitemap lines, crawl-delay, AI-bot rules). Sitemap index walk, URL list with `lastmod`. Template classification by path and sitemap name (home, product, category, page, post, cart, checkout, account, other). Platform fingerprint from homepage source: WordPress/WooCommerce/Shopify/BigCommerce/other, theme slug, builder (Elementor, WPBakery, Divi, Bricks, Gutenberg), generator tags. Picks **sample URLs**: home + up to 2 per template, preferring in-stock products. Summary: platform, counts per template, sample URLs, oddities.
- **21-dns** → `data/dns.json`. DoH lookups: A, AAAA, NS, MX, CAA, SPF, DMARC, DKIM on common selectors. RDAP: registration and expiry dates. IP to host, ASN, country (ipwho.is). Green hosting check. Summary: days to expiry, email-auth verdict, server country.
- **22-subdomains** → `data/subdomains.json`. crt.sh, de-duplicated, each one resolved and fetched: status, title, robots meta, robots.txt, platform. Flags names matching `stag|stage|dev|test|old|backup|beta|demo|new|shop2`. Summary: count, the public non-production ones, whether each is indexable.
- **23-wayback** → `data/wayback-urls.json`. CDX inventory (HTML only, status 200, collapsed), first and last capture, captures per year. Diff against the live sitemap to get **legacy URLs**; HEAD-check up to 300 of them. Summary: years online, legacy URL count, how many now 404, the 10 with the most captures.

### Crawl and on-page
- **10-crawl** → `data/crawl.jsonl`. The Frozen crawler, parameterised: status, final URL, redirect chain, title, description, H1s, canonical, robots meta, OG/Twitter, JSON-LD types, hreflang, viewport, lang, image count and missing alt, lazy-load count, script and stylesheet counts, HTML bytes, response ms, internal links, `tel:`/`mailto:` values, placeholder strings, plugin and theme slugs seen. Retries transient failures once, logs the rest.
- **11-analyze** → `data/analysis.json`, `pages.csv`. Every at-scale metric with count plus 5 example URLs: titles (missing, default, duplicate, long, brandless, broken separator), descriptions, H1, canonical problems, noindex on money pages, junk pages indexable, parameter duplicates, thin pages, OG gaps, alt coverage, hreflang reciprocity, placeholder hits, typos-by-repetition, stale content dates.
- **12-links** → `data/links.json`. Unique internal and external link targets not already crawled, HEAD-checked: broken, chained, http-on-https. Orphans (in sitemap, zero inbound) and depth.

### Server and security
- **20-headers** → `data/headers.json`. The four host variants and where each lands. Security headers and the MDN Observatory grade. Cookie flags. Compression, HTTP version, cache-control on HTML and on a static file, server/version leaks, certificate issuer and days to expiry, mixed content on samples.
- **50-wp** [WP] → `data/wp.json`. Core version (generator, feed, `?ver=`), PHP hint (headers), theme and builder, **plugin register**: slug, version (from `readme.txt` Stable tag and `?ver=`), latest version (wordpress.org API), abandoned flag, known vulnerabilities (wpvulnerability.net, no key). Exposure: REST user list, author enumeration, xmlrpc, login page, `readme.html`, `debug.log`, directory listing on uploads, wp-cron. WooCommerce extras: cart-fragments on non-shop pages, admin-ajax calls on load. Summary: versions, plugin count, outdated count, vulnerable count with names, exposures.
- **51-exposure** → `data/exposure.json`. GET-only checks for `.git/HEAD`, `.env`, common backup and dump names, `phpinfo.php`, `security.txt`, `llms.txt`, `ads.txt`, `humans.txt`. Third-party scripts loaded unpinned (`@latest`) or without SRI. Safe Browsing and VirusTotal when keyed.

### Performance
- **30-perf** → `data/perf.json`. Playwright + CDP. Mobile profile (4x CPU, ~1.6 Mbps, 150 ms) and desktop, **median of 3**, per sample URL. LCP, CLS, TBT, FCP, TTFB, requests, bytes by type. **LCP element** (tag, src, natural vs displayed size, lazy-loaded?, preloaded?). **CLS sources** (the elements that moved). Render-blocking resources. Third-party bytes by domain. **Image audit**: format offered vs served, natural vs displayed pixels, missing dimensions, lazy-load, `fetchpriority` count, preload-vs-used mismatch. Fonts: families, preload, display.
- **31-cache** → `data/cache.json`. Same URL 4 times: cache headers and TTFB each time. Cache-busted control. Static file TTFB vs PHP page TTFB. `Set-Cookie` on an anonymous request (the Craft finding). `Accept: image/avif` negotiation. bfcache blockers (`Cache-Control: no-store`, unload handlers). Speculation rules present.
- **32-coverage** → `data/coverage.json`. CDP CSS and JS coverage per template: total bytes, unused bytes, worst 5 files.
- **33-inp** → `data/inp.json`. Scripted interactions per template (menu open, add to cart, filter, accordion), event timing plus Long Animation Frames attribution: which script, how long.
- **34-thirdparty** → `data/thirdparty.json`. Top 6 third-party domains by bytes. Home page reloaded with each one blocked, TBT and LCP delta recorded. "This script costs you N ms."
- **35-crux** (key) → `data/crux.json`. Origin and per-sample-URL p75 LCP/INP/CLS/TTFB/FCP, phone and desktop, good/NI/poor split, 25-week history with the week-over-week trend and the worst regression.
- **36-psi** (key) → `data/psi/*.json`. Lighthouse category scores and the failed audits list, home + 2 samples, mobile.
- **37-globalping** (key optional) → `data/globalping.json`. HTTP timing from the client's cities: DNS, TCP, TLS, first byte, total, per city.
- **38-benchmark** → platform pass-rate context. Tries the HTTP Archive API, falls back to the dated table in `thresholds.js`.

### Experience
- **40-responsive** → `screenshots/`, `data/responsive.json`. Width sweep (320, 360, 390, 414, 768, 1024, 1280, 1440) for overflow and clipped elements. Engines installed × phone/desktop × sample templates: load, console errors, overflow, screenshot. Tap targets under 24 px, body text under 16 px, zoom disabled.
- **41-a11y** → `data/a11y.json`. axe-core per sample template, grouped by rule and impact with the node count and one selector each. Keyboard walk: 40 tabs, focus visible?, focus obscured?, trap?, skip link?
- **60-tracking** → `data/tracking.json`. Tag inventory with IDs, duplicates, dead UA properties, runtime-only IDs. **Three-state consent test** in fresh contexts: before any click, after reject, after accept. Cookies and third-party requests logged per state. Consent Mode signals. Banner covering the call to action on mobile.
- **80-commerce** [SHOP] → `data/commerce.json`, screenshots. Mobile journey: product → add to cart → cart → checkout entry, no order. **Checkout fields**: count, labels, order, screens of scroll, guest checkout, payment methods listed. **Price integrity**: the same product's price on PDP, category card, JSON-LD and cart. Out-of-stock share from the crawl. Platform-generic selectors with fallbacks; when a step fails it records `needs_model: true` with the screenshot so the model finishes it by hand.

### Structured data and AI
- **70-schema-ai** → `data/schema.json`. JSON-LD parsed on samples: required and recommended fields per type, merchant-listing fields (shipping, returns), schema vs visible price, Microdata leftovers. AI-bot rules in robots.txt. `llms.txt`. Fetch-as-GPTBot vs normal: status and text-length diff. Raw HTML text vs rendered text ratio (is the content there before JavaScript).

### Synthesis
- **90-findings** → `findings.json`, `findings.csv`. Runs `lib/rules.js` over all summaries, merges `model-findings.json` if present, scores, ranks, and emits the **Good** list for the scorecard.
- **96-contactsheet** → `sheets/*.png`. Thumbnails tiled 4 across with captions.
- **91-digest** → `DIGEST.md`, `AUDIT-DIGEST.json`.
- **92-report** → `AUDIT-REPORT.md` from `templates/report.md.tpl`.
- **93-pdf** → `AUDIT-REPORT.pdf`. The Frozen/Craft editorial design.
- **94-recheck** → `client-pack/recheck.mjs`. A dependency-free script the client runs with `node recheck.mjs`; it re-fetches their public pages and prints each audited number beside today's value (the Said & Co pattern).
- **95-pack** → `client-pack/` + zip. PDF, `findings.csv`, `pages.csv`, screenshots, recheck script, redirect map when `23-wayback` found dead legacy URLs.

## 7. Findings: schema, rules, scoring

`findings.csv` columns (Frozen's, kept): `id, module, title, severity, impact, effort, reach_urls, evidence_url, evidence_value, why_it_matters, recommended_fix, priority_rank`. `findings.json` adds `source: rule|model`, `needs_access: bool`, `confidence`, `examples[]`.

A rule in `lib/rules.js`:

```js
{ id:"meta-desc-missing", module:"11-analyze", area:"Meta descriptions",
  test: S => { const a=S.analyze?.meta_desc_missing; if(!a||a.count/S.analyze.pages<0.2) return null;
               return { value:`${a.count} of ${S.analyze.pages} pages`, reach:a.count, url:a.examples[0] }; },
  severity: r => r.reach/ r.total > 0.8 ? "High":"Medium", impact:80, effort:"Med" }
```

`lib/fixes.js` holds, per rule id, the client-language `why` and `fix` with `{value}` slots. Written once in plain English, platform-safe wording, no jargon walls. This is where the tokens were going before.

Severity: **Critical** = losing money or rankings now, or blocks the client's stated goal. **High** = meaningful drag across many pages or on the money path. **Medium** = real but narrow or slow-burn. **Low** = hygiene.
Effort: Low (minutes to hours, settings), Med (days, templates or bulk), High (project).
Priority = `impact × reachWeight ÷ effortWeight`, reachWeight = 1 + log10(reach)/3, effortWeight = Low 1, Med 1.6, High 2.5. **Quick wins** = impact ≥ 60 and effort Low, listed separately.

Thresholds live only in `lib/thresholds.js`, each with a source comment: LCP 2.5 s, INP 200 ms, CLS 0.1, TTFB 800 ms, title 60 chars, description 70 to 160, checkout 8 fields (Baymard), tap target 24 px, body 16 px, page weight 1.5 MB, fonts 3 families, redirect 1 hop, WordPress CWV pass rate (HTTP Archive, dated).

## 8. What the model does (the only token spend)

In order, from `README.md`:

1. **Brief.** Read the job post. Write `brief.json`: client name, country, their stated goal, **their suspicions**, competitors they named, the deliverable nouns, language. 10 lines. The orchestrator uses country/cities/competitors from it.
2. **Run** `node audit.js <url> --out <dir>`. Watch ~30 progress lines.
3. **Read `DIGEST.md`.** Nothing else.
4. **Look** at the contact sheets. Record what scripts cannot see: hierarchy, contrast, typography, photography, mobile-as-afterthought, banner covering the button, brand drift. Open a full-size shot only where a thumbnail shows trouble.
5. **Follow up** every `needs_model` line. Typical: a journey step whose selector failed, a company number to check against the public registry (WebSearch), a phone number that looks foreign to the business, a translation to read.
6. **Test the client's suspicions** from the brief against the digest. Confirm or correct each, with the number.
7. **Write `model-findings.json`** (same schema) for steps 4 to 6, plus `challenge-the-brief` items and the one "do not change this". Re-run `--only 90,91,92`.
8. **Fill the report slots**: the five that matter, the section intros, challenge-the-brief, what a deeper pass adds. Edit drafted findings for this client's language. Do not rewrite findings that are already right.
9. **Gates** (section 9). Then `--only 93,94,95`.

## 9. Gates (nothing ships without all seven)

1. **Noun gate.** Every deliverable named in the job post maps to a file in `client-pack/`.
2. **Fact-check gate.** Every claim about what a plugin, platform or product does is checked against its own documentation. (Craft: GA4 was attributed to the wrong plugin and the bakery owner caught it.)
3. **Evidence gate.** `91-digest` fails the run if any finding lacks `evidence_url` or `evidence_value`.
4. **Red-team pass.** A fresh read hunting for one wrong number, wrong host, wrong unit. (Frozen: the 750-row redirect CSV was sourced from the www host. Said: "33 kg of silver" was really a wrong metal flag.)
5. **Honesty gate.** Lab vs field labelled. Timings relative when measured from one location. `needs_access` items named as such. "No order was placed."
6. **Safety gate.** The run log shows no POST except add-to-cart, no auth attempts, concurrency ≤ 4.
7. **Language gate.** The repo's proposal rules apply to every client-facing word: plain English, no contact details, platform-safe vocabulary ("audited", "checked", never the c-word; symptoms, not error codes or security jargon), solo voice, no em dashes, links in plain ASCII.

## 10. Keys (all optional, all free)

`.env.example` carries the how-to for each. Loader: `lib/util.js` reads `tools/site-auditor/.env`, then process env.

| Variable | Unlocks | Get it |
|---|---|---|
| `GOOGLE_API_KEY` | CrUX, CrUX History, PageSpeed Insights, Safe Browsing, Knowledge Graph | console.cloud.google.com → new project → enable those APIs → Credentials → API key. No card. |
| `GLOBALPING_TOKEN` | 500 tests/hr instead of 250 | dash.globalping.io, GitHub login |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Radar URL Scanner second opinion, domain rank | Cloudflare dashboard → API tokens → custom → Account / URL Scanner / Edit |
| `SERPER_API_KEY` | Google results from the client's country: `site:` count, brand SERP | serper.dev, 2,500 free, no card |
| `VIRUSTOTAL_API_KEY` | Blacklist status across vendors | virustotal.com account → API key |
| `COMPANIES_HOUSE_KEY` | UK company registry lookups | developer.company-information.service.gov.uk |

Optional MCP: `claude mcp add chrome-devtools npx chrome-devtools-mcp@latest` for interactive trace deep-dives in step 5. The engine does not depend on it.

## 11. Definition of done (engine)

- [ ] `npm install` then `node audit.js <url>` completes on a real WooCommerce site with no unhandled rejection
- [ ] Every module writes a summary under ~60 lines; `DIGEST.md` under ~450 lines
- [ ] With an empty `.env`, keyed modules report `skipped`, and the run still finishes
- [ ] `findings.csv` has rule-drafted findings, each with evidence URL and exact value
- [ ] Contact sheets render; PDF renders; `recheck.mjs` runs standalone
- [ ] `--tier bid` finishes in minutes and prints `BID-FINDINGS.md`
- [ ] No client domain appears anywhere in `tools/site-auditor/` source
- [ ] README lets a fresh thread run an audit without reading this PRD

## 12. Build order

1. `lib/util.js`, `lib/thresholds.js`, `package.json`, `.env.example`
2. `00-discover` → test → `10-crawl`, `11-analyze`
3. Network modules: `20`, `21`, `22`, `23`, `50`, `51`, `70`, `35`, `36`, `37`, `38`, `12`
4. Browser modules: `30`, `31`, `32`, `33`, `34`, `40`, `41`, `60`, `80`
5. `lib/rules.js`, `lib/fixes.js`, `90`, `96`, `91`
6. `92`, `93`, `94`, `95`, templates
7. `audit.js`, README, end-to-end run, fix, commit

## 13. Later, not now

Competitor side-by-side runs (`--competitors` re-runs bid tier on each and adds a comparison table). Interactive migration console as a generated artifact (Frozen pattern). Serper-backed indexed-count and brand-SERP module. Cloudflare Radar second-opinion module. Non-WordPress platform packs (Shopify, BigCommerce) for `50` and `80`.
