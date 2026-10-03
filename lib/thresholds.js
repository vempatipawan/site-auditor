// Every pass/fail number in one place, each with its source. Change here, nowhere else.
module.exports = {
  // Core Web Vitals "good" thresholds (web.dev / Google Search Central)
  LCP_GOOD_MS: 2500, LCP_POOR_MS: 4000,
  INP_GOOD_MS: 200, INP_POOR_MS: 500,
  CLS_GOOD: 0.1, CLS_POOR: 0.25,
  TTFB_GOOD_MS: 800, TTFB_POOR_MS: 1800,
  FCP_GOOD_MS: 1800,
  TBT_GOOD_MS: 200,

  // Page budget (common industry guidance, HTTP Archive medians)
  PAGE_WEIGHT_KB: 1500, REQUESTS: 80, FONT_FAMILIES: 3, RENDER_BLOCKING: 6,
  IMG_OVERSIZE_RATIO: 2,          // natural width more than 2x displayed width
  UNUSED_BYTES_PCT: 50,           // more than half of CSS/JS unused on the template

  // On-page (Google snippet behaviour)
  TITLE_MAX: 60, TITLE_MIN: 15, DESC_MIN: 70, DESC_MAX: 160, THIN_HTML_TEXT_CHARS: 600,

  // UX and accessibility (WCAG 2.2 SC 2.5.8, Google mobile guidance, Baymard)
  TAP_TARGET_PX: 24, BODY_FONT_PX: 16, CHECKOUT_FIELDS_BENCHMARK: 8, CHECKOUT_FIELDS_AVG: 12,

  // Hygiene
  REDIRECT_HOPS: 1, CERT_EXPIRY_DAYS: 30, DOMAIN_EXPIRY_DAYS: 60,

  // Platform context. Source: HTTP Archive Core Web Vitals Technology Report, Nov 2025 (mobile pass rate).
  PLATFORM_CWV_PASS: { asOf: "2025-11", WordPress: 46, WooCommerce: 40, Shopify: 76, BigCommerce: 60, Wix: 70, Squarespace: 68 },

  DEFAULT_WORDLIST_PLACEHOLDER: ["lorem ipsum", "sample page", "hello world!", "just another wordpress site", "your company name", "example.com", "123 456 789", "john doe", "coming soon"],
  STAGING_NAME_RE: /(^|[.-])(stag|stage|staging|dev|devel|test|testing|old|backup|bak|beta|demo|new|preprod|uat|qa|sandbox|temp|tmp|clone|copy)([0-9.-]|$)/i,
  AI_BOTS: ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-Web", "anthropic-ai", "PerplexityBot", "Google-Extended", "CCBot", "Bytespider", "Amazonbot", "Applebot-Extended", "meta-externalagent"],
};
