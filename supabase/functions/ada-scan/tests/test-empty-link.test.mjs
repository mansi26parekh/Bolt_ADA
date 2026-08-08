// Regression tests for the Empty Link (link-name / WAVE link_empty) rule.
//
// These tests run in plain Node using `linkedom` as the DOM parser — the
// same library the edge function imports. The analysis module is loaded via
// a custom resolver that strips the "npm:" prefix so Node can resolve it.
//
// Run:  node --import ./supabase/functions/ada-scan/npm-resolver.js \
//         supabase/functions/ada-scan/tests/test-empty-link.test.mjs

import { parseHTML } from "linkedom";
import {
  analyzeAccessibility,
  calculatePageScore,
} from "../analysis.ts";

// ── Helpers ──────────────────────────────────────────────────────────

function runAnalysis(html) {
  const { document } = parseHTML(html);
  return analyzeAccessibility(html, "https://example.com/page");
}

function findLinkViolations(violations) {
  return violations.filter((v) => v.ruleId === "link-name");
}

function findImageAltViolations(violations) {
  return violations.filter(
    (v) =>
      v.ruleId === "image-alt" ||
      v.ruleId === "image-alt-empty" ||
      v.ruleId === "image-alt-empty-link"
  );
}

function test(name, html, shouldFlagEmptyLink) {
  const result = runAnalysis(html);
  const linkVios = findLinkViolations(result.violations);

  const flagged = linkVios.length > 0;
  const passed = shouldFlagEmptyLink ? flagged : !flagged;

  if (passed) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}`);
    console.log(`    Expected: ${shouldFlagEmptyLink ? "EMPTY LINK" : "PASS"}`);
    console.log(`    Got: ${flagged ? "EMPTY LINK" : "PASS"} (${linkVios.length} violations)`);
    if (linkVios.length > 0) {
      console.log(`    Element: ${linkVios[0].element?.substring(0, 80)}`);
    }
  }
  return passed;
}

function testLinkedImageRule(name, html, expectLinkName, expectImageAltEmptyLink) {
  const result = runAnalysis(html);
  const linkVios = findLinkViolations(result.violations);
  const imgLinkVios = result.violations.filter((v) => v.ruleId === "image-alt-empty-link");
  const ok =
    linkVios.length === expectLinkName &&
    imgLinkVios.length === expectImageAltEmptyLink;
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}`);
    console.log(`    Expected: ${expectLinkName} link-name + ${expectImageAltEmptyLink} image-alt-empty-link`);
    console.log(`    Got: ${linkVios.length} link-name + ${imgLinkVios.length} image-alt-empty-link`);
    result.violations.forEach((v) => console.log(`      - ${v.ruleId}: ${v.element?.substring(0, 60)}`));
  }
  return ok;
}

// ── Test suites ──────────────────────────────────────────────────────

let total = 0;
let passed = 0;

console.log("\n══ Empty Link Rule — Core WAVE Parity Tests ══\n");

// --- Basic text content ---
console.log("Text content:");

total++; passed += test("Link with text", '<a href="/about">About Us</a>', false);
total++; passed += test("Empty link (no content)", '<a href="/about"></a>', true);
total++; passed += test("Whitespace-only link", '<a href="/about"> </a>', true);
total++; passed += test("Link with nested span text", '<a href="/about"><span>About</span></a>', false);
total++; passed += test("Link with tab/newline whitespace", '<a href="/about">\t\n  \t</a>', true);

// --- Image alt as link name ---
console.log("\nImage alt:");
total++; passed += test("Link with img alt", '<a href="/about"><img alt="About"></a>', false);
// Image-only links with missing/empty alt: NOT Empty Link — image-alt-empty-link handles them
total++; passed += test("Link with img empty alt (NOT empty link)", '<a href="/about"><img alt=""></a>', false);
total++; passed += test("Link with img no alt (NOT empty link)", '<a href="/about"><img></a>', false);

// --- aria-label ---
console.log("\naria-label:");
total++; passed += test("aria-label with text", '<a href="/about" aria-label="About"></a>', false);
total++; passed += test("aria-label whitespace only", '<a href="/about" aria-label=" "></a>', true);
total++; passed += test("aria-label empty string", '<a href="/about" aria-label=""></a>', true);

