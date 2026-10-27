#!/usr/bin/env node
/**
 * scripts/site-health.js
 * One repeatable health check for the whole site.
 * ─────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * On 2026-08-27 an Ahrefs crawl reported 855 errors. Working through it found
 * bugs that had been live for months and that nothing in this repo would ever
 * have caught:
 *   - every JSON-LD string on 198 pages was double-encoded (valid JSON, wrong
 *     values, so a JSON.parse check passed it happily)
 *   - 47 pSEO links built from category_slug instead of the hub URL segment
 *   - the og:image fallback pointed at a 404 in 10 templates
 *   - 276 noindex pages were listed in sitemap.xml
 *   - 70 broken images, including 75 hub keys pointing at objects never uploaded
 *   - crawlers without Accept: image/webp were served 1.6 MB PNGs
 * Every one of those was found by a throwaway script. This file is those
 * scripts, kept.
 *
 * USAGE
 *   node scripts/site-health.js              # build checks only, no network
 *   node scripts/site-health.js --live       # adds live URL, image and header checks
 *   node scripts/site-health.js --json       # machine-readable, for the weekly routine
 *   node scripts/site-health.js --verbose    # show every offender, not a sample
 *   node scripts/site-health.js --fail-on=warning   # exit 1 on warnings too
 *
 * Exit code is 1 when any ERROR-severity check has offenders (default), so it
 * can gate a deploy. Run `hugo` first: this reads public/.
 *
 * ADDING A CHECK
 * Push onto CHECKS. Return { offenders: [...], detail? }. Keep the id stable,
 * it is what the weekly report diffs against.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');
const SITE = 'https://wowglamdecor.com';
const IMG_HOST = 'https://images.wowglamdecor.com';

const args = new Set(process.argv.slice(2));
const LIVE = args.has('--live');
const JSON_OUT = args.has('--json');
const VERBOSE = args.has('--verbose');
const SEO = args.has('--seo');
const FAIL_ON = (([...args].find(a => a.startsWith('--fail-on=')) || '--fail-on=error').split('=')[1]);

const ERROR = 'error', WARNING = 'warning', NOTICE = 'notice';

// Hugo escapes titles and descriptions, so "Black &amp; Gold" is four characters
// longer in the source than it is on a search results page. Measuring the raw
// HTML reported seven product titles as over-length when none of them were.
// Decode once at extraction so every length and copy check sees real text.
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// ── Thresholds, in one place so the weekly report and this agree ────────────
const TITLE_MAX = 60;         // what Google renders before truncating
const DESC_MIN = 110;
const DESC_MAX = 160;
const IMAGE_MAX_KB = 100;     // Ahrefs' "image file size too large" threshold

const BANNED_WORDS = ['delve', 'leverage', 'seamlessly', 'cutting-edge', 'game-changer',
  'groundbreaking', 'unlock', 'revolutionize', 'harness', 'utilize', 'streamline',
  'transformative', 'innovative', 'state-of-the-art', 'robust', 'empowering', 'holistic'];

const PLACEHOLDERS = ['lorem ipsum', 'reallygreatsite', 'example.com', '555-01', '123-456-7890',
  'your-domain', 'TODO:', 'FIXME', 'Lorem Ipsum'];

// Pooled phrases from the caption retrofit. If any reach the site, something
// regenerated copy from a pool again (TODO 82).
const POOLED_PHRASES = [
  'Quick favor: stop scrolling', 'Real talk:', 'Friend, if this sounds like you',
  'Cheaper than therapy', 'Your future self will thank you',
];

// Static assets, not pages. A link to one is not a broken page link.
const ASSET_EXT = /\.(png|jpe?g|webp|svg|ico|xml|txt|json|pdf|css|js|webmanifest|mp4|woff2?|zip|csv)$/i;
// Unrendered template literals scraped out of inline <script> blocks.
const TEMPLATE_ARTEFACT = /[${`]|'\s*\+|\+\s*'/;
// /posts/page/2/ and friends: one Page object, so they share page 1's
// canonical by design and are deliberately kept out of the sitemap.
const PAGINATED = /\/page\/\d+\/$/;

// ── Load the built site ─────────────────────────────────────────────────────
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (e.name === 'index.html') out.push(f);
  }
  return out;
}

const attr = (html, re) => (html.match(re) || [])[1];

function loadPages() {
  const pages = [];
  let aliases = 0;
  for (const file of walk(PUBLIC)) {
    const html = fs.readFileSync(file, 'utf8');
    // Hugo alias stubs are ~330-byte meta-refresh redirects, not pages.
    // Counting them as content produced 278 false "missing H1" hits once.
    if (/http-equiv="?refresh/i.test(html)) { aliases++; continue; }
    const url = '/' + path.relative(PUBLIC, file).split(path.sep).join('/').replace(/index\.html$/, '');
    const robots = attr(html, /<meta name="robots" content="([^"]*)"/) || '';
    const head = html.slice(0, html.indexOf('</head>') + 7);
    pages.push({
      url, html, head, file,
      title: decodeEntities(attr(html, /<title>([\s\S]*?)<\/title>/) || '').trim(),
      desc: decodeEntities(attr(html, /<meta name="description" content="([\s\S]*?)"\s*\/?>/) || '').trim(),
      robots,
      noindex: /noindex/i.test(robots),
      canonical: attr(html, /<link rel="canonical" href="([^"]*)"/) || '',
      h1s: [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim()),
      // Internal links come in BOTH forms in this codebase: relative from most
      // templates, absolute from the blog listing. Matching only the relative
      // form made all 53 posts look orphaned and hid any broken absolute link.
      links: [...new Set([
        ...[...html.matchAll(/href="(\/[^"#?]*)"/g)].map(m => m[1]),
        ...[...html.matchAll(/href="https?:\/\/(?:www\.)?wowglamdecor\.com(\/[^"#?]*)"/g)].map(m => m[1]),
      ])],
      // Strip inline <script> first: product-filter.js builds card markup by
      // string concatenation, and those fragments are not real img tags.
      imgs: [...html.replace(/<script[\s\S]*?<\/script>/g, '').matchAll(/<img\b[^>]*>/g)].map(m => m[0]),
      jsonld: [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]),
      isPreview: url.startsWith('/preview/'),
    });
  }
  return { pages, aliases };
}

const { pages, aliases } = loadPages();
const indexable = pages.filter(p => !p.noindex && !p.isPreview);
const known = new Set(pages.map(p => p.url));

function pageExists(link) {
  const withSlash = link.endsWith('/') ? link : link + '/';
  if (known.has(withSlash) || known.has(link)) return true;
  const rel = decodeURIComponent(link).replace(/^\//, '');
  return fs.existsSync(path.join(PUBLIC, rel));
}

// Absolute URL for an <img src>, or null if it is not checkable.
function imgURL(tag) {
  let src = attr(tag, /\bsrc="([^"]+)"/);
  if (!src || TEMPLATE_ARTEFACT.test(src)) return null;
  if (src.startsWith('//')) return 'https:' + src;
  if (src.startsWith('/')) return SITE + src;
  return src.startsWith('http') ? src : null;
}

// ── JSON-LD helpers ─────────────────────────────────────────────────────────
function ldNodes(node, out = []) {
  if (Array.isArray(node)) { node.forEach(n => ldNodes(n, out)); return out; }
  if (node && typeof node === 'object') {
    if (node['@type']) out.push(node);
    Object.values(node).forEach(v => ldNodes(v, out));
  }
  return out;
}
// "\"Foo\"" parses to a string that still carries its own quotes. This is what
// Hugo's jsonify does inside <script> without | safeJS.
const doubleEncoded = v => typeof v === 'string' && v.length > 1 && v.startsWith('"') && v.endsWith('"');
function ldDoubleEncoded(node, hits = [], p = '$') {
  if (Array.isArray(node)) { node.forEach((n, i) => ldDoubleEncoded(n, hits, `${p}[${i}]`)); return hits; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (doubleEncoded(v)) hits.push(`${p}.${k}`);
      else ldDoubleEncoded(v, hits, `${p}.${k}`);
    }
  }
  return hits;
}

// Visible text only: strips scripts, styles and tags.
const visibleText = html => html
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<[^>]+>/g, ' ');

// ── Check registry ──────────────────────────────────────────────────────────
const CHECKS = [];
const check = (id, severity, category, label, run, opts = {}) =>
  CHECKS.push({ id, severity, category, label, run, live: !!opts.live, seo: !!opts.seo });

// -- Indexability & metadata ------------------------------------------------
check('title-missing', ERROR, 'Metadata', 'pages with no <title>',
  () => indexable.filter(p => !p.title).map(p => p.url));

check('title-too-long', WARNING, 'Metadata', `title over ${TITLE_MAX} chars`,
  () => indexable.filter(p => p.title.replace(/&amp;/g, '&').length > TITLE_MAX)
    .map(p => `${p.url}  (${p.title.length})`));

check('title-duplicate', ERROR, 'Metadata', 'pages sharing a duplicate <title>', () => {
  const by = {};
  indexable.forEach(p => p.title && (by[p.title] ||= []).push(p.url));
  return Object.entries(by).filter(([, v]) => v.length > 1)
    .flatMap(([t, v]) => v.map(u => `${u}  "${t.slice(0, 50)}"`));
});

check('desc-missing', ERROR, 'Metadata', 'pages with no meta description',
  () => indexable.filter(p => !p.desc).map(p => p.url));

check('desc-too-short', WARNING, 'Metadata', `meta description under ${DESC_MIN} chars`,
  () => indexable.filter(p => p.desc && p.desc.length < DESC_MIN).map(p => `${p.url}  (${p.desc.length})`));

check('desc-too-long', WARNING, 'Metadata', `meta description over ${DESC_MAX} chars`,
  () => indexable.filter(p => p.desc.length > DESC_MAX).map(p => `${p.url}  (${p.desc.length})`));

check('desc-duplicate', WARNING, 'Metadata', 'pages sharing a duplicate meta description', () => {
  const by = {};
  indexable.forEach(p => p.desc && (by[p.desc] ||= []).push(p.url));
  return Object.entries(by).filter(([, v]) => v.length > 1).flatMap(([, v]) => v);
});

check('h1-missing', ERROR, 'Metadata', 'pages with no H1',
  () => indexable.filter(p => p.h1s.length === 0).map(p => p.url));

check('h1-multiple', WARNING, 'Metadata', 'pages with more than one H1',
  () => indexable.filter(p => p.h1s.length > 1).map(p => `${p.url}  (${p.h1s.length})`));

check('canonical-missing', ERROR, 'Metadata', 'pages with no canonical',
  () => indexable.filter(p => !p.canonical).map(p => p.url));

check('canonical-mismatch', WARNING, 'Metadata', 'canonical does not match the page URL',
  () => indexable.filter(p => !PAGINATED.test(p.url))
    .filter(p => p.canonical && p.canonical !== SITE + p.url)
    .map(p => `${p.url} -> ${p.canonical}`));

check('robots-missing', NOTICE, 'Metadata', 'pages with no robots meta',
  () => pages.filter(p => !p.isPreview && !p.robots).map(p => p.url));

// -- Sitemap ----------------------------------------------------------------
const sitemapURLs = (() => {
  const f = path.join(PUBLIC, 'sitemap.xml');
  if (!fs.existsSync(f)) return null;
  return [...fs.readFileSync(f, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
})();

check('sitemap-missing', ERROR, 'Sitemap', 'sitemap.xml not built',
  () => (sitemapURLs ? [] : ['public/sitemap.xml']));

check('sitemap-has-noindex', ERROR, 'Sitemap', 'noindex pages listed in sitemap.xml', () => {
  if (!sitemapURLs) return [];
  const noindexSet = new Set(pages.filter(p => p.noindex || p.isPreview).map(p => SITE + p.url));
  return sitemapURLs.filter(u => noindexSet.has(u));
});

check('sitemap-omits-indexable', WARNING, 'Sitemap', 'indexable pages missing from sitemap.xml', () => {
  if (!sitemapURLs) return [];
  const inMap = new Set(sitemapURLs);
  return indexable.filter(p => !PAGINATED.test(p.url) && !inMap.has(SITE + p.url)).map(p => p.url);
});

// -- Links ------------------------------------------------------------------
const brokenLinks = new Map();
for (const p of pages) {
  if (p.isPreview) continue;
  for (const l of p.links) {
    if (ASSET_EXT.test(l) || TEMPLATE_ARTEFACT.test(l)) continue;
    if (pageExists(l)) continue;
    (brokenLinks.get(l) || brokenLinks.set(l, []).get(l)).push(p.url);
  }
}

check('link-broken', ERROR, 'Links', 'internal links to a page that does not exist',
  () => [...brokenLinks.entries()].map(([t, from]) => `${t}  (from ${from.length}: ${from[0]})`));

const incoming = new Map(pages.map(p => [p.url, 0]));
for (const p of pages) {
  for (const l of p.links) {
    const t = l.endsWith('/') ? l : l + '/';
    if (t === p.url) continue;
    if (incoming.has(t)) incoming.set(t, incoming.get(t) + 1);
  }
}

check('page-orphan', ERROR, 'Links', 'indexable pages with NO incoming internal link',
  () => indexable.filter(p => p.url !== '/' && incoming.get(p.url) === 0).map(p => p.url));

check('page-thin-links', NOTICE, 'Links', 'indexable pages with only one incoming internal link',
  () => indexable.filter(p => p.url !== '/' && incoming.get(p.url) === 1).map(p => p.url));

// link-broken only sees hrefs in static HTML. The homepage builds its category
// rows with inline JS string concatenation ('<a href="' + cat.href + '"'), so
// its 13 "Explore all" links were invisible to it and all 13 pointed at
// /<category-slug>/, which has never existed — every one a 404 on the highest
// value page on the site, found by an Ahrefs crawl on 2026-09-02 while this
// file reported zero broken links. Same blind spot that hid /product/null/.
//
// This scans inline <script> for literal site paths and checks them the same
// way. It cannot resolve a path built from a variable, so it is a floor, not a
// ceiling: a hardcoded bad path is caught, a computed one still is not.
const JS_PATH = /["'](\/(?!\/)[a-z0-9][a-z0-9\-/]*\/)["']/gi;
check('link-broken-in-js', ERROR, 'Links',
  'literal site paths inside inline scripts that do not resolve to a page',
  () => {
    const out = [];
    for (const p of pages) {
      for (const m of p.html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (/\bsrc=/.test(m[1])) continue;   // external file. Test the TAG, not the body: bodies emit img src= strings
        for (const h of m[2].matchAll(JS_PATH)) {
          const link = h[1];
          if (/^\/(cdn-cgi|api)\//.test(link)) continue;
          if (pageExists(link)) continue;
          out.push(`${p.url}  ${link}`);
        }
      }
    }
    return [...new Set(out)];
  });

// -- Structured data --------------------------------------------------------
check('ld-invalid', ERROR, 'Structured data', 'JSON-LD blocks that do not parse',
  () => pages.flatMap(p => p.jsonld.flatMap(raw => {
    try { JSON.parse(raw); return []; } catch (e) { return [`${p.url}  ${e.message.slice(0, 50)}`]; }
  })));

check('ld-double-encoded', ERROR, 'Structured data',
  'JSON-LD values wrapped in literal quotes (jsonify without | safeJS)',
  () => pages.flatMap(p => p.jsonld.flatMap(raw => {
    let j; try { j = JSON.parse(raw); } catch { return []; }
    const hits = ldDoubleEncoded(j);
    return hits.length ? [`${p.url}  ${j['@type'] || '?'}  ${hits.slice(0, 3).join(', ')}`] : [];
  })));

check('ld-product-no-offer', ERROR, 'Structured data',
  'Product with no offers, review or aggregateRating',
  () => pages.flatMap(p => p.jsonld.flatMap(raw => {
    let j; try { j = JSON.parse(raw); } catch { return []; }
    return ldNodes(j).filter(n => n['@type'] === 'Product' && !n.offers && !n.review && !n.aggregateRating)
      .map(n => `${p.url}  ${n.name || '(unnamed)'}`);
  })));

check('ld-offer-no-price', ERROR, 'Structured data', 'Offer with no price or priceSpecification',
  () => pages.flatMap(p => p.jsonld.flatMap(raw => {
    let j; try { j = JSON.parse(raw); } catch { return []; }
    return ldNodes(j).filter(n => n['@type'] === 'Offer' && n.price === undefined && !n.priceSpecification)
      .map(() => p.url);
  })));

check('ld-faq-empty', ERROR, 'Structured data', 'FAQPage Question with an empty name or answer',
  () => pages.flatMap(p => p.jsonld.flatMap(raw => {
    let j; try { j = JSON.parse(raw); } catch { return []; }
    return ldNodes(j).filter(n => n['@type'] === 'FAQPage')
      .flatMap(n => (n.mainEntity || []).filter(q => !q.name?.trim() || !q.acceptedAnswer?.text?.trim())
        .map(q => `${p.url}  "${String(q.name).slice(0, 40)}"`));
  })));

check('ld-breadcrumb-bad', WARNING, 'Structured data', 'BreadcrumbList item with no name or position',
  () => pages.flatMap(p => p.jsonld.flatMap(raw => {
    let j; try { j = JSON.parse(raw); } catch { return []; }
    return ldNodes(j).filter(n => n['@type'] === 'BreadcrumbList')
      .flatMap(n => (n.itemListElement || [])
        .filter(li => li.position === undefined || (!li.name && !li.item?.name))
        .map(() => p.url));
  })));

// -- Social -----------------------------------------------------------------
const OG_REQUIRED = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'];
check('og-incomplete', ERROR, 'Social', 'pages with incomplete Open Graph tags',
  () => indexable.map(p => {
    const missing = OG_REQUIRED.filter(t => !p.head.includes(`property="${t}"`));
    return missing.length ? `${p.url}  missing: ${missing.join(', ')}` : null;
  }).filter(Boolean));

check('twitter-missing', WARNING, 'Social', 'pages with no twitter:card',
  () => indexable.filter(p => !p.head.includes('name="twitter:card"')).map(p => p.url));

// -- Images -----------------------------------------------------------------
check('img-no-alt', ERROR, 'Images', 'img tags with no alt attribute',
  () => pages.flatMap(p => p.imgs.filter(t => !/\balt=/.test(t)).map(t => `${p.url}  ${(imgURL(t) || t).slice(0, 60)}`)));

// The quick-view modal ships <img src=""> inside a [hidden] dialog that JS
// fills on open. Modern browsers issue no request for an empty src, so this
// is a tidiness notice rather than a broken image.
check('img-empty-src', NOTICE, 'Images', 'img tags with an empty or templated src',
  () => pages.flatMap(p => p.imgs.filter(t => {
    const s = attr(t, /\bsrc="([^"]*)"/);
    return s !== undefined && (s === '' || TEMPLATE_ARTEFACT.test(s));
  }).map(t => `${p.url}  ${t.slice(0, 70)}`)));

// /remote/ exists so no page ever links a retailer's own origin: Homary serves
// up to 12.9 MB there and Best Choice up to 1.28 MB, and a crawler that does
// not accept WebP pays all of it. BG-11 routed the PDP hero and one reco row;
// eight other call sites were missed and only surfaced when 24 Best Choice
// products pushed the live image-weight count up. Any raw origin is a miss.
const RETAILER_ORIGINS = /https:\/\/(cdn\.shopify\.com|img5?\.su-cdn\.com|cdn\.homary\.com)\//;
check('img-retailer-origin-raw', ERROR, 'Images', 'retailer image origins linked directly instead of through /remote/',
  () => pages.flatMap(p => {
    const hits = p.html.match(new RegExp(RETAILER_ORIGINS.source, 'g')) || [];
    return hits.length ? [`${p.url}  ${hits.length} reference${hits.length === 1 ? '' : 's'}  ${hits[0]}`] : [];
  }));

// A template that builds an image URL by concatenating a base onto a database
// field ships the bare base when the field is empty. `image_key` is empty on
// every ingested product (they carry the retailer's photographs in `images`
// instead), so the blog sidebar's cross-sell put src="https://images.wowglam
// decor.com/" on every post that happened to pick one, found 2026-09-05 by the
// live pass only. A URL with a host and no path is never a real image.
check('img-src-host-only', ERROR, 'Images', 'img src is a bare host with no path, from an empty template value',
  () => pages.flatMap(p => p.imgs.filter(t => {
    const s = attr(t, /\bsrc="([^"]*)"/);
    if (!s || !/^https?:\/\//.test(s)) return false;
    try { return new URL(s).pathname === '/'; } catch { return false; }
  }).map(t => `${p.url}  ${t.slice(0, 90)}`)));

// product-filter.js turns a click on a card's image button into a visit to
// /product/<slug>/, reading data-slug from the button or, failing that, the
// enclosing <article class="product-card">. Roomstyle and pSEO top-picks
// cards carry it only on the article, and until 2026-09-02 the script read
// only the button, so every one of those clicks landed on /product/null/
// (149 live pages). This holds the markup side of that contract.
check('card-btn-no-slug', ERROR, 'Links', 'card image buttons with no data-slug on the button or its article',
  () => pages.flatMap(p => {
    const html = p.html.replace(/<script[\s\S]*?<\/script>/g, '');
    const out = [];
    for (const m of html.matchAll(/<button\b[^>]*class="[^"]*product-card__img-btn[^"]*"[^>]*>/g)) {
      if (/\bdata-slug="[^"]+"/.test(m[0])) continue;
      const article = html.lastIndexOf('<article', m.index);
      const open = article === -1 ? '' : html.slice(article, html.indexOf('>', article) + 1);
      if (!/\bdata-slug="[^"]+"/.test(open)) out.push(`${p.url}  ${m[0].slice(0, 70)}`);
    }
    return out;
  }));

// images-worker.js negotiates a WebP sibling only for .png / .jpg / .jpeg keys.
// A product photo referenced as .avif (594 KB, the site's heaviest image on
// 2026-09-02) is served exactly as stored and the WebP twin beside it on R2 is
// never used. Keys with no extension at all negotiate since the same day (the
// worker treats them like .png), so only a foreign extension is flagged here.
const NEGOTIATED_EXT = /\.(png|jpe?g|webp)$/i;
check('img-ext-not-negotiated', ERROR, 'Images',
  'images on images.wowglamdecor.com with an extension the worker cannot negotiate',
  () => pages.flatMap(p => p.imgs.map(imgURL).filter(u => {
    if (!u || !u.startsWith(IMG_HOST) || u.startsWith(IMG_HOST + '/remote/')) return false;
    const file = u.split('?')[0].split('/').pop();
    return /\.[a-z0-9]+$/i.test(file) && !NEGOTIATED_EXT.test(file);
  }).map(u => `${p.url}  ${u}`)));

// A PDP gallery of one is a dead thumbnail row. Products drop to a single image
// when a bad shot is pulled: the 2026-09-02 subject audit removed 25 -2 images
// that showed the room instead of the product (a headboard for a shag rug, a
// faucet for a bathroom mirror), and each of those products is now down to two.
// This is the floor, so the next removal is noticed rather than shipped.
check('pdp-gallery-thin', WARNING, 'Images', 'products with fewer than 2 gallery images',
  () => {
    const file = path.join(ROOT, 'data', 'products.json');
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rows = Array.isArray(data) ? data : (data.products || Object.values(data).find(Array.isArray) || []);
    return rows.filter((p) => {
      let imgs = [];
      try { imgs = typeof p.images === 'string' ? JSON.parse(p.images || '[]') : (p.images || []); } catch { imgs = []; }
      return imgs.length < 2;
    }).map((p) => `${p.slug}  ${(() => { try { return (typeof p.images === 'string' ? JSON.parse(p.images || '[]') : (p.images || [])).length; } catch { return 0; } })()} image(s)`);
  });

// Hugo drops a future-dated page from the build entirely unless buildFuture is
// on, and this repo does not set it. Nothing errors: the page is simply absent,
// which no other check here can see because every check reads what WAS built.
// Cost a confused rebuild on 2026-09-03 when a new post was dated 09:00 UTC and
// written at 01:52, so it silently did not publish.
function futureDated() {
  const out = [];
  const now = Date.now();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.md')) continue;
      const head = fs.readFileSync(full, 'utf8').slice(0, 2000);
      const m = /^date:\s*['"]?(\d{4}-\d{2}-\d{2}[^\s'"]*)/m.exec(head);
      if (!m) continue;
      const t = Date.parse(m[1]);
      if (Number.isNaN(t) || t <= now) continue;
      out.push({ rel: path.relative(ROOT, full).split(path.sep).join('/'), raw: m[1], t, hours: Math.round((t - now) / 3600000) });
    }
  };
  walk(path.join(ROOT, 'content'));
  return out;
}

check('content-future-dated', WARNING, 'Copy',
  'content files dated in the future (Hugo will not build them)',
  () => futureDated().map((d) => `${d.rel}  dated ${d.raw} (${d.hours}h in the future)`));

// The daily rebuild (.github/workflows/daily-build.yml) fires anywhere from about
// 10:00 to 12:00 UTC, once a day. A post scheduled for any later hour misses that
// day's build and goes live a day late: on 2026-10-03 the 14:00 and 18:00 posts
// both slipped to 10-04. Midnight UTC is the only time every build is after.
check('content-scheduled-not-midnight', ERROR, 'Copy',
  'scheduled post not dated T00:00:00Z (it will publish a day late)',
  () => futureDated().filter((d) => {
    const u = new Date(d.t);
    return u.getUTCHours() || u.getUTCMinutes() || u.getUTCSeconds();
  }).map((d) => `${d.rel}  dated ${d.raw}, use ${new Date(d.t).toISOString().slice(0, 10)}T00:00:00Z`));


// A shortcode that loses its name renders as nothing, so Hugo passes the bare
// `{{ }}` delimiters straight through into the page. Found on 2026-09-03 in the
// FAQ answers of 11 posts, where an empty pair wrapped a restatement of the
// answer above it. It was live, and worse, it was inside the FAQPage JSON-LD
// that Google reads, so the braces were in the structured data too. Nothing
// caught it: the page built, the links worked, the schema parsed.
// Repaired by scripts/fix-shortcode-artifact.js.
check('content-shortcode-artifact', ERROR, 'Copy',
  'unrendered Hugo delimiters reaching the built page',
  () => pages.flatMap((p) => {
    const hits = p.html.match(/\{\{[^}]{0,120}\}\}/g) || [];
    return hits.slice(0, 2).map((h) => `${p.url}  ${h.trim().slice(0, 60)}`);
  }));
// -- SEO: self-competition ---------------------------------------------------
// Two of our own pages ranking for one query splits the authority and Google
// ranks neither. Found on 2026-09-02: /rugs/ was titled "Luxury Glam Rugs" and
// fighting /luxury-glam/rugs/ for the same phrase, 236 impressions and zero
// clicks between them, and the first full run turned up 41 such queries. It is
// invisible in the HTML, so only Search Console can see it.
//
// Gated behind --seo because it needs the network and credentials, and the
// offline run has to stay fast. scripts/seo-cannibalisation.js prints the full
// per-query breakdown; this is the alarm, that is the diagnosis.
check('seo-self-competition', WARNING, 'SEO',
  'queries where more than one of our pages competes (needs --seo)',
  async () => {
    // site-health does not load .env globally (the offline run needs nothing),
    // so pull it in here before reading the credentials.
    try { await import('dotenv/config'); } catch { /* dotenv optional */ }
    const site = process.env.GSC_SITE_URL;
    const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!site || !keyPath) return ['CHECK SKIPPED: GSC_SITE_URL or GOOGLE_SERVICE_ACCOUNT_JSON not set in .env'];

    const { JWT } = await import('google-auth-library');
    const { createRequire } = await import('node:module');
    const key = createRequire(import.meta.url)(keyPath);
    const client = new JWT({
      email: key.client_email, key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
    const res = await client.request({
      url: endpoint, method: 'POST',
      data: { startDate: day(28), endDate: day(1), dimensions: ['query', 'page'], rowLimit: 5000 },
    });

    const byQuery = new Map();
    for (const r of res.data.rows || []) {
      const [q, p] = r.keys;
      if (!byQuery.has(q)) byQuery.set(q, []);
      byQuery.get(q).push({ page: p.replace('https://wowglamdecor.com', '') || '/', impressions: r.impressions, position: r.position });
    }
    const out = [];
    for (const [q, pages] of byQuery) {
      if (pages.length < 2) continue;
      const impressions = pages.reduce((s, x) => s + x.impressions, 0);
      if (impressions < 3) continue;   // ignore the long tail of one-off pairs
      pages.sort((a, b) => a.position - b.position);
      const best = pages[0], worst = pages[pages.length - 1];
      out.push(`${impressions} impr  "${q}"  ${pages.length} pages, best ${best.page} at ${best.position.toFixed(1)}, worst ${worst.page} at ${worst.position.toFixed(1)}`);
    }
    return out.sort((a, b) => parseInt(b) - parseInt(a));
  }, { seo: true });

