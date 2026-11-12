import { analyzeAccessibility } from "../analysis.ts";

let passed = 0;
let failed = 0;

function assert(label, html, ruleId, expectViolation) {
  const result = analyzeAccessibility(html, "https://example.com");
  const got = result.violations.some((v) => v.ruleId === ruleId);
  if (got === expectViolation) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.log(`  \u2717 ${label} — expected ${expectViolation ? "violation" : "pass"}, got ${got ? "violation" : "pass"}`);
    console.log(`      all violations: ${result.violations.map((v) => v.ruleId).join(", ") || "(none)"}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n\u2550\u2550 ${title} \u2550\u2550\n`);
}

const page = (body, head = "<title>Test page</title>") =>
  `<!DOCTYPE html><html lang="en"><head>${head}</head><body>${body}</body></html>`;

section("Missing Form Labels");

assert("Text input with no label", page('<form><input type="text"></form>'), "label", true);
assert("Email input with only a placeholder", page('<input type="email" placeholder="Email">'), "label", true);
assert("Textarea with no label", page("<textarea></textarea>"), "label", true);
assert("Select with no label", page("<select><option>A</option></select>"), "select-missing-label", true);
assert("Labelled by for/id", page('<label for="e">Email</label><input id="e" type="email">'), "label", false);
assert("Input with title only is not a missing label", page('<input type="text" title="Email">'), "label", false);
assert("Input with title only reports title-only label", page('<input type="text" title="Email">'), "label-title", true);
assert("Submit button needs no label", page('<input type="submit" value="Go">'), "label", false);

section("Empty Labels");

assert("Empty label element", page('<label for="e"></label><input id="e" type="email">'), "label-empty", true);
assert("Label with visible text is not empty", page('<label for="e">Email</label><input id="e" type="email">'), "label-empty", false);

section("Missing Alt Text");

assert("Image with no alt attribute", page('<img src="a.jpg">'), "image-alt", true);
assert("Image with title but no alt attribute", page('<img src="a.jpg" title="Team photo">'), "image-alt", true);
assert("Image with aria-label but no alt attribute", page('<img src="a.jpg" aria-label="Team photo">'), "image-alt", true);
assert("Image with alt text passes", page('<img src="a.jpg" alt="Team photo">'), "image-alt", false);
assert("Decorative image with empty alt passes", page('<img src="a.jpg" alt="">'), "image-alt", false);
assert("Linked image with no alt attribute", page('<a href="/x"><img src="a.jpg"></a>'), "image-alt-empty-link", true);
assert("Image input with no alt", page('<input type="image" src="go.png">'), "input-image-alt", true);

section("Hidden Images Still Evaluated");

assert("display:none image with no alt", page('<img src="a.jpg" style="display:none">'), "image-alt", true);
assert("aria-hidden image with no alt", page('<img src="a.jpg" aria-hidden="true">'), "image-alt", true);
assert("hidden-attribute image with no alt", page('<div hidden><img src="a.jpg"></div>'), "image-alt", true);
assert("tabindex=-1 image with no alt", page('<img src="a.jpg" tabindex="-1">'), "image-alt", true);
assert("aria-hidden image input with no alt", page('<input type="image" src="go.png" aria-hidden="true">'), "input-image-alt", true);

section("Page Title Detection");

assert("Page with a title", page("<p>x</p>", "<title>Services</title>"), "document-title", false);
assert("Page with no title element", page("<p>x</p>", ""), "document-title", true);
assert("Page with empty title element", page("<p>x</p>", "<title>   </title>"), "document-title", true);

section("Iframe Titles");

assert("Iframe with no title", page('<iframe src="https://maps.example.com"></iframe>'), "frame-title", true);
assert("Iframe with empty title", page('<iframe src="https://maps.example.com" title="  "></iframe>'), "frame-title", true);
assert("Iframe with title passes", page('<iframe src="https://maps.example.com" title="Office map"></iframe>'), "frame-title", false);
assert("Iframe with valid aria-labelledby passes", page('<span id="fdesc">Embedded map</span><iframe src="https://maps.example.com" aria-labelledby="fdesc"></iframe>'), "frame-title", false);
assert("Iframe with broken aria-labelledby is flagged", page('<iframe src="https://maps.example.com" aria-labelledby="nope"></iframe>'), "frame-title", true);

section("HTML Language");

assert("html without lang", page("<p>x</p>", "<title>T</title>").replace('<html lang="en">', "<html>"), "html-lang-valid", true);
assert("html with valid lang passes", page("<p>x</p>"), "html-lang-valid", false);
assert("html with invalid lang (digits only)", page("<p>x</p>", "<title>T</title>").replace('lang="en"', 'lang="123"'), "html-lang-valid", true);

console.log(`\n\u2550\u2550 Summary: ${passed}/${passed + failed} passed \u2550\u2550\n`);
if (failed > 0) {
  console.log(`${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("All tests passed!\n");
}
