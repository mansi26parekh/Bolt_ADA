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

function testNoDoubleReport(name, html) {
  const result = runAnalysis(html);
  const linkVios = findLinkViolations(result.violations);
  const imgVios = findImageAltViolations(result.violations);
  const passed = linkVios.length === 1 && imgVios.length === 0;
  if (passed) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}`);
    console.log(`    Expected: 1 link-name + 0 image-alt violations`);
    console.log(`    Got: ${linkVios.length} link-name + ${imgVios.length} image-alt`);
  }
  return passed;
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
total++; passed += test("Link with img empty alt", '<a href="/about"><img alt=""></a>', true);
total++; passed += test("Link with img no alt", '<a href="/about"><img></a>', true);

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
  "WP post thumbnail link with empty alt",
  '<a href="https://example.com/post"><img src="thumb.jpg" alt="" class="wp-post-image"></a>',
  true
);

// ── Shopify-style DOM tests ──────────────────────────────────────────

console.log("\n══ Shopify-style Rendered DOM ══\n");

total++; passed += test(
  "Shopify product card: img with empty alt",
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
  true
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

// ── No double-reporting tests ────────────────────────────────────────

console.log("\n══ No Double-Reporting (Empty Link vs Image-Alt) ══\n");

total++; passed += testNoDoubleReport(
  "Linked image missing alt: 1 link-name, 0 image-alt",
  '<a href="/about"><img src="test.jpg"></a>'
);
total++; passed += testNoDoubleReport(
  "Linked image empty alt: 1 link-name, 0 image-alt",
  '<a href="/about"><img src="test.jpg" alt=""></a>'
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

// ── Summary ──────────────────────────────────────────────────────────

console.log(`\n══ Summary: ${passed}/${total} passed ══\n`);
if (passed === total) {
  console.log("All tests passed!\n");
  process.exit(0);
} else {
  console.log(`${total - passed} test(s) FAILED.\n`);
  process.exit(1);
}
