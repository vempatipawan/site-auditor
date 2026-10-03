// Usage: node render-pdf.cjs <html file> <pdf out> [footer text]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [html, pdf, footer = ''] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file:///' + path.resolve(html).split(path.sep).join('/'));
  await p.pdf({
    path: pdf, format: 'A4', printBackground: true,
    margin: { top: '10mm', bottom: '12mm', left: '0', right: '0' },
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#888">${footer} · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
  });
  await b.close();
})();