// -- Tracking ---------------------------------------------------------------
const TAGS = [
  ['ga4', 'googletagmanager.com/gtag', 'GA4'],
  ['ahrefs', 'analytics.ahrefs.com/analytics.js', 'Ahrefs Web Analytics'],
  ['impact', 'impact-site-verification', 'Impact verification'],
];
for (const [id, needle, label] of TAGS) {
  check(`tracking-${id}`, WARNING, 'Tracking', `pages missing the ${label} tag in <head>`,
    () => indexable.filter(p => !p.head.includes(needle)).map(p => p.url));
}

// -- Copy rules (house style) ----------------------------------------------
check('copy-em-dash', ERROR, 'Copy', 'em dash in rendered copy (banned)',
  () => indexable.filter(p => /—/.test(visibleText(p.html))).map(p => p.url));

// CLAUDE.md allows an en dash as a numeric range separator ($69-$129, 5-10
// inches) and bans it as a prose connector. A range can carry a unit on
// either side (2700K-3000K, 24-48 hours, $175-$320), so testing only the two
// characters touching the dash flagged 52 legitimate ranges. Test the token
// instead: a range has a number on the left (unit suffix allowed) and a
// number, optionally prefixed by a currency symbol, on the right.
const RANGE_LEFT  = /\d[A-Za-z"'%]{0,3}\s*$/;
const RANGE_RIGHT = /^\s*[$£€]?\d/;
check('copy-en-dash-prose', WARNING, 'Copy', 'en dash outside a numeric range',
  () => indexable.flatMap(p => {
    const t = visibleText(p.html);
    const bad = [];
    for (const m of t.matchAll(/–/g)) {
      const left  = t.slice(Math.max(0, m.index - 12), m.index);
      const right = t.slice(m.index + 1, m.index + 13);
      if (RANGE_LEFT.test(left) && RANGE_RIGHT.test(right)) continue;
      bad.push(`${left.trim()}–${right.trim()}`);
    }
    return bad.length ? [`${p.url}  "${bad[0]}"`] : [];
  }));

check('copy-banned-word', ERROR, 'Copy', 'AI-marker word in rendered copy',
  () => indexable.flatMap(p => {
    const t = visibleText(p.html);
    const hit = BANNED_WORDS.filter(w => new RegExp('\\b' + w, 'i').test(t));
    return hit.length ? [`${p.url}  ${hit.join(', ')}`] : [];
  }));

check('copy-placeholder', ERROR, 'Copy', 'placeholder or template text in rendered copy',
  () => indexable.flatMap(p => {
    const t = visibleText(p.html);
    const hit = PLACEHOLDERS.filter(w => t.toLowerCase().includes(w.toLowerCase()));
    return hit.length ? [`${p.url}  ${hit.join(', ')}`] : [];
  }));

check('copy-pooled-phrase', ERROR, 'Copy', 'pooled caption phrase on the site (TODO 82 regression)',
  () => indexable.flatMap(p => {
    const t = visibleText(p.html);
    const hit = POOLED_PHRASES.filter(w => t.includes(w));
    return hit.length ? [`${p.url}  ${hit.join(', ')}`] : [];
  }));

check('source-not-utf8', ERROR, 'Copy', 'content source files that are not UTF-8', () => {
  const bad = [];
  const md = [];
  (function collect(d) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) collect(f);
      else if (e.name.endsWith('.md')) md.push(f);
    }
  })(path.join(ROOT, 'content'));
  for (const f of md) {
    const buf = fs.readFileSync(f);
    try { new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { bad.push(path.relative(ROOT, f)); }
  }
  return bad;
});

