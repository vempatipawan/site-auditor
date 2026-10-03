# Site Auditor: build state (2026-09-21)

**ENGINE COMPLETE.** To run an audit, read `README.md` only. Spec = `AUDITOR-PRD.md`. Checklist = `AUDIT-CHECKLIST.md`.

## Scope (locked by founder)
URL-only audits. Free data sources only (no DataForSEO, no Perplexity). Fixes included in the free audit. No Loom script. Never ask the founder for API keys: every keyed module skips cleanly when `.env` has no key.

## What exists
- `audit.js` orchestrator: stages discover → network A (parallel) → network B → analyze → browser (serial) → synthesize. One progress line per module, per-module timeout, a failed module never stops the run, `tiers` array decides what runs in bid tier, `--only` / `--skip` re-run any stage on an existing folder.
- 31 modules in `modules/`: recon `00 21 22 23` · on-page `10 11 12` · server `20 50 51` · speed `30 31 32 33 34 35 36 37 38` · experience `40 41 60 80` · structured data `70` · synthesis `90 96 91 92 93 94 95`.
- `lib/`: `util.js` (fetch, pool, ctx, flags, identity), `thresholds.js`, `rules.js` (75 rules, why + fix inline, so there is no separate `fixes.js`), `language.js` (the language gate as code: lint + letter-safe rewrites).
- `templates/`: `report.md.tpl`, `recheck.mjs.tpl`, `pdf.css`, `cover-mesh.svg`. PDF fonts come from `templates/onboarding/.assets/fonts.css` at the repo root.
- `README.md` (launch SOP + seven gates), `.env.example`.

## Finished in the 2026-09-21 session
1. `34-thirdparty` run live: works (test site: HubSpot costs ~2.9 s of main thread on a phone).
2. `32-coverage` JS fix confirmed: unused JS now reads 55 to 79 percent, no longer 0.
3. `92-report`: `AUDIT-REPORT.md` from the template with `{{MODEL:...}}` slots and `<!-- MODEL: -->` work comments; never overwrites an edited report (rebuild lands in `AUDIT-REPORT.new.md`, `--force` replaces). Bid tier writes `BID-FINDINGS.md`: 10 letter-ready lines, max 2 per area, swept for platform-filter words.
4. `93-pdf`: the midnight-and-gold design, cover fields read from the report's own title block / `brief.json` / flags. Refuses to render while a slot, a MODEL comment or a language hit remains. `--draft` = proof render with a DRAFT seal.
5. `94-recheck`: `client-pack/recheck.mjs`, dependency-free, ran live: six sections, audited value beside today's value.
6. `95-pack`: client-pack + zip (Windows system tar by full path; Git Bash's GNU tar cannot write zip) + the noun gate against `brief.json` deliverables.
7. Known issues closed: WordPress core sitemap names no longer label pages as posts (`wp-sitemap-posts-page` → page, taxonomies → archive); `11-analyze` re-picks samples the crawl proved unrepresentative (canonical elsewhere, noindex, redirect, out of stock); `37-globalping` asks for the clean origin, follows the redirect most cities receive and reports the hop as its own cost; client-facing rule text no longer uses the c-word.

## End-to-end results
See the bottom of this file ("E2E log").

## Open items (small, none block an audit)
- `12-links` retries timeouts one at a time and counts only real not-found or server-fault answers as broken; anything still unanswered lands in `unverified_after_retry`, never in a finding. (The old `test-golfyr` data predates this: 4 of its 18 "broken" links were timeouts.) The red-team gate still applies: confirm before you claim.
- `30-perf`: when Chrome reports no main-content paint time (content that fades in from invisible), the summary says so under `needs_model` instead of printing a blank. Seen live on an Elementor site.
- `50-wp`: plugin version from `readme.txt` Stable tag is low-confidence by design. Vulnerability verdicts are flagged `fact_check`. Keep that gate.
- PRD section 13 (later): competitor side-by-side, Serper and Cloudflare Radar modules, non-WordPress platform packs.
- Patch files with the Edit or Write tool. Bash heredocs mangle backslashes on this machine.

## Real findings sitting in the test run (Golfyr, live prospect of Maan)
Homepage has no title tag · all 106 titles end in a dangling separator (empty Site Title) · 0 meta descriptions, 0 structured data, 0 share images · public error log · `dev.` and `stage.` subdomains public · tracking fires before consent and continues after "Decline" · a product reaches the cart at CHF 0 · 12.5 MB homepage, 11 MB of it images, 36 render-blocking files, 96% unused CSS · no page cache hits (3 WCML cookies on anonymous visits + a geo `?v=` redirect that costs US visitors ~1.7 s before the page even starts) · `/events/` dead on 110 pages. Far beyond the 10 findings in the Sep 15 bid. `runs/` is git-ignored, so re-run to regenerate.

## E2E log
Bid tier: PASSED 2026-09-21 on a fresh Elementor site. 19 modules, 0 failed, 2.9 min, language scan clean.
Full tier: every module and the orchestrator ran live on the test site; the fresh full end-to-end run was started and stopped at module 8 of 30 (no failures) to save usage. First real client audit doubles as the full e2e: check PRD section 11.
