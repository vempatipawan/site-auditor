// 93-pdf: renders AUDIT-REPORT.md to the midnight-and-gold editorial PDF (the Craft / Frozen design).
// Runs only after the model has filled the report. Refuses to render while a model slot, a model comment or a
// language-gate hit remains. --draft renders anyway with a DRAFT seal; --force skips the language gate only.
// Cover fields come from the report's own title block, so nothing is ever hard-coded: flags override.
const fs = require("fs");
const path = require("path");
const U = require("../lib/util");
const LANG = require("../lib/language");

const FONTS = path.join(U.ROOT, "..", "..", "templates", "onboarding", ".assets", "fonts.css");
const html = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

module.exports = {
  id: "93-pdf", name: "Render the PDF", tiers: ["full"],
  async run(ctx) {
    const src = path.join(ctx.outDir, "AUDIT-REPORT.md"); if (!fs.existsSync(src)) return U.skipped("no AUDIT-REPORT.md: run 92-report first");
    const md = fs.readFileSync(src, "utf8").replace(/\r\n/g, "\n"), o = ctx.opts, draft = !!o.draft;
    const slots = [...new Set(md.match(/\{\{(MODEL|AUTO):[A-Z_]+\}\}/g) || [])], comments = (md.match(/<!-- MODEL:/g) || []).length;
    const clean = md.replace(/<!--[\s\S]*?-->/g, ""), hits = LANG.lint(clean).filter((h) => h.rule !== "model-slot");
    if (!draft && (slots.length || comments)) return { status: "failed", reason: `report is not finished: ${slots.length} unfilled slot(s) ${slots.join(" ")} and ${comments} open MODEL comment(s). Fill them, or pass --draft for a proof render.` };
    if (!draft && !o.force && hits.length) return { status: "failed", reason: "language gate: " + LANG.summarize(hits).join(" ; ") + ". Fix the wording, or pass --force if each hit is deliberate." };

    // cover fields: the report's own title block, then the brief, then flags
    const cut = clean.indexOf("\n---\n"), head = cut >= 0 ? clean.slice(0, cut) : "", body = cut >= 0 ? clean.slice(cut + 5) : clean, brief = ctx.read("brief.json") || {}, site = ctx.site;
    const by = head.match(/Prepared by\s+(.+?)\s+·\s+(.+)/) || [];
    const client = o.client || (head.match(/^#\s+(.+)$/m) || [])[1] || brief.client_name || site.host, kind = (head.match(/^##\s+(.+)$/m) || [])[1] || "Website Audit";
    const freelancer = o.freelancer || by[1] || brief.freelancer || "", date = by[2] || new Date(site.audited_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
    const contact = o.preparedFor || brief.contact_name || brief.client_contact || client, year = (date.match(/\d{4}/) || [new Date().getFullYear()])[0];
    const h1pt = client.length <= 14 ? 60 : client.length <= 24 ? 46 : client.length <= 38 ? 36 : 28;

    const { marked } = require("marked");
    let bodyHtml = marked.parse(body)
      .replace(/<h3[^>]*>(Critical|High|Medium|Low)([^<]*)<\/h3>/g, (m, s, rest) => `<h3 class="sev ${{ Critical: "crit", High: "high", Medium: "med", Low: "low" }[s]}">${s}${rest}</h3>`)
      .replace(/<em>What I found:<\/em>/g, '<span class="fl flw">WHAT I FOUND</span>').replace(/<em>Why it costs you:<\/em>/g, '<span class="fl fly">WHY IT COSTS YOU</span>')
      .replace(/<em>The fix:<\/em>/g, '<span class="fl flf">THE FIX</span>').replace(/<em>Effort:<\/em>/g, '<span class="fl flq">EFFORT</span>')
      .replace(/<td>(Critical|High|Medium|Low|Good)<\/td>/g, '<td class="s-$1">$1</td>');

    const css = fs.readFileSync(path.join(U.ROOT, "templates", "pdf.css"), "utf8"), mesh = fs.readFileSync(path.join(U.ROOT, "templates", "cover-mesh.svg"), "utf8"), fonts = fs.existsSync(FONTS) ? fs.readFileSync(FONTS, "utf8") : "";
    const foot = [["Prepared for", contact], ["Prepared by", freelancer], ["Date", date]].filter(([, v]) => v).map(([l, v]) => `<div><div class="lbl">${l}</div><div class="val">${html(v)}</div></div>`).join("");
    const cover = `<div class="cover">${mesh}<div class="frame"></div><div class="cover-inner">${draft ? '<div class="seal" style="top:1.42in;left:.95in;right:auto;text-align:left">Draft · not for sending</div>' : ""}<div class="kicker">${html(kind)} <span class="dot">&bull;</span> ${year}</div><div class="cover-mid"><h1 style="font-size:${h1pt}pt">${html(client)}<span class="thin">an outside-in website review</span></h1><div class="rule"></div><div class="project">${html(site.host)}</div><div class="cover-foot">${foot}</div></div></div></div>`;
    const page = `<!doctype html><html><head><meta charset="utf-8"><title>${html(client)}: ${html(kind)}</title><style>${fonts}</style><style>${css}</style></head><body>${cover}<div class="doc">${bodyHtml}</div></body></html>`;
    // the HTML sits in the run folder so the report can reference screenshots/ with relative paths
    const tmp = path.join(ctx.outDir, "AUDIT-REPORT.html"); fs.writeFileSync(tmp, page);

    const browser = await U.launch(); let pages = null;
    try {
      const p = await browser.newPage(); await p.goto("file:///" + tmp.replace(/\\/g, "/").replace(/^\//, ""), { waitUntil: "networkidle" });
      const out = path.join(ctx.outDir, draft ? "AUDIT-REPORT.draft.pdf" : "AUDIT-REPORT.pdf");
      await p.pdf({ path: out, width: "8.5in", height: "11in", printBackground: true, preferCSSPageSize: true });
      pages = (fs.readFileSync(out, "latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
      return { file: path.basename(out), pages, kb: Math.round(fs.statSync(out).size / 1024), fonts_embedded: !!fonts, cover: { client, prepared_for: contact, prepared_by: freelancer || "MISSING: pass --freelancer", date }, draft, language_scan: hits.length ? LANG.summarize(hits) : "passed", needs_model: "Open the PDF and look at the cover and one findings page before it ships." };
    } finally { await browser.close(); }
  },
};
U.standalone(module.exports, module);
