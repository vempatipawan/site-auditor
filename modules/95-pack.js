// 95-pack: assembles client-pack/ (what gets attached) and zips it. PDF, findings.csv, pages.csv, screenshots,
// recheck.mjs, plugin-register.csv and legacy-redirect-map.csv when they exist. Also runs the noun gate:
// every deliverable named in brief.json should map to a file in the pack.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const U = require("../lib/util");

const NOUNS = [[/pdf|report|audit|document/i, "AUDIT-REPORT.pdf"], [/spreadsheet|csv|sheet|list of (issues|findings)|findings/i, "findings.csv"], [/page[- ]by[- ]page|url list|pages/i, "pages.csv"], [/screenshot|screen shot|visual/i, "screenshots"], [/plugin/i, "plugin-register.csv"], [/redirect/i, "legacy-redirect-map.csv"], [/re-?check|verify|script|before.and.after/i, "recheck.mjs"]];

module.exports = {
  id: "95-pack", name: "Assemble the client pack", tiers: ["full"],
  async run(ctx) {
    const pack = ctx.packDir, out = ctx.outDir, missing = [], copy = (from, to) => { if (fs.existsSync(from)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); return true; } return false; };
    if (!copy(path.join(out, "AUDIT-REPORT.pdf"), path.join(pack, "AUDIT-REPORT.pdf"))) missing.push("AUDIT-REPORT.pdf (run 93-pdf after the report slots are filled)");
    for (const f of ["findings.csv", "pages.csv"]) if (!copy(path.join(out, f), path.join(pack, f))) missing.push(f);
    if (!fs.existsSync(path.join(pack, "recheck.mjs"))) missing.push("recheck.mjs (run 94-recheck)");
    // an empty redirect map is noise: keep it only when it has rows
    const map = path.join(pack, "legacy-redirect-map.csv"); if (fs.existsSync(map) && fs.readFileSync(map, "utf8").trim().split("\n").length < 2) fs.unlinkSync(map);
    // screenshots: full-size shots, capped so the zip stays attachable
    const shotsTo = path.join(pack, "screenshots"); fs.rmSync(shotsTo, { recursive: true, force: true }); fs.mkdirSync(shotsTo, { recursive: true });
    const shots = fs.readdirSync(ctx.shotDir).filter((f) => /\.(png|jpe?g)$/i.test(f)).map((f) => ({ f, kb: fs.statSync(path.join(ctx.shotDir, f)).size / 1024 })); let kb = 0, kept = 0;
    for (const s of shots.sort((a, b) => a.f.localeCompare(b.f))) { if (kb + s.kb > 18000) continue; fs.copyFileSync(path.join(ctx.shotDir, s.f), path.join(shotsTo, s.f)); kb += s.kb; kept++; }

    const files = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(path.relative(pack, p).split(path.sep).join("/")); } }; walk(pack);

    // noun gate
    const brief = ctx.read("brief.json") || {}, nouns = [].concat(brief.deliverables || []), gate = nouns.map((n) => { const hit = NOUNS.find(([re]) => re.test(n)); const file = hit && hit[1]; return { asked_for: n, file: file || null, in_pack: !!file && files.some((f) => f === file || f.startsWith(file + "/")) }; });
    const unmet = gate.filter((g) => !g.in_pack).map((g) => g.asked_for);

    // zip next to the pack. tar ships with Windows 10+, macOS and Linux, and writes a real .zip with -a.
    const zip = path.join(out, `${ctx.site.host.replace(/[^a-z0-9.-]/gi, "-")}-audit-pack.zip`); let zipped = null; fs.rmSync(zip, { force: true });
    // Windows: the system bsdtar, by full path, because Git Bash puts a GNU tar first that cannot write zip.
    const winTar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), names = fs.readdirSync(pack);
    for (const [cmd, args] of [...(process.platform === "win32" ? [[winTar, ["-a", "-c", "-f", zip, ...names]]] : []), ["zip", ["-r", "-q", zip, "."]], ["tar", ["-a", "-c", "-f", zip, ...names]]]) { try { execFileSync(cmd, args, { cwd: pack, stdio: "pipe" }); if (fs.existsSync(zip) && fs.statSync(zip).size > 0) { zipped = path.basename(zip); break; } } catch {} }
    return { status: missing.length ? "partial" : "ok", reason: missing.length ? "missing: " + missing.join(" ; ") : undefined, pack: "client-pack/", files: files.length, file_list: files.filter((f) => !f.startsWith("screenshots/")), screenshots: `${kept} of ${shots.length} (${Math.round(kb / 1024)} MB)`, zip: zipped || "could not zip on this machine: attach the folder's files directly", zip_mb: zipped ? U.round(fs.statSync(zip).size / 1048576, 1) : null, noun_gate: !nouns.length ? "no deliverables listed in brief.json: check the job post by hand" : unmet.length ? { FAILED_no_file_for: unmet } : "passed" };
  },
};
U.standalone(module.exports, module);