// --- aria-labelledby ---
console.log("\naria-labelledby:");
total++; passed += test(
  "aria-labelledby resolves to label text",
  '<span id="label">About Section</span><a href="/about" aria-labelledby="label"></a>',
  false
);
total++; passed += test(
  "aria-labelledby references missing ID",
  '<a href="/about" aria-labelledby="missing"></a>',
  true
);

// --- title attribute (WAVE-style fallback) ---
console.log("\ntitle attribute:");
total++; passed += test("title with text", '<a href="/about" title="About"></a>', false);
total++; passed += test("title empty string", '<a href="/about" title=""></a>', true);

// --- SVG content ---
console.log("\nSVG:");
total++; passed += test(
  "SVG with aria-hidden",
  '<a href="/about"><svg aria-hidden="true"></svg></a>',
  true
);
total++; passed += test(
  "SVG with aria-label",
  '<a href="/about"><svg aria-label="Home icon"></svg></a>',
  false
);
total++; passed += test(
  "SVG with <title> child",
  '<a href="/about"><svg><title>Home</title></svg></a>',
  false
);

// --- Visually hidden text ---
console.log("\nVisually hidden text:");
total++; passed += test(
  "sr-only span with text",
  '<a href="/about"><span class="sr-only">About</span></a>',
  false
);

// --- "Read more" / "Click here" are NOT empty ---
console.log("\nNamed links:");
total++; passed += test("Read more link", '<a href="/about">Read more</a>', false);
total++; passed += test("Click here link", '<a href="/about">Click here</a>', false);

// --- aria-hidden link should be ignored entirely ---
console.log("\naria-hidden link:");
total++; passed += test(
  "aria-hidden link with no name (should pass — skipped)",
  '<a href="/about" aria-hidden="true"></a>',
  false
);

// ── WordPress-style DOM tests ────────────────────────────────────────

console.log("\n══ WordPress-style Rendered DOM ══\n");

total++; passed += test(
  "WP nav menu empty link",
  '<nav class="wp-block-navigation"><ul><li><a href="https://example.com/home"></a></li></ul></nav>',
  true
);
total++; passed += test(
  "WP nav menu with text",
  '<nav class="wp-block-navigation"><ul><li><a href="https://example.com/home">Home</a></li></ul></nav>',
  false
);
total++; passed += test(
  "WP post thumbnail link with alt",
  '<a href="https://example.com/post"><img src="thumb.jpg" alt="Post title" class="wp-post-image"></a>',
  false
);
total++; passed += test(
  "WP post thumbnail link with empty alt (NOT empty link — image-alt-empty-link instead)",
  '<a href="https://example.com/post"><img src="thumb.jpg" alt="" class="wp-post-image"></a>',
  false
);

// ── Shopify-style DOM tests ──────────────────────────────────────────

console.log("\n══ Shopify-style Rendered DOM ══\n");

total++; passed += test(
  "Shopify product card: img with empty alt (NOT empty link — image-alt-empty-link instead)",
  `<div class="card">
    <div class="card__inner">
      <a href="/products/test" class="full-card-link">
        <img src="product.jpg" alt="" loading="lazy" width="400" height="400">
      </a>
    </div>
    <div class="card__content">
      <p class="card__heading">Test Product</p>
    </div>
  </div>`,
  false
);
total++; passed += test(
  "Shopify product card: img with alt",
  `<div class="card">
    <a href="/products/test" class="full-card-link">
      <img src="product.jpg" alt="Test Product" loading="lazy">
    </a>
  </div>`,
  false
);
total++; passed += test(
  "Shopify cart icon link with SVG aria-hidden (should be empty)",
  `<a href="/cart" class="header__icon header__icon--cart link focus-inset">
    <svg class="icon icon-cart" aria-hidden="true" focusable="false">
      <use href="#icon-cart"></use>
    </svg>
    <span class="visually-hidden">Cart</span>
  </a>`,
  false
);
total++; passed += test(
  "Shopify cart icon link: only SVG aria-hidden, no text",
  `<a href="/cart" class="header__icon header__icon--cart">
    <svg class="icon icon-cart" aria-hidden="true" focusable="false">
      <use href="#icon-cart"></use>
    </svg>
  </a>`,
  true
);
total++; passed += test(
  "Shopify mobile menu link with text",
  `<a href="#mobile-menu" class="mobile-menu__toggle">
    <span>Menu</span>
  </a>`,
  false
);

