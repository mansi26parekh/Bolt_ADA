import { analyzeAccessibility } from "../analysis.ts";

let passed = 0;
let failed = 0;

function assert(label, html, expectViolation, expectedRuleId = "label-empty") {
  const result = analyzeAccessibility(html, "https://example.com");
  const matches = result.violations.filter((v) => v.ruleId === expectedRuleId);
  const got = matches.length > 0;
  if (got === expectViolation) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.log(
      `  \u2717 ${label} — expected ${expectViolation ? "violation" : "pass"}, got ${got ? "violation" : "pass"}`
    );
    matches.forEach((v) => console.log(`      -> ${v.ruleId}: ${v.element}`));
    if (!got) {
      const all = result.violations.map((v) => v.ruleId).join(", ");
      console.log(`      all violations: ${all || "(none)"}`);
    }
    failed++;
  }
}

function section(title) {
  console.log(`\n\u2550\u2550 ${title} \u2550\u2550\n`);
}

const page = (body) =>
  `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>${body}</body></html>`;

// ── Core empty label cases ──
section("Core Empty Label");

assert(
  "Truly empty <label>",
  page('<label for="x"></label><input id="x" type="text">'),
  true
);

assert(
  "Whitespace-only <label>",
  page('<label for="x">   </label><input id="x" type="text">'),
  true
);

assert(
  "Label with only a space character",
  page('<label for="x"> </label><input id="x" type="text">'),
  true
);

assert(
  "Label with <br> only",
  page('<label for="x"><br></label><input id="x" type="text">'),
  true
);

// ── Labels with visible text ──
section("Labels with Visible Text");

assert(
  "Label with text content",
  page('<label for="x">Email</label><input id="x" type="text">'),
  false
);

assert(
  "Label with nested span text",
  page('<label for="x"><span>Email</span></label><input id="x" type="text">'),
  false
);

assert(
  "sr-only label with text",
  page(
    '<label class="sr-only" for="x">Email</label><input id="x" type="text">'
  ),
  false
);

// ── aria-label on <label> ──
section("aria-label on <label>");

assert(
  "Empty label with aria-label (WAVE parity: NOT empty)",
  page(
    '<label class="sr-only" for="x" aria-label="email"> </label><input id="x" type="text">'
  ),
  false
);

assert(
  "Empty label with non-empty aria-label",
  page(
    '<label for="x" aria-label="Your email address"></label><input id="x" type="text">'
  ),
  false
);

assert(
  "Empty label with whitespace-only aria-label (still empty)",
  page(
    '<label for="x" aria-label="   "></label><input id="x" type="text">'
  ),
  true
);

assert(
  "Empty label with empty aria-label string (still empty)",
  page('<label for="x" aria-label=""></label><input id="x" type="text">'),
  true
);

// ── aria-labelledby on <label> ──
section("aria-labelledby on <label>");

assert(
  "Empty label with aria-labelledby pointing to valid text",
  page(
    '<span id="lbl">Email</span><label for="x" aria-labelledby="lbl"></label><input id="x" type="text">'
  ),
  false
);

assert(
  "Empty label with aria-labelledby pointing to missing ID (still empty)",
  page(
    '<label for="x" aria-labelledby="nonexistent"></label><input id="x" type="text">'
  ),
  true
);

assert(
  "Empty label with aria-labelledby pointing to empty element (still empty)",
  page(
    '<span id="lbl"></span><label for="x" aria-labelledby="lbl"></label><input id="x" type="text">'
  ),
  true
);

assert(
  "Empty label with aria-labelledby to multiple IDs",
  page(
    '<span id="a">First</span><span id="b">Name</span><label for="x" aria-labelledby="a b"></label><input id="x" type="text">'
  ),
  false
);

// ── title attribute on <label> ──
section("title attribute on <label>");

assert(
  "Empty label with title attribute",
  page(
    '<label for="x" title="Email address"></label><input id="x" type="text">'
  ),
  false
);

assert(
  "Empty label with empty title (still empty)",
  page('<label for="x" title=""></label><input id="x" type="text">'),
  true
);

// ── Image inside label ──
section("Image inside <label>");

assert(
  "Label with img that has alt text",
  page(
    '<label for="x"><img src="icon.png" alt="Email"></label><input id="x" type="text">'
  ),
  false
);

assert(
  "Label with img that has empty alt (still empty)",
  page(
    '<label for="x"><img src="icon.png" alt=""></label><input id="x" type="text">'
  ),
  true
);

assert(
  "Label with img that has no alt attribute (still empty)",
  page(
    '<label for="x"><img src="icon.png"></label><input id="x" type="text">'
  ),
  true
);

// ── Exact WAVE test case from the user ──
section("WAVE Parity: Exact User Case");

assert(
  '<label class="sr-only" for="inputEmail" aria-label="email"> </label> → NOT empty',
  page(
    '<label class="sr-only" for="inputEmail" aria-label="email"> </label><input id="inputEmail" type="email">'
  ),
  false
);

// ── No false negatives: truly empty labels must still be caught ──
section("Still Catches Truly Empty Labels");

assert(
  "Bare <label> no attributes",
  page("<label></label>"),
  true
);

assert(
  "Label for nonexistent input",
  page('<label for="missing"></label>'),
  true
);

assert(
  "Multiple labels: one empty, one valid",
  page(
    '<label for="a">Name</label><label for="b"></label><input id="a" type="text"><input id="b" type="text">'
  ),
  true
);

// ══ Summary ══
console.log(`\n\u2550\u2550 Summary: ${passed}/${passed + failed} passed \u2550\u2550\n`);
if (failed > 0) {
  console.log(`${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("All tests passed!\n");
}
