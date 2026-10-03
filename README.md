# Site Auditor: launch SOP

Trigger: **"website auditor: launch"** + URL (+ job post, tier, client slug). This file is all a fresh thread needs. Spec lives in `AUDITOR-PRD.md`; what an audit contains lives in `AUDIT-CHECKLIST.md`.

**Principle: scripts measure, the model judges.** You read `DIGEST.md` and the contact sheets. You never read `data/`.

**Scope:** URL only. No logins, no analytics, no API keys asked of the founder. Fixes are included. No Loom script.

## Setup (once per PC)

```
cd tools/site-auditor
npm install
npx playwright install        # chromium, firefox, webkit
```

Keys are optional. Copy `.env.example` to `.env` only if a key exists. With no `.env`, keyed modules report `skipped` and the run still finishes.

## Two tiers

| Tier | Command | Time | Ends in |
|---|---|---|---|
| Bid-scan | `node audit.js <url> --tier bid` | 3 to 8 min | `DIGEST.md` + `BID-FINDINGS.md` (letter-ready lines) |
| Full | `node audit.js <url> --out clients/<slug>/proposals/<job>/audit --freelancer "Name"` | 20 to 60 min | `DIGEST.md` + `AUDIT-REPORT.md`, then PDF + `client-pack/` |

Default output is `runs/<host>-<date>/` (git-ignored). For real client work always pass `--out` into the client's proposal folder so the run is committed with the bid.

Flags: `--tier bid|full` · `--out <dir>` · `--only 30,31` · `--skip 34,40` · `--max-urls 1500` · `--country ch` · `--cities "Zurich,Geneva"` · `--freelancer "Name"` · `--client "Name"` · `--prepared-for "First name"` · `--force` · `--draft`

Any module also runs alone: `node modules/30-perf.js <outDir>`. A failed module never stops a run; re-run it with `--only`.

## The nine steps (full tier)

1. **Brief.** Read the job post. Write `<out>/brief.json` before the run:
   ```json
   { "client_name": "Craft Coffee & Pastry", "contact_name": "Gerry", "freelancer": "Maan Singh",
     "country": "Netherlands", "country_code": "nl", "language": "nl",
     "goal": "their stated goal, one sentence",
     "suspicions": ["what they think is wrong"], "competitors": ["a.com"],
     "deliverables": ["PDF report", "spreadsheet of issues", "screenshots"] }
   ```
   `country_code` steers the customer-city timing. `deliverables` feeds the noun gate. `freelancer` and `contact_name` go on the PDF cover.
2. **Run** `node audit.js <url> --out <dir>`. Watch about 30 progress lines. Run it in the background; it needs no attention.
3. **Read `DIGEST.md`.** Nothing else.
4. **Look** at the contact sheets in `sheets/` (6 images, not 50). Record what scripts cannot see: hierarchy, contrast, typography, photography, mobile as an afterthought, a banner covering the button, brand drift. Open a full-size shot from `screenshots/` only where a thumbnail shows trouble.
5. **Follow up** every line under `needs_model` in the digest: a journey step whose selector failed, the company number against the public registry (WebSearch), a phone number that looks foreign to the business, every plugin claim marked fact-check.
6. **Test the client's suspicions** from the brief against the digest. Confirm or correct each one with the number.
7. **Write `model-findings.json`** for steps 4 to 6: an array of rows with the same fields as `findings.json` (`area, title, severity, impact, effort, reach_urls, evidence_url, evidence_value, why_it_matters, recommended_fix`). Then `node audit.js --out <dir> --only 90,91,92` to merge and re-rank.
8. **Fill the report.** In `AUDIT-REPORT.md` replace every `{{MODEL:...}}` slot and resolve every `<!-- MODEL: ... -->` comment: the intro note, the five that matter, challenge the brief, the deeper-pass lines. Edit drafted findings into this client's language. Do not rewrite findings that are already right. Once edited, `92-report` will never overwrite the file: a rebuild lands in `AUDIT-REPORT.new.md` (`--force` replaces).
9. **Gates, then ship:** `node audit.js --out <dir> --only 93,94,95`. `93-pdf` refuses to render while a slot, a MODEL comment or a language hit remains (`--draft` gives a proof render with a DRAFT seal). Open the PDF and look at it. Attach the zip or the files in `client-pack/`.

Bid tier: steps 2 and 3, then open `BID-FINDINGS.md`. Pick 3 to 5 lines, open each evidence address yourself, and weave them into the letter under `PROPOSAL_PROTOCOL.md`. The lines are already swept for platform-filter words; the file says so or lists what to fix.

## The seven gates (nothing ships without all seven)

1. **Noun gate.** Every deliverable named in the job post maps to a file in `client-pack/`. `95-pack` checks `brief.json` deliverables and prints the verdict.
2. **Fact-check gate.** Every claim about what a plugin, platform or product does is checked against its own documentation. Plugin versions read from the outside are low confidence by design. (Craft: GA4 was pinned on the wrong plugin and the owner caught it.)
3. **Evidence gate.** `90-findings` reports any finding without an evidence address, an exact value, a why and a fix. It must read `passed`.
4. **Red-team pass.** A fresh read hunting one wrong number, wrong host, wrong unit. (Frozen: a 750-row redirect file sourced from the www host. Said: "33 kg of silver" was a wrong metal flag.) A timeout on audit day is not a dead link: confirm before you claim.
5. **Honesty gate.** Lab vs field labelled. Timings relative when measured from one location. `needs_access` items named as such. "No order was placed."
6. **Safety gate.** `data/run-log.json`: GET and HEAD only, the one button pressed is add to cart, no login attempts, at most 4 requests at a time.
7. **Language gate.** `lib/language.js` runs on the report, the bid lines and the recheck script: plain English, no contact details, "audited" or "checked" and never the c-word, symptoms instead of error codes, solo voice, no long dashes, links in plain ASCII. A hit blocks the PDF.

## What a run folder holds

```
site.json urls.json brief.json      what the site is, what was audited, what the client asked
summaries/                          one small JSON per module (the digest is built from these)
data/                               raw bulk output: never read by the model
screenshots/  sheets/               full-size shots, and the contact sheets you actually open
findings.json findings.csv pages.csv
DIGEST.md                           the one file to read
AUDIT-REPORT.md .pdf                full tier        BID-FINDINGS.md   bid tier
client-pack/ + <host>-audit-pack.zip   what gets attached
```

## When something goes wrong

- A module says `failed`: read its `reason` in the progress line, fix or skip, `--only <nn>`.
- `37-globalping` says refused: the free hourly limit is used up. Re-run it later with `--only 37`.
- Patch files with the Edit or Write tool. Bash heredocs mangle backslashes on the founder's Windows PCs.
- Other PCs need `npm install` and `npx playwright install` once.
