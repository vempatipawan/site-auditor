# Website Audit Checklist

Portable reference. Input: one public URL, nothing else. No logins, no analytics access.
Works for any site. Sections marked [WP] are WordPress only, [SHOP] are stores only.
Rule for every line: measure it, save the evidence, state the exact value seen, give the fix.

## 0. Ground rules
- [ ] Outside-in only. Passive requests. No login attempts, no form spam, no order placed
- [ ] Polite rate: 4 connections max, small delay, obey Crawl-delay
- [ ] Every number traces to a saved file the client can re-check in View Source
- [ ] Lab data is never presented as real-visitor data. Say which one it is
- [ ] Timings from one location are reported as relative, not absolute
- [ ] What cannot be seen from outside is labelled "needs access", never guessed
- [ ] Say what is good, with the reason. Praise makes the criticism credible
- [ ] Every finding ships with its fix, effort and priority

## 1. Recon and identity
- [ ] Platform, theme, page builder, plugin list, versions (from source, asset paths, generator tags)
- [ ] Host, server software, CDN, HTTP version, server location vs customer location
- [ ] Domain age and expiry date (RDAP/WHOIS)
- [ ] Every subdomain (certificate transparency): staging, dev, old copies left public
- [ ] Site history (Wayback): redesign dates, old URL inventory, when problems started
- [ ] Company identity on the page vs the public registry: name, company number, VAT, address
- [ ] Every phone number and email on the site actually belongs to the business
- [ ] Placeholder leftovers: lorem ipsum, sample page, demo content, wrong company name, "kopie"
- [ ] The people: owner, technical lead, who actually reads the report
- [ ] Competitors the client named, pulled and benchmarked on the same measures

