// The language gate (PRD section 9, gate 7) as code. Every client-facing file is scanned before it ships.
// lint() reports; letterSafe() rewrites what can be rewritten mechanically for text that gets pasted into a bid.
const RULES = [
  { id: "em-dash", re: /[—–]/g, why: "em or en dash: use a comma, a colon or a full stop" },
  { id: "c-word", re: /\bcrawl\w*/gi, why: 'say "audited" or "checked"' },
  { id: "contact", re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b|\b(whatsapp|telegram|skype)\b/gi, why: "contact detail or off-platform handle" },
  { id: "team-voice", re: /\b(my|our) team\b|\bwe (can|will|have|are|found|audited|checked)\b/gi, why: "solo voice only" },
  { id: "dead-url", re: /kareflow\.in/gi, why: "dead URL, never link it" },
  { id: "unicode-bold-link", re: /[\u{1D400}-\u{1D7FF}]+\.[\u{1D400}-\u{1D7FF}a-z]{2,}/gu, why: "links stay plain ASCII" },
  { id: "model-slot", re: /\{\{MODEL:[A-Z_]+\}\}/g, why: "unfilled model slot" },
];
// Only for text pasted into a bid form: words the platform's filter reacts to.
const LETTER_RULES = [
  { id: "waf-word", re: /\b(debug\w*|attack\w*|exploit\w*|hack\w*|inject\w*|firewall|vulnerab\w*|malware|crash\w*)\b/gi, why: "platform-filter word: describe the symptom instead" },
  { id: "error-code", re: /\b(40[0-9]|50[0-9])\b/g, why: "error code: describe what the visitor sees" },
  { id: "angle-brackets", re: /[<>]/g, why: "angle brackets" },
  { id: "file-ext", re: /\.(dll|php|log|env|sql)\b/gi, why: "file extension: name the thing in words" },
  { id: "security-phrase", re: /\bsecurity (advisory|advisories|hole|flaw|issue|patch|header\w*)\b/gi, why: 'separate "security" from technical terms' },
];
const SWAPS = [
  [/\s*[—–]\s*/g, ", "], [/\bcrawlers\b/gi, "search engines"], [/\bcrawl(ed|ing)?\b/gi, (m, s) => (s === "ed" ? "audited" : s === "ing" ? "auditing" : "audit")],
  [/\b404s?\b/g, "dead page"], [/\b(500|502|503)\b/g, "server fault"], [/\b(301|302|307|308)\b/g, "redirect"], [/\bdebug\.log\b/gi, "internal fault log"], [/\bdebug\w*/gi, "troubleshooting"],
  [/\b(a |one )?published security advisor(y|ies)\b/gi, "a published safety notice"], [/\bvulnerab(le|ility|ilities)\b/gi, (m, s) => (s === "le" ? "out of date and flagged" : "known weakness")],
  [/\bsecurity headers?\b/gi, "browser protection settings"], [/\bstaging\b/gi, "test-copy"], [/\bxmlrpc(\.php)?\b/gi, "the old remote-publishing door"], [/\bwp-login(\.php)?\b/gi, "the default login address"],
  [/\breadme\.html\b/gi, "the default readme file"], [/[<>]/g, ""], [/\.php\b/gi, ""],
];

function lint(text, { letter = false } = {}) {
  const hits = []; const lines = String(text).split("\n");
  for (const rule of letter ? RULES.concat(LETTER_RULES) : RULES) lines.forEach((ln, i) => { for (const m of ln.matchAll(rule.re)) hits.push({ rule: rule.id, line: i + 1, match: m[0], why: rule.why }); });
  return hits;
}
function letterSafe(text) { let t = String(text); for (const [re, to] of SWAPS) t = t.replace(re, to); return t.replace(/ {2,}/g, " ").replace(/ ,/g, ","); }
const summarize = (hits) => { const by = {}; for (const h of hits) (by[h.rule] = by[h.rule] || []).push(`L${h.line} "${h.match}"`); return Object.entries(by).map(([k, v]) => `${k} x${v.length}: ${v.slice(0, 4).join(", ")}${v.length > 4 ? " ..." : ""}`); };

module.exports = { lint, letterSafe, summarize };
