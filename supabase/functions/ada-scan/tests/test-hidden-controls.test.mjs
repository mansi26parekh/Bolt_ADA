import { analyzeAccessibility } from "../analysis.ts";

let passed = 0;
let failed = 0;

function assert(label, html, ruleId, expectViolation) {
  const result = analyzeAccessibility(html, "https://example.com");
  const matches = result.violations.filter((v) => v.ruleId === ruleId);
  const got = matches.length > 0;
  if (got === expectViolation) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.log(
      `  \u2717 ${label} — expected ${expectViolation ? "violation" : "pass"}, got ${got ? "violation" : "pass"}`
    );
    if (got) matches.forEach((v) => console.log(`      -> ${v.ruleId}: ${v.element.substring(0, 100)}`));
    failed++;
  }
}

function section(title) {
  console.log(`\n\u2550\u2550 ${title} \u2550\u2550\n`);
}

const page = (body) =>
  `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><form>${body}</form></body></html>`;

// ── Hidden controls should NOT trigger "label" ──
section("Hidden Controls — Must Skip (WAVE parity)");

assert(
  "display:none inline (reCAPTCHA textarea)",
  page('<textarea id="g-recaptcha-response" name="g-recaptcha-response" style="display:none;"></textarea>'),
  "label", false
);

assert(
  "display:none with other styles (real reCAPTCHA HTML)",
  page('<textarea id="g-recaptcha-response-100000" name="g-recaptcha-response" class="g-recaptcha-response" style="width:250px;height:40px;border:1px solid rgb(193,193,193);margin:10px 25px;padding:0px;resize:none;display:none;"></textarea>'),
  "label", false
);

assert(
  "display:none on parent div",
  page('<div style="display:none"><input type="text" id="hidden-input"></div>'),
  "label", false
);

assert(
  "visibility:hidden inline",
  page('<input type="text" style="visibility:hidden">'),
  "label", false
);

assert(
  "visibility:hidden on parent",
  page('<div style="visibility: hidden;"><select><option>a</option></select></div>'),
  "label", false
);

assert(
  "HTML hidden attribute",
  page('<input type="text" hidden>'),
  "label", false
);

assert(
  "HTML hidden attribute on parent",
  page('<div hidden><textarea></textarea></div>'),
  "label", false
);

assert(
  "aria-hidden=true (existing behavior)",
  page('<input type="text" aria-hidden="true">'),
  "label", false
);

assert(
  "aria-hidden=true on ancestor",
  page('<div aria-hidden="true"><input type="email"></div>'),
  "label", false
);

assert(
  "display:none with !important",
  page('<input type="text" style="display:none !important;">'),
  "label", false
);

assert(
  "display: none (with spaces)",
  page('<input type="text" style="display : none ;">'),
  "label", false
);

assert(
  "Deeply nested hidden (grandparent display:none)",
  page('<div style="display:none"><div><div><input type="text"></div></div></div>'),
  "label", false
);

// ── Visible controls MUST still be flagged ──
section("Visible Controls — Must Still Flag");

assert(
  "Bare input (no label)",
  page('<input type="text">'),
  "label", true
);

assert(
  "Bare textarea (no label)",
  page('<textarea></textarea>'),
  "label", true
);

assert(
  "Input with class only (no label)",
  page('<input type="email" class="form-control">'),
  "label", true
);

assert(
  "Select without label",
  page('<select><option>Pick one</option></select>'),
  "select-missing-label", true
);

assert(
  "Input with id but no matching label",
  page('<input type="text" id="name">'),
  "label", true
);

// ── Properly labeled visible controls MUST NOT be flagged ──
section("Labeled Controls — Must Pass");

assert(
  "Explicit label via for=id",
  page('<label for="x">Name</label><input id="x" type="text">'),
  "label", false
);

assert(
  "aria-label on control",
  page('<input type="text" aria-label="Name">'),
  "label", false
);

assert(
  "Implicit label (control inside label)",
  page('<label>Name <input type="text"></label>'),
  "label", false
);

assert(
  "aria-labelledby",
  page('<span id="lbl">Name</span><input type="text" aria-labelledby="lbl">'),
  "label", false
);

// ── Other criteria remain unaffected by hidden controls ──
section("Other Criteria — Unaffected");

assert(
  "Visible empty link still flagged",
  page('<a href="#"></a>'),
  "link-name", true
);

assert(
  "Visible button without name still flagged",
  page('<button></button>'),
  "button-name", true
);

assert(
  "Visible img without alt still flagged",
  page('<img src="photo.jpg">'),
  "image-alt", true
);

// ── Locator presence (inspect mode support) ──
section("Locator Presence — Inspect Mode");

(function () {
  const html = page('<input type="text" id="visible-ctrl">');
  const result = analyzeAccessibility(html, "https://example.com");
  const v = result.violations.find((v) => v.ruleId === "label");
  const hasLocator = v && v.selector && v.selector.length > 0;
  if (hasLocator) {
    console.log("  \u2713 Violation for visible control has a locator for inspect highlighting");
    passed++;
  } else {
    console.log("  \u2717 Missing locator on visible control violation");
    failed++;
  }
})();

(function () {
  const html = page('<textarea style="display:none"></textarea><input type="text">');
  const result = analyzeAccessibility(html, "https://example.com");
  const labelVios = result.violations.filter((v) => v.ruleId === "label");
  const allHaveLocators = labelVios.every((v) => v.selector && v.selector.length > 0);
  const noneAreHidden = labelVios.every((v) => !v.element.includes("display:none") && !v.element.includes("display: none"));
  if (labelVios.length === 1 && allHaveLocators && noneAreHidden) {
    console.log("  \u2713 Only visible control reported; hidden textarea excluded; locator present");
    passed++;
  } else {
    console.log("  \u2717 Hidden textarea leaked into results or locator missing");
    console.log(`      violations: ${labelVios.length}, all have locators: ${allHaveLocators}, none hidden: ${noneAreHidden}`);
    failed++;
  }
})();

// ══ Summary ══
console.log(`\n\u2550\u2550 Summary: ${passed}/${passed + failed} passed \u2550\u2550\n`);
if (failed > 0) {
  console.log(`${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("All tests passed!\n");
}
