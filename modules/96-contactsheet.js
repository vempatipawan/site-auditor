// 96-contactsheet: tiles the screenshots into a few captioned sheets so the model reviews 40+ screens in 4 or 5 image reads.
// Open a full-size screenshot only when a thumbnail shows a problem.
const path = require("path");
const { pathToFileURL } = require("url");
const U = require("../lib/util");

module.exports = {
  id: "96-contactsheet", name: "Screenshot contact sheets", tiers: ["bid", "full"],
  async run(ctx) {
    const shots = ctx.read("data/shots.json", []); if (!shots.length) return U.skipped("no screenshots");
    const pick = (re, full) => shots.filter((s) => re.test(s.file) && !!s.full === !!full);
    const groups = [["01-phone-first-screens", "Phone, first screen of each template (Chrome). First tile = as first seen, banner included.", [...pick(/first-view/), ...pick(/chromium-mobile/)], 5, 520], ["02-desktop-first-screens", "Desktop, first screen of each template (Chrome)", pick(/chromium-desktop/), 3, 420], ["03-phone-full-pages", "Phone, full page length (top portion shown)", pick(/full-mobile/, true), 6, 1500], ["04-desktop-full-pages", "Desktop, full page length (top portion shown)", pick(/full-desktop/, true), 3, 1500], ["05-safari-firefox-phone", "Safari engine and Firefox, phone", [...pick(/webkit-mobile/), ...pick(/firefox-mobile/)], 6, 520], ["06-buyer-journey", "Buyer journey on a phone: product, cart, checkout (full length)", pick(/journey-/, true), 3, 2200]].filter((g) => g[2].length);
    const browser = await U.launch(), sheets = [];
    for (const [name, title, list, cols, maxH] of groups) {
      const tiles = list.slice(0, cols * 2), W = 1800, tw = Math.floor((W - 20 * (cols + 1)) / cols);
      const html = `<html><body style="margin:0;background:#15181d;font-family:Segoe UI,Arial,sans-serif;color:#fff;width:${W}px"><div style="padding:14px 20px;font-size:22px;font-weight:600">${title}</div><div style="display:flex;flex-wrap:wrap;gap:20px;padding:0 20px 20px">${tiles.map((t) => `<div style="width:${tw}px"><div style="font-size:15px;padding:4px 0;color:#ffd479">${t.caption}</div><div style="max-height:${maxH}px;overflow:hidden;border:1px solid #444;background:#fff"><img src="../${t.file}" style="width:100%;display:block"></div><div style="font-size:12px;color:#9aa;padding-top:3px">${t.file}</div></div>`).join("")}</div></body></html>`;
      const page = await browser.newPage({ viewport: { width: W, height: 1000 } }); const htmlFile = path.join(ctx.sheetDir, name + ".html"); require("fs").writeFileSync(htmlFile, html); await page.goto(pathToFileURL(htmlFile).href, { waitUntil: "load" }); await U.sleep(500); require("fs").unlinkSync(htmlFile); // a real file:// page may load local images; setContent on about:blank may not
      const out = path.join(ctx.sheetDir, name + ".jpg"); await page.screenshot({ path: out, type: "jpeg", quality: 72, fullPage: true }); await page.close(); sheets.push({ file: "sheets/" + name + ".jpg", title, tiles: tiles.length });
    }
    await browser.close(); ctx.write("data/sheets.json", sheets);
    return { sheets: sheets.map((s) => `${s.file} (${s.tiles} tiles): ${s.title}`), screenshots_total: shots.length };
  },
};
U.standalone(module.exports, module);
