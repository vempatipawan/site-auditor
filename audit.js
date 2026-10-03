#!/usr/bin/env node
// Site auditor orchestrator. Scripts measure, the model judges: one command ends in DIGEST.md.
//   node audit.js <url> [--tier bid|full] [--out <dir>] [--only 30,31] [--skip 34,40] [--max-urls 1500]
//                       [--country nl] [--cities "Amsterdam,Berlin"] [--freelancer "Name"] [--client "Name"]
//   node audit.js --out <dir> --only 90,91,92        re-run stages on an existing run (no url needed)
//   node audit.js --out <dir> --only 93,94,95        PDF + client pack, after the report slots are filled
// One progress line per module. A failed module never stops the run.
const fs = require("fs");
const path = require("path");
const U = require("./lib/util");

// Order between stages matters, order inside a parallel stage does not.
const STAGES = [
  { name: "discover", ids: ["00"] },
  { name: "network A", parallel: true, ids: ["10", "20", "21", "22", "23", "50", "51", "70"] },
  { name: "network B", parallel: true, ids: ["35", "36", "37", "38"] },               // 37 reads 21's data/dns.json
  { name: "analyze", ids: ["11", "12"] },                                              // needs the crawl; 11 re-picks samples
  { name: "browser", ids: ["30", "31", "32", "33", "34", "40", "41", "60", "80"] },    // one browser at a time so timings stay honest
  { name: "synthesize", ids: ["90", "96", "91", "92", "93", "94", "95"] },
];
const ON_REQUEST_ONLY = ["93"]; // the PDF renders only after the model has filled the report: --only 93,94,95
const TIMEOUT_MIN = { "10": 45, "12": 20, "23": 15, "40": 20, default: 12 };

const files = fs.readdirSync(path.join(__dirname, "modules")).filter((f) => /^\d\d-.*\.js$/.test(f));
const load = (num) => { const f = files.find((x) => x.startsWith(num + "-")); return f ? require("./modules/" + f) : null; };
const list = (v) => (v ? String(v).split(",").map((x) => x.trim().slice(0, 2)).filter(Boolean) : null);

async function main() {
  const { opts, rest } = U.parseFlags(process.argv.slice(2)); let url = rest[0] || opts.url || null;
  if (opts.help || (!url && !opts.out)) { console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 8).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(url || opts.out ? 0 : 1); }
  if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
  const tier = opts.tier === "bid" ? "bid" : "full", only = list(opts.only), skip = list(opts.skip) || [];
  const outDir = path.resolve(opts.out || path.join(__dirname, "runs", `${U.hostOf(url).replace(/^www\./, "")}-${new Date().toISOString().slice(0, 10)}${tier === "bid" ? "-bid" : ""}`));
  const ctx = U.makeCtx(outDir, Object.assign({}, opts, { tier, url }));
  if (!url && !fs.existsSync(path.join(outDir, "site.json"))) { console.error("No url given and no site.json in " + outDir); process.exit(1); }

  process.on("unhandledRejection", (e) => console.log("    (background error ignored: " + String((e && e.message) || e).split("\n")[0].slice(0, 120) + ")"));
  const wanted = (num, mod) => mod && mod.tiers.includes(tier) && !skip.includes(num) && (only ? only.includes(num) : !ON_REQUEST_ONLY.includes(num) && !(num === "00" && !url));
  const plan = STAGES.map((s) => Object.assign({}, s, { mods: s.ids.map((n) => [n, load(n)]).filter(([n, m]) => wanted(n, m)) })).filter((s) => s.mods.length), total = plan.reduce((n, s) => n + s.mods.length, 0);
  console.log(`\nSITE AUDIT  ${url || ctx.site.origin}  ·  tier ${tier}  ·  ${total} modules\nout: ${outDir}\n`);

  let done = 0; const log = [], t00 = Date.now();
  const runOne = async ([num, mod]) => {
    const t0 = Date.now(), limit = (TIMEOUT_MIN[num] || TIMEOUT_MIN.default) * 60000; let s, timer;
    try { s = await Promise.race([mod.run(ctx), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${limit / 60000} min`)), limit); })]); s = Object.assign({ status: "ok" }, s); }
    catch (e) { s = { status: "failed", reason: String((e && e.message) || e).split("\n")[0].slice(0, 200) }; }
    finally { clearTimeout(timer); }
    s.ms = Date.now() - t0; ctx.write(`summaries/${mod.id}.json`, s); log.push({ module: mod.id, status: s.status, ms: s.ms, reason: s.reason });
    console.log(`[${String(++done).padStart(2)}/${total}] ${mod.id.padEnd(16)} ${s.status.padEnd(8)} ${String(Math.round(s.ms / 1000)).padStart(4)}s  ${s.reason ? String(s.reason).slice(0, 110) : ""}`);
    return s;
  };
  for (const stage of plan) {
    if (stage.parallel) await Promise.all(stage.mods.map(runOne));
    else for (const m of stage.mods) { const s = await runOne(m); if (m[0] === "00" && s.status === "failed") { console.error("\nDiscover failed, nothing else can run: " + s.reason); process.exit(1); } }
  }

  ctx.write("data/run-log.json", { url: url || ctx.site.origin, tier, started: new Date(t00).toISOString(), minutes: U.round((Date.now() - t00) / 60000, 1), politeness: "GET and HEAD only, at most 4 requests at a time with a pause between them; the single button pressed is add to cart; no login attempts, no form submissions", modules: log });
  const by = (st) => log.filter((l) => l.status === st).map((l) => l.module), fj = ctx.read("findings.json"), rel = (f) => path.relative(process.cwd(), path.join(outDir, f)) || f;
  console.log(`\nDone in ${U.round((Date.now() - t00) / 60000, 1)} min  ·  ok ${by("ok").length}  partial ${by("partial").length}  skipped ${by("skipped").length}  failed ${by("failed").length}${by("failed").length ? "  (" + by("failed").join(", ") + ": re-run with --only)" : ""}`);
  if (fj && fs.existsSync(path.join(outDir, "DIGEST.md"))) console.log(`${fj.findings.length} findings drafted.  READ NEXT: ${rel("DIGEST.md")}${tier === "bid" ? "  then " + rel("BID-FINDINGS.md") : "  (then sheets/, then fill AUDIT-REPORT.md)"}`);
  process.exit(0); // anything a timed-out module left running dies here
}
main().catch((e) => { console.error(e); process.exit(1); });
