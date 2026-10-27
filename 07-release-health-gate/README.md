# 07 · Release health gate

**Business problem.** An external crawl of WowGlamDecor reported 855 errors. Working through them found bugs that had been live for months:

- Every JSON-LD value on 198 pages was double-encoded.
- 47 internal links were built from the wrong field.
- 276 noindex pages were listed in the sitemap.
- 70 images were broken.

Each one was costing search visibility, which for this site is the revenue.

**What the code does** (`site-health.js`)

The throwaway scripts that found those bugs became one permanent gate of **56 checks**: 36 errors, 17 warnings and 3 notices. They cover:

- Metadata: titles, descriptions, H1s, canonicals, robots.
- The sitemap against what can actually be indexed.
- Broken and orphaned internal links, including links built in JavaScript.
- Structured data: products without offers, offers without prices, empty FAQs, double-encoding.
- Open Graph and social tags.
- Images: alt text, empty sources, file size, retailer hotlinks.
- House copy rules: banned AI-sounding words, placeholder text, phrases repeated across pages.

It exits with code 1 when any error is found, so it **blocks a deploy**. `--live` adds network checks, and `--json` feeds the weekly reporting routine, which diffs results by check id.

**Design choice:** each bug that reached production became a check, so the same class of bug can't ship twice.