// A meta description cut off mid-thought reads as broken in the SERP. The 2026-10-01
// audit found 9 of them, all ending on a word like "and" or "for" with no full stop,
// left over from trimming to a length limit. Flag a description that ends on a joining
// word without closing punctuation, or that ends in an ellipsis.
const DANGLING = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'for', 'with', 'in',
  'on', 'at', 'by', 'from', 'your', 'our', 'its', 'their', 'that', 'this', 'into', 'as', 'than']);
check('desc-dangling', ERROR, 'Metadata', 'meta description cut off mid-sentence',
  () => indexable.filter(p => {
    const d = p.desc.trim();
    if (!d) return false;
    if (/(\.\.\.|\u2026)$/.test(d)) return true;
    if (/[.!?)"'\u201d\u2019]$/.test(d)) return false;
    return DANGLING.has(d.split(/\s+/).pop().toLowerCase());
  }).map(p => `${p.url}  "...${p.desc.slice(-50)}"`));

// House price format is a range, $129–$229. The same audit found 60 prices written
// "$129, $229" across 6 posts, which reads as two separate prices.
check('copy-price-comma-pair', ERROR, 'Copy', 'price range written with a comma ($A, $B)',
  () => indexable.flatMap(p => {
    const m = visibleText(p.html).match(/\$\d[\d,.]*\d?\s*,\s*\$\d[\d,.]*/);
    return m ? [`${p.url}  "${m[0]}"`] : [];
  }));

// ── Live checks (network) ───────────────────────────────────────────────────
const BROWSER_ACCEPT = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';
const CRAWLER_ACCEPT = '*/*';

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

const allImages = [...new Set(pages.flatMap(p => p.imgs.map(imgURL).filter(Boolean)))];

check('img-broken-live', ERROR, 'Images', 'referenced images that do not resolve',
  async () => {
    const res = await mapLimit(allImages, 12, async u => {
      try { const r = await fetch(u, { method: 'HEAD' }); return r.status === 200 ? null : `${r.status}  ${u}`; }
      catch { return `ERR   ${u}`; }
    });
    return res.filter(Boolean);
  }, { live: true });

// These two used to measure `allImages.slice(0, 80)`, so every count they ever
// reported was out of an 80-image sample of the 1,110 images the site
// references, and read as a site-wide total. The images worker returns the
// negotiated Content-Length on a HEAD, so the whole set can be measured without
// downloading a single body. Never reintroduce a slice here: a sampled number
// presented as a total is worse than no number.
const weighAll = async (accept) => {
  const res = await mapLimit(allImages, 8, async u => {
    try {
      const r = await fetch(u, { method: 'HEAD', headers: { Accept: accept } });
      const len = Number(r.headers.get('content-length'));
      if (!Number.isFinite(len) || len <= 0) return null;
      const kb = Math.round(len / 1024);
      return kb > IMAGE_MAX_KB ? { kb, u } : null;
    } catch { return null; }
  });
  return res.filter(Boolean).sort((a, b) => b.kb - a.kb).map(x => `${x.kb} KB  ${x.u}`);
};

check('img-too-large-crawler', WARNING, 'Images',
  `images over ${IMAGE_MAX_KB} KB for a client that does not accept WebP`,
  () => weighAll(CRAWLER_ACCEPT), { live: true });

check('img-too-large-browser', WARNING, 'Images',
  `images over ${IMAGE_MAX_KB} KB for a real browser`,
  () => weighAll(BROWSER_ACCEPT), { live: true });

check('host-canonical', ERROR, 'Infrastructure', 'www does not 301 to the apex',
  async () => {
    const bad = [];
    for (const p of ['/', '/rugs/']) {
      try {
        const r = await fetch('https://www.wowglamdecor.com' + p, { redirect: 'manual' });
        const loc = r.headers.get('location') || '';
        if (r.status !== 301 || !loc.startsWith(SITE)) bad.push(`www${p} -> ${r.status} ${loc}`);
      } catch (e) { bad.push(`www${p} -> ${e.message.slice(0, 30)}`); }
    }
    return bad;
  }, { live: true });

check('security-headers', WARNING, 'Infrastructure', 'security headers missing from the live site',
  async () => {
    const want = ['strict-transport-security', 'x-frame-options', 'x-content-type-options',
      'referrer-policy', 'permissions-policy', 'content-security-policy'];
    try {
      const r = await fetch(SITE + '/');
      return want.filter(h => !r.headers.get(h));
    } catch (e) { return ['could not fetch: ' + e.message.slice(0, 40)]; }
  }, { live: true });

check('key-files', ERROR, 'Infrastructure', 'key files not reachable',
  async () => {
    const bad = [];
    for (const f of ['/robots.txt', '/sitemap.xml', '/llms.txt', '/logo.jpg']) {
      try { const r = await fetch(SITE + f); if (r.status !== 200) bad.push(`${r.status}  ${f}`); }
      catch { bad.push('ERR   ' + f); }
    }
    return bad;
  }, { live: true });

// src/taxonomy.generated.js is the only copy of the category vocabulary outside
// data/taxonomy.yaml, and it exists solely because a Cloudflare Worker cannot
// read the YAML at request time. If the two drift, seasonal stock demotes in the
// shop but not in the API, or the reverse, and neither is visible from a page.
check('taxonomy-generated-stale', ERROR, 'Infrastructure',
  'src/taxonomy.generated.js does not match data/taxonomy.yaml',
  () => {
    const r = spawnSync(process.execPath,
      [path.join(ROOT, 'scripts', 'gen-taxonomy-module.js'), '--check'], { encoding: 'utf8' });
    return r.status === 0 ? [] : ['run: node scripts/gen-taxonomy-module.js'];
  });

check('social-image-live', WARNING, 'Social', 'og:image that does not resolve',
  async () => {
    const imgs = [...new Set(indexable
      .map(p => attr(p.head, /<meta property="og:image" content="([^"]*)"/))
      .filter(Boolean))];
    const res = await mapLimit(imgs, 10, async u => {
      try { const r = await fetch(u, { method: 'HEAD' }); return r.status === 200 ? null : `${r.status}  ${u}`; }
      catch { return `ERR   ${u}`; }
    });
    return res.filter(Boolean);
  }, { live: true });

// Blog heroes only reach a post's own HTML as og:image (a WARNING above), and the
// homepage and search draw them from posts.json in JS, so 18 heroes that 404'd in the
// 2026-10-01 audit raised no error. Check every post's resolved featured_image.
check('post-hero-broken-live', ERROR, 'Images', 'blog featured_image missing or not resolving',
  async () => {
    const file = path.join(PUBLIC, 'posts.json');
    if (!fs.existsSync(file)) return ['public/posts.json not built'];
    const posts = JSON.parse(fs.readFileSync(file, 'utf8'));
    const res = await mapLimit(posts, 10, async p => {
      if (!p.featured_image) return `EMPTY ${p.url}`;
      const u = new URL(p.featured_image, SITE).href;
      try { const r = await fetch(u, { method: 'HEAD' }); return r.status === 200 ? null : `${r.status}  ${p.url}  ${u}`; }
      catch { return `ERR   ${p.url}  ${u}`; }
    });
    return res.filter(Boolean);
  }, { live: true });

// `npm run sync` overwrites data/products.json from D1, so a catalog edit made only in
// the JSON is silently undone on the next sync. BG-36/37 lost 367 hooks, 54
// descriptions and 111 galleries that way (TODO 127). Compare the copy fields against
// the live API. The API serves a 1-hour KV cache, so a D1 write shows as drift for up
// to an hour; drift that survives longer means the JSON was edited without D1.
const DRIFT_FIELDS = ['name', 'description', 'hook', 'bullets', 'our_pick', 'images'];
check('catalog-d1-drift', ERROR, 'Infrastructure', 'data/products.json differs from D1 (live API)',
  async () => {
    const local = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'products.json'), 'utf8'));
    const r = await fetch(`${SITE}/api/products?limit=500`);
    if (!r.ok) return [`API ${r.status}`];
    const j = await r.json();
    const api = Array.isArray(j) ? j : (j.products || j.data || []);
    const bySlug = new Map(api.map(p => [p.slug, p]));
    const norm = v => v == null ? '' : (typeof v === 'string' ? v : JSON.stringify(v));
    const out = [];
    for (const p of local) {
      const o = bySlug.get(p.slug);
      if (!o) { out.push(`${p.slug}  not in D1`); continue; }
      const diff = DRIFT_FIELDS.filter(k => norm(p[k]) !== norm(o[k]));
      if (diff.length) out.push(`${p.slug}  ${diff.join(', ')}`);
    }
    if (api.length !== local.length) out.push(`count: JSON ${local.length}, D1 ${api.length}`);
    return out;
  }, { live: true });