// ── Dynamic / framework-agnostic tests ───────────────────────────────

console.log("\n══ Dynamic / Framework-Agnostic DOM ══\n");

total++; passed += test(
  "React-style empty link",
  '<a href="/about" data-reactroot=""></a>',
  true
);
total++; passed += test(
  "Vue-style link with :href (should not match — not a[href])",
  '<a :href="/about"></a>',
  false
);
total++; passed += test(
  "Dynamically inserted empty link",
  '<div id="app"><a href="/dynamic"></a></div>',
  true
);
total++; passed += test(
  "Link with nested div + text",
  '<a href="/about"><div class="btn-inner">Learn More</div></a>',
  false
);
total++; passed += test(
  "Link with nested empty divs (whitespace)",
  '<a href="/about"><div> </div><span> </span></a>',
  true
);
total++; passed += test(
  "Multiple links: mix of empty and valid",
  `<nav>
    <a href="/home">Home</a>
    <a href="/about"></a>
    <a href="/contact" aria-label="Contact Us"></a>
    <a href="/blog"><img alt="Blog"></a>
  </nav>`,
  true  // The /about link should be flagged
);

// ── WAVE-Parity: Linked Image Classification ────────────────────────

console.log("\n══ WAVE-Parity: Linked Image Classification ══\n");

// <a><img></a> → image-alt-empty-link, NOT empty link
total++; passed += testLinkedImageRule(
  "<a><img></a> → Linked Image Missing Alt, NOT Empty Link",
  '<a href="/something"><img src="image.jpg"></a>',
  0, 1
);
// <a><img alt=""></a> → image-alt-empty-link, NOT empty link
total++; passed += testLinkedImageRule(
  '<a><img alt=""></a> → Linked Image Missing Alt, NOT Empty Link',
  '<a href="/something"><img src="image.jpg" alt=""></a>',
  0, 1
);
// <a><img alt="Product"></a> → no violation at all
total++; passed += testLinkedImageRule(
  '<a><img alt="Product"></a> → No Empty Link, No Missing Alt',
  '<a href="/something"><img src="image.jpg" alt="Product"></a>',
  0, 0
);
// <a>Product</a> → no empty link
total++; passed += testLinkedImageRule(
  "<a>Product</a> → No Empty Link",
  '<a href="/something">Product</a>',
  0, 0
);
// <a></a> → Empty Link, NOT image-alt-empty-link
total++; passed += testLinkedImageRule(
  "<a></a> → Empty Link",
  '<a href="/something"></a>',
  1, 0
);

// ── Wrapped-image tests (images nested in wrappers) ──────────────────

console.log("\n══ Wrapped Image (Descendant, Not Direct Child) ══\n");

total++; passed += testLinkedImageRule(
  "<a><span><img></span></a> → Linked Image, NOT Empty Link",
  '<a href="/p"><span><img src="x.jpg"></span></a>',
  0, 1
);
total++; passed += testLinkedImageRule(
  '<a><div><img alt=""></div></a> → Linked Image, NOT Empty Link',
  '<a href="/p"><div class="thumb"><img src="x.jpg" alt=""></div></a>',
  0, 1
);
total++; passed += testLinkedImageRule(
  '<a><figure><img alt="Product"></figure></a> → pass (valid alt)',
  '<a href="/p"><figure><img src="x.jpg" alt="Product"></figure></a>',
  0, 0
);
total++; passed += testLinkedImageRule(
  "<a><div><span><img></span></div></a> → deeply nested, Linked Image",
  '<a href="/p"><div><span><img src="x.jpg"></span></div></a>',
  0, 1
);
total++; passed += test(
  "<a><span><img></span> text</a> → image+text = has name, PASS",
  '<a href="/p"><span><img src="x.jpg"></span> About</a>',
  false
);
total++; passed += testLinkedImageRule(
  "Shopify card wrapper: <a><div class='card__media'><img alt=''></div></a>",
  '<a href="/products/x"><div class="card__media"><img src="p.jpg" alt="" width="400"></div></a>',
  0, 1
);