## 2. Crawl and indexation
- [ ] robots.txt: valid, no accidental block, sitemap line present, AI-bot policy deliberate
- [ ] Sitemaps: reachable, valid, only live canonical URLs, lastmod present, right host
- [ ] Full crawl of every sitemap URL, zero silent failures, counts reconciled
- [ ] Status codes, redirect chains (max 1 hop), loops, mixed http/https, www vs non-www
- [ ] Canonicals: present, self-referencing, one host, no conflicts
- [ ] noindex on money pages? Cart, checkout, account, search, thank-you pages indexable?
- [ ] Junk in the index: sample page, duplicate home, uncategorized, tag archives, test pages
- [ ] URL parameters creating duplicates (cache-bust hashes, currency, session, filters)
- [ ] Pagination and faceted navigation handled
- [ ] Orphan pages, crawl depth over 4 clicks, broken internal and external links
- [ ] 404 page returns a real 404 and helps the visitor. Soft 404s
- [ ] Indexed count vs sitemap count (site: search, from the client's country)
- [ ] Legacy URLs with history that now dead-end (Wayback vs live)

## 3. On-page, at scale
- [ ] Titles: missing, default ("Home Page"), duplicate, too long, brand missing, broken separators
- [ ] Meta descriptions: missing, duplicate, auto-excerpt with code artefacts, length
- [ ] H1: missing, multiple, heading order
- [ ] Thin pages, duplicate pages, near-duplicate titles, typos in titles
- [ ] Open Graph and Twitter card: title, description, image at 1200x630, on every template
- [ ] Favicon, touch icon, web manifest, theme colour
- [ ] html lang set and correct
- [ ] Content freshness: last blog post date, dated photography, stale offers, old copyright year

## 4. Performance
- [ ] Real-visitor data (CrUX): p75 LCP, INP, CLS, TTFB, per URL and per origin, phone and desktop
- [ ] 25-week history of the same: when did it get worse
- [ ] Lab run, throttled mid-range phone and desktop, median of 3, per template
- [ ] LCP element identified by name. Is it lazy-loaded, late-discovered, oversized
- [ ] INP: scripted taps on menu, add-to-cart, filters. Which script blocked the tap
- [ ] CLS: which element moved, and why (unsized image, late font, injected banner)
- [ ] TTFB: static file vs PHP page on the same server (server problem or code problem)
- [ ] TTFB from the customer's cities, split into DNS, connect, TLS, first byte
- [ ] Cache layer: present? hit or miss on repeat? what breaks it (cookie, header, query string)
- [ ] Cache-bust control request to separate cache problems from origin problems
- [ ] Page weight, request count, per type: JS, CSS, images, fonts, third parties
- [ ] Unused CSS and JS in bytes per template
- [ ] Render-blocking resources in the head
- [ ] Images: format (AVIF/WebP offered?), natural size vs displayed size, lazy-load, srcset, dimensions set
- [ ] Preload pointing at a different file than the one used. fetchpriority on too many images
- [ ] Fonts: family count, preload, font-display, self-hosted vs remote
- [ ] Each third-party script's cost: block one at a time and re-measure
- [ ] Compression (Brotli), HTTP/2 or 3, cache headers on static files, CDN
- [ ] Back/forward cache eligible? Speculative loading on?
- [ ] Platform benchmark: how this site compares with others on the same platform

## 5. Mobile, responsive, cross-browser
- [ ] Viewport tag correct, zoom not disabled
- [ ] Width sweep 320 to 1440: horizontal overflow, overlap, clipped text
- [ ] Chrome, Safari engine, Firefox x phone and desktop x every key template, with screenshots
- [ ] Tap targets at least 24px (48px preferred), body text at least 16px
- [ ] Mobile menu works, sticky bars and banners do not cover the call to action
- [ ] Console errors per browser
- [ ] Look at every screenshot: hierarchy, contrast, spacing, mobile treated as an afterthought

## 6. Accessibility
- [ ] Automated scan (axe-core) on every key template, grouped by rule and impact
- [ ] Keyboard only: tab order, visible focus, focus not hidden by sticky header, no traps, skip link
- [ ] Forms: labels, error messages tied to fields, correct input types and autocomplete
- [ ] Contrast, alt text quality (not just presence), link text that means something
- [ ] Landmarks, heading structure, page title, language
- [ ] Motion respects reduced-motion, nothing autoplays with sound
- [ ] Text resizes to 200 percent without breaking
- [ ] State which standard applies to this client's market. Never claim legal compliance

## 7. Security and trust (passive only)
- [ ] HTTPS everywhere, certificate valid and not near expiry, no mixed content
- [ ] Headers: HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy. Overall grade
- [ ] Cookie flags: Secure, HttpOnly, SameSite
- [ ] Server and software versions leaking in headers
- [ ] Exposed files: .git, .env, backups, database dumps, debug log, directory listing
- [ ] Third-party scripts loaded unpinned (@latest) or without integrity
- [ ] Blacklist status (Safe Browsing, multi-vendor)
- [ ] Email authentication: SPF, DKIM, DMARC, so order emails reach the inbox
- [ ] security.txt, privacy policy, terms, returns, imprint where the market requires it
- [ ] [WP] Core, PHP, plugin and theme versions vs known vulnerabilities
- [ ] [WP] User list exposed (REST, author archives), xmlrpc open, login page open, readme files
- [ ] [WP] Public staging copy, open to search engines

## 8. Privacy and tracking
- [ ] Inventory of every tag: analytics, ads, pixels, heatmaps, chat
- [ ] Duplicates, dead properties still firing, IDs loaded at runtime that are not in the source
- [ ] Three-state consent test in a fresh browser: before any click, after reject, after accept
- [ ] Cookies and requests logged in each state. Anything non-essential before consent is a finding
- [ ] Consent Mode signals present and ordered before the tags
- [ ] Banner covers content or the buy button on mobile?

## 9. Structured data and AI-search readiness
- [ ] JSON-LD present, valid, matches what the page visibly says
- [ ] Organization, WebSite, Breadcrumb, Article, FAQ, LocalBusiness as relevant
- [ ] [SHOP] Product, Offer, price, availability, rating, shipping details, return policy
- [ ] Old Microdata to modernise
- [ ] AI crawlers allowed or blocked on purpose (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended)
- [ ] llms.txt present
- [ ] Fetch the page as an AI crawler: same content served?
- [ ] Main content in the raw HTML, or only after JavaScript runs
- [ ] Does the page answer a buyer's question in its first sentences

## 10. Commerce [SHOP]
- [ ] Walk the path on a phone: search, category, product, add to cart, cart, checkout entry
- [ ] Checkout fields counted and listed, screens of scrolling, order of questions, vs the 8-field benchmark
- [ ] Guest checkout, account forced, coupon field distraction, trust marks at the pay step
- [ ] Payment methods shown match the customer's country
- [ ] Price integrity: same product, every place a price appears (page, category, cart, schema, feed). Any mismatch
- [ ] Prices served from a stale cache
- [ ] Tax, shipping, delivery dates, stock state shown before the last step
- [ ] Catalogue hygiene: out-of-stock share, duplicate titles, leftover copies, wrong category or attribute
- [ ] Product page: reviews, ratings, proof, per-unit maths, cross-sells
- [ ] On-site search quality, filters, sorting
- [ ] Cart script running on pages that are not the shop [WP]
- [ ] Order emails carry the right company name

## 11. International and local
- [ ] hreflang: present, reciprocal, self-referencing, x-default, valid codes
- [ ] Translated titles and descriptions, not just the body. Translation quality read by a fluent reader
- [ ] Currency and locale per market. No forced redirect by IP
- [ ] Local: name, address, phone identical on site, schema and business listing. Click-to-call works
- [ ] Opening hours, map, directions, review count and rating

## 12. Conversion, content, experience
- [ ] Five-second test on the homepage screenshot: what is it, who is it for, what do I do next
- [ ] Primary call to action visible without scrolling, on a phone
- [ ] Proof near the decision: reviews, client names, guarantees, returns
- [ ] Every form tested to its validation (not submitted)
- [ ] Copy: tone matches the brand, spelling, leftover template text
- [ ] Photography and typography consistent with the positioning
- [ ] Test ideas ranked: barrier, measure, expected direction

## 13. Challenge the brief
- [ ] Read the client's own plan critically. What is scheduled too late, mispriced, or missing
- [ ] Test each suspicion the client voiced, confirm or correct it with evidence
- [ ] One thing they should NOT change, and why
- [ ] The trap: the standard fix that would make their specific problem worse

## 14. The pack the client receives
- [ ] Report PDF: the five that matter, scorecard with the good items, findings by priority
- [ ] Every finding: what, where, exact value, why it costs them, the fix, effort, priority
- [ ] findings.csv (one row per finding) and pages.csv (one row per page)
- [ ] Screenshots folder
- [ ] A script the client can run to re-check every number, before and after
- [ ] Redirect map, when a migration or URL change is in play
- [ ] Plugin register with a verdict each: keep, remove, replace, and why [WP]
- [ ] Plan: quick wins first, then 30/60/90 or week by week
- [ ] "What a deeper pass adds" with access
- [ ] Short delivery message

## 15. Gates before anything ships
- [ ] Noun gate: every deliverable named in the job post or milestone maps to a file
- [ ] Fact-check gate: every claim about a plugin or product checked against its own docs
- [ ] Evidence gate: every number traces to a file
- [ ] Red-team pass by a fresh reader hunting for one wrong number
- [ ] Honesty gate: lab vs field, relative timings, needs-access labels
- [ ] Safety gate: nothing intrusive was run
- [ ] Language gate: plain English, no jargon walls, no contact details, platform-safe wording