// ── Run ─────────────────────────────────────────────────────────────────────
const results = [];
for (const c of CHECKS) {
  if (c.live && !LIVE) { results.push({ ...c, skipped: true, offenders: [] }); continue; }
  if (c.seo && !SEO) { results.push({ ...c, skipped: true, offenders: [] }); continue; }
  let offenders = [];
  try { offenders = (await c.run()) || []; }
  catch (e) { offenders = ['CHECK FAILED: ' + e.message.slice(0, 80)]; }
  results.push({ ...c, offenders });
}

const bySeverity = s => results.filter(r => r.severity === s && r.offenders.length);
const counts = {
  error: bySeverity(ERROR).reduce((a, r) => a + r.offenders.length, 0),
  warning: bySeverity(WARNING).reduce((a, r) => a + r.offenders.length, 0),
  notice: bySeverity(NOTICE).reduce((a, r) => a + r.offenders.length, 0),
};

if (JSON_OUT) {
  console.log(JSON.stringify({
    generated: new Date().toISOString(),
    live: LIVE,
    pages: { built: pages.length, indexable: indexable.length, noindex: pages.length - indexable.length, aliases },
    counts,
    checks: results.map(r => ({
      id: r.id, severity: r.severity, category: r.category, label: r.label,
      skipped: !!r.skipped, count: r.offenders.length,
      offenders: VERBOSE ? r.offenders : r.offenders.slice(0, 5),
    })),
  }, null, 2));
} else {
  const BAR = '─'.repeat(72);
  console.log(`\nWOWGLAMDECOR SITE HEALTH   ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  console.log(`${LIVE ? 'build + live' : 'build only (add --live for network checks)'}`);
  console.log(BAR);
  console.log(`pages built ${pages.length}   indexable ${indexable.length}   noindex ${pages.length - indexable.length}   alias stubs ${aliases}`);
  if (sitemapURLs) console.log(`sitemap URLs ${sitemapURLs.length}   images referenced ${allImages.length}`);

  for (const sev of [ERROR, WARNING, NOTICE]) {
    const rows = results.filter(r => r.severity === sev);
    const hits = rows.filter(r => r.offenders.length);
    console.log(`\n${sev.toUpperCase()}S   ${hits.length} of ${rows.length} checks with findings`);
    if (!hits.length) { console.log('   all clear'); continue; }
    for (const r of hits.sort((a, b) => b.offenders.length - a.offenders.length)) {
      console.log(`   ${String(r.offenders.length).padStart(5)}  ${r.label}   [${r.id}]`);
      const show = VERBOSE ? r.offenders : r.offenders.slice(0, 3);
      show.forEach(o => console.log(`          ${String(o).slice(0, 110)}`));
      if (!VERBOSE && r.offenders.length > show.length) {
        console.log(`          ... ${r.offenders.length - show.length} more (--verbose to list)`);
      }
    }
  }

  const skipped = results.filter(r => r.skipped);
  if (skipped.length) console.log(`\nskipped ${skipped.length} live checks (run with --live)`);
  console.log(`\n${BAR}\nSUMMARY  ${counts.error} errors, ${counts.warning} warnings, ${counts.notice} notices\n`);
}

const order = { error: [ERROR], warning: [ERROR, WARNING], notice: [ERROR, WARNING, NOTICE] };
const failOn = order[FAIL_ON] || order.error;
process.exit(failOn.some(s => counts[s] > 0) ? 1 : 0);