// ── No double-reporting tests ────────────────────────────────────────

console.log("\n══ No Double-Reporting ══\n");

total++; passed += testLinkedImageRule(
  "Linked image missing alt: 0 link-name + 1 image-alt-empty-link",
  '<a href="/about"><img src="test.jpg"></a>',
  0, 1
);
total++; passed += testLinkedImageRule(
  "Linked image empty alt: 0 link-name + 1 image-alt-empty-link",
  '<a href="/about"><img src="test.jpg" alt=""></a>',
  0, 1
);

// ── Non-HTTP href schemes ────────────────────────────────────────────

console.log("\n══ Non-HTTP href Schemes ══\n");

total++; passed += test(
  "javascript:void(0) with no name → Empty Link",
  `<div class="grid-card">
    <a href="javascript:void(0)"
       data-fancybox=""
       data-touch="false"
       data-src="#team_modal_1_2"></a>
  </div>`,
  true
);
total++; passed += test(
  "javascript:void(0) with aria-label → PASS",
  '<a href="javascript:void(0)" aria-label="Open modal"></a>',
  false
);
total++; passed += test(
  "javascript:void(0) with text → PASS",
  '<a href="javascript:void(0)">Open</a>',
  false
);
total++; passed += test(
  "hash-only href with no name → Empty Link",
  '<a href="#"></a>',
  true
);
total++; passed += test(
  "hash-only href with text → PASS",
  '<a href="#">Back to top</a>',
  false
);
total++; passed += test(
  "fragment href with no name → Empty Link",
  '<a href="#section-1"></a>',
  true
);
total++; passed += test(
  "mailto: link with no name → Empty Link",
  '<a href="mailto:test@example.com"></a>',
  true
);
total++; passed += test(
  "mailto: link with text → PASS",
  '<a href="mailto:test@example.com">Email us</a>',
  false
);
total++; passed += test(
  "tel: link with no name → Empty Link",
  '<a href="tel:+1234567890"></a>',
  true
);
total++; passed += test(
  "tel: link with text → PASS",
  '<a href="tel:+1234567890">Call us</a>',
  false
);
total++; passed += testLinkedImageRule(
  "javascript:void(0) with linked image (no alt) → Linked Image, NOT Empty Link",
  '<a href="javascript:void(0)"><img src="photo.jpg"></a>',
  0, 1
);

// ── Edge cases ───────────────────────────────────────────────────────

console.log("\n══ Edge Cases ══\n");

total++; passed += test(
  "Link with only <br> tag",
  '<a href="/about"><br></a>',
  true
);
total++; passed += test(
  "Link with aria-hidden child + aria-label",
  '<a href="/about" aria-label="About"><span aria-hidden="true">X</span></a>',
  false
);
total++; passed += test(
  "Link with nested sr-only + visible empty",
  '<a href="/about"><span> </span><span class="sr-only">Details</span></a>',
  false
);
total++; passed += test(
  "Link with image + aria-hidden SVG (image is meaningful content)",
  '<a href="/p"><img src="x.jpg"><svg aria-hidden="true"><use href="#icon"></use></svg></a>',
  false  // image with no alt → defers to image-alt-empty-link, NOT empty link
);
total++; passed += testLinkedImageRule(
  "Link with only aria-hidden content + no images → Empty Link",
  '<a href="/p"><span aria-hidden="true">Icon</span></a>',
  1, 0
);
total++; passed += test(
  "Link with title + image with no alt → title gives the link a name",
  '<a href="/p" title="Product"><img src="x.jpg"></a>',
  false
);

// ── Summary ──────────────────────────────────────────────────────────

console.log(`\n══ Summary: ${passed}/${total} passed ══\n`);
if (passed === total) {
  console.log("All tests passed!\n");
  process.exit(0);
} else {
  console.log(`${total - passed} test(s) FAILED.\n`);
  process.exit(1);
}
