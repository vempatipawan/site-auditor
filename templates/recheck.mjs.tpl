/*
 * recheck.mjs
 * ---------------------------------------------------------------------------
 * Re-measures the numbers in your website audit, from the outside, on any day
 * you choose. Each line shows the value on the day of the audit beside the
 * value right now, so you can see for yourself what has been fixed.
 *
 * It only reads public pages, the same way a visitor's browser does.
 * No login, no admin, no forms. Nothing on your site is changed.
 *
 * HOW TO RUN
 *   1. Install Node.js from nodejs.org (the LTS button). Nothing else.
 *   2. Save this file somewhere, open a terminal in that folder, and run:
 *
 *        node recheck.mjs
 *
 * Run it before a developer starts and again when they say they are done.
 * Timings move a little from run to run and from place to place. Read a
 * timing as better or worse only when it moves by a clear margin.
 *
 * __PREPARED_LINE__
 * Yours to keep and to hand to anyone.
 * ---------------------------------------------------------------------------
 */

const AUDIT = __AUDIT_JSON__;

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };
const W = 100;
let better = 0, same = 0, worse = 0, unknown = 0;

/* ---------------------------------------------------------------- helpers */
const pad = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n - 1) + ' ' : s + ' '.repeat(n - s.length); };
const rule = () => console.log('  ' + '-'.repeat(W - 2));
const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shortUrl = (u) => { try { const x = new URL(u); return (x.pathname + x.search).slice(0, 60) || '/'; } catch { return String(u).slice(0, 60); } };

// One request, redirects followed by hand so every hop is counted. Never throws.
async function get(url, method = 'GET') {
  let current = url, hops = 0, firstByte = null;
  for (let i = 0; i < 7; i++) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 30000), t0 = Date.now();
    try {
      const res = await fetch(current, { method, redirect: 'manual', headers: UA, signal: ctrl.signal });
      firstByte = Date.now() - t0;
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) { hops++; current = new URL(loc, current).toString(); try { await res.arrayBuffer(); } catch {} continue; }
      const text = method === 'HEAD' ? '' : await res.text();
      const cookies = res.headers.getSetCookie ? res.headers.getSetCookie().map((c) => c.split('=')[0].trim()) : [];
      return { ok: true, status: res.status, hops, finalUrl: current, headers: res.headers, text, firstByte, cookies };
    } catch (e) {
      return { ok: false, status: 0, hops, finalUrl: current, text: '', firstByte: null, cookies: [], error: 'no answer' };
    } finally { clearTimeout(timer); }
  }
  return { ok: false, status: 0, hops, finalUrl: current, text: '', cookies: [], error: 'redirect loop' };
}
async function statusOf(url) { let r = await get(url, 'HEAD'); if (!r.ok || [403, 405, 501].includes(r.status)) r = await get(url, 'GET'); return r; }

function readPage(html) {
  const first = (re) => { const m = html.match(re); return m ? m[1] : null; };
  const meta = (attr, name) => first(new RegExp('<meta[^>]+' + attr + '=["\']' + name + '["\'][^>]*content=["\']([\\s\\S]*?)["\']', 'i')) || first(new RegExp('<meta[^>]+content=["\']([\\s\\S]*?)["\'][^>]*' + attr + '=["\']' + name + '["\']', 'i'));
  const decode = (s) => (s || '').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#8211;|&ndash;/g, '-').replace(/&#8217;/g, "'").replace(/&#038;/g, '&').replace(/\s+/g, ' ').trim();
  const title = first(/<title[^>]*>([\s\S]*?)<\/title>/i), desc = meta('name', 'description');
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  let noAlt = 0; for (const t of imgs) { const alt = t.match(/\balt=["']([^"']*)["']/i); if (!alt || !alt[1].trim()) noAlt++; }
  const headings = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].filter((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim());
  const types = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const walk = (o) => { if (!o) return; if (Array.isArray(o)) return o.forEach(walk); if (typeof o === 'object') { if (o['@type']) types.push(o['@type']); if (o['@graph']) walk(o['@graph']); } }; walk(JSON.parse(m[1].trim())); } catch {}
  }
  return {
    title: decode(title),
    description_chars: decode(desc).length,
    main_headings: headings.length,
    structured_data_items: types.length,
    share_image: meta('property', 'og:image') ? 'yes' : 'no',
    stylesheets: (html.match(/<link[^>]+rel=["']stylesheet["']/gi) || []).length,
    script_files: (html.match(/<script\b[^>]*\bsrc=/gi) || []).length,
    images_without_description: noAlt,
    html_kb: Math.round(Buffer.byteLength(html) / 1024),
  };
}

// dir: 'lower' = a smaller number is better, 'higher' = a bigger number is better, 'match' = should equal `want`
function line(label, audited, today, dir, want) {
  let verdict = 'same';
  if (today == null || today === '?') verdict = 'could not read';
  else if (dir === 'match') verdict = String(today) === String(want) ? (String(audited) === String(want) ? 'same (fine)' : 'FIXED') : (String(audited) === String(today) ? 'same' : 'changed');
  else if (dir && typeof audited === 'number' && typeof today === 'number') {
    const margin = Math.max(1, Math.abs(audited) * (dir === 'lower-timing' ? 0.2 : 0));
    if (Math.abs(today - audited) <= margin && dir === 'lower-timing') verdict = 'same (within normal variation)';
    else if (today === audited) verdict = 'same';
    else verdict = (dir === 'higher' ? today > audited : today < audited) ? 'BETTER' : 'WORSE';
  } else if (String(audited) !== String(today)) verdict = 'changed';
  if (/BETTER|FIXED/.test(verdict)) better++; else if (/WORSE/.test(verdict)) worse++; else if (/could not/.test(verdict)) unknown++; else same++;
  console.log('  ' + pad(label, 44) + pad(audited, 20) + pad(today == null ? '?' : today, 20) + verdict);
}
function head(n, title, note) {
  console.log('\n\n' + n + '.  ' + title); if (note) console.log('    ' + note);
  rule(); console.log('  ' + pad('', 44) + pad('ON ' + AUDIT.date, 20) + pad('TODAY', 20)); rule();
}

/* ---------------------------------------------------------------- checks */
async function speed(n) {
  const s = AUDIT.first_byte; if (!s) return false;
  head(n, 'HOW LONG THE SERVER TAKES TO ANSWER', 'The same page asked for ' + s.audited_ms.length + ' times in a row. With a working page cache the later answers come back fast.');
  const runs = []; let hits = 0, cookies = [];
  for (let i = 0; i < s.audited_ms.length; i++) { const r = await get(s.url); runs.push(r.firstByte); if (r.ok) { cookies = r.cookies; const h = ['x-cache', 'x-cache-status', 'cf-cache-status', 'x-litespeed-cache', 'x-varnish-cache', 'x-proxy-cache', 'x-kinsta-cache', 'x-sg-cache', 'x-rocket-cache'].map((k) => r.headers.get(k) || '').join(' '); if (/hit/i.test(h) || Number(r.headers.get('age')) > 0) hits++; } await sleep(400); }
  line('Typical wait for the first byte (ms)', median(s.audited_ms), median(runs), 'lower-timing');
  line('Answers served from a page cache', s.audited_cache_hits + ' of ' + s.audited_ms.length, hits + ' of ' + runs.length, null);
  if (s.audited_cookies) line('Cookies set on a first anonymous visit', s.audited_cookies.length, cookies.length, 'lower');
  if (cookies.length) console.log('\n    Cookies seen today: ' + cookies.join(', ') + '\n    A cookie on an anonymous visit is a common reason a page cache refuses to store a page.');
  return true;
}

async function pages(n) {
  if (!(AUDIT.pages || []).length) return false;
  head(n, 'WHAT GOOGLE READS ON YOUR KEY PAGES', 'Read straight from the page source, the same place Google reads it.');
  for (const p of AUDIT.pages) {
    const r = await get(p.url); console.log('\n  ' + p.label.toUpperCase() + '  ' + shortUrl(p.url));
    if (!r.ok || r.status !== 200) { console.log('    could not read this page today (' + (r.error || 'status ' + r.status) + ')'); unknown++; continue; }
    const now = readPage(r.text), a = p.audited;
    console.log('  ' + pad('  Title', 44) + '"' + a.title + '"  ->  "' + now.title + '"');
    line('  Title length (aim for 15 to 60)', a.title.length, now.title.length, null);
    line('  Meta description length (aim 70 to 160)', a.description_chars, now.description_chars, a.description_chars < 70 ? 'higher' : null);
    line('  Main headings (should be 1)', a.main_headings, now.main_headings, 'match', 1);
    line('  Structured data items', a.structured_data_items, now.structured_data_items, 'higher');
    line('  Image for link previews', a.share_image, now.share_image, 'match', 'yes');
    line('  Stylesheets', a.stylesheets, now.stylesheets, 'lower');
    line('  Script files', a.script_files, now.script_files, 'lower');
    line('  Images with no description', a.images_without_description, now.images_without_description, 'lower');
    line('  Page source size (KB)', a.html_kb, now.html_kb, 'lower');
    await sleep(400);
  }
  return true;
}

async function addresses(n) {
  if (!(AUDIT.variants || []).length) return false;
  head(n, 'THE FOUR WAYS TO TYPE YOUR ADDRESS', 'Each should reach the same final address in one step at most.');
  for (const v of AUDIT.variants) { const r = await statusOf(v.url); line(v.url.replace(/\/$/, '') + '  (redirects)', v.audited_hops, r.ok ? r.hops : null, 'lower'); if (r.ok) console.log('  ' + pad('', 44) + 'lands on ' + r.finalUrl); await sleep(300); }
  return true;
}

async function shouldBeClosed(n) {
  if (!(AUDIT.open_files || []).length) return false;
  head(n, 'THINGS THAT WERE PUBLIC AND SHOULD NOT BE', 'Each of these answered an outside visitor on the day of the audit.');
  for (const f of AUDIT.open_files) { const r = await statusOf(f.url); const today = !r.ok ? 'no answer' : r.status === 200 ? 'open' : 'closed'; line(f.label, 'open', today, 'match', 'closed'); console.log('  ' + pad('', 44) + f.url); await sleep(300); }
  return true;
}

async function deadLinks(n) {
  const L = [...(AUDIT.dead_links || []), ...(AUDIT.sitemap_problems || [])]; if (!L.length) return false;
  head(n, 'ADDRESSES THAT DID NOT LOAD', 'Links on your own pages, and addresses in your sitemap, that led nowhere.');
  for (const l of L) { const r = await statusOf(l.url); const today = !r.ok ? 'no answer' : r.status === 200 ? 'loads' : 'does not load'; line(shortUrl(l.url) + (l.pages ? '  (on ' + l.pages + ' pages)' : ''), l.audited, today, 'match', 'loads'); await sleep(300); }
  return true;
}

async function protections(n) {
  if (!(AUDIT.headers_missing || []).length) return false;
  head(n, 'STANDARD BROWSER PROTECTIONS', 'Settings your server sends with every page. Each one missing on the day of the audit is listed.');
  const r = await get(AUDIT.origin + '/');
  for (const h of AUDIT.headers_missing) line(h, 'missing', !r.ok ? null : r.headers.get(h) ? 'present' : 'missing', 'match', 'present');
  return true;
}

/* ---------------------------------------------------------------- main */
(async () => {
  console.log('\n' + '='.repeat(W));
  console.log('  ' + AUDIT.client.toUpperCase() + '  ·  WEBSITE RE-CHECK  ·  ' + AUDIT.host);
  console.log('  ' + new Date().toString());
  console.log('  Compares today with the audit of ' + AUDIT.date + '. Reads public pages only. Changes nothing.');
  console.log('='.repeat(W));
  if (typeof fetch !== 'function') { console.log('\n  This needs Node.js 18 or newer. Install the current LTS from nodejs.org and run it again.\n'); return; }
  let n = 1;
  for (const check of [speed, pages, addresses, shouldBeClosed, deadLinks, protections]) { try { if (await check(n)) n++; } catch (e) { console.log('    This section could not finish: ' + e.message); } }
  console.log('\n\n' + '='.repeat(W));
  console.log('  ' + better + ' better or fixed  ·  ' + same + ' unchanged  ·  ' + worse + ' worse  ·  ' + unknown + ' could not be read');
  console.log('  Run this again after any work on the site. The numbers in the audit report are the left-hand column.');
  console.log('='.repeat(W) + '\n');
})();
