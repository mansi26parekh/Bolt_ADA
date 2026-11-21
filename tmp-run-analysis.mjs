import { parseHTML } from "linkedom";
import { readFileSync } from "fs";

// Inline the analysis engine adapted for Node (npm: → bare import)
// We import from a Node-compatible copy

const pages = [
  { name: "bulldogpaving.com", file: "/tmp/bulldog.html", url: "https://bulldogpaving.com" },
  { name: "chaselawmb.com/contact/", file: "/tmp/chase.html", url: "https://chaselawmb.com/contact/" },
];

// We need to load the analysis.ts but it uses npm:linkedom.
// Instead, let's create a Node-compatible wrapper.
import { analyzeAccessibility } from "./tmp-analysis-node.ts";

for (const p of pages) {
  const html = readFileSync(p.file, "utf-8");
  const { violations, passCount } = analyzeAccessibility(html, p.url);

  console.log(`\n=== ${p.name} ===`);
  console.log(`Passes: ${passCount}, Violations: ${violations.length}\n`);

  const byRule = {};
  for (const v of violations) {
    if (!byRule[v.ruleId]) byRule[v.ruleId] = [];
    byRule[v.ruleId].push(v);
  }

  for (const [ruleId, items] of Object.entries(byRule).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  [${items[0].impact}] ${ruleId} (${items.length}x) — ${items[0].title}`);
    for (const item of items.slice(0, 3)) {
      console.log(`      selector: ${item.selector}`);
      console.log(`      element:  ${item.element.slice(0, 120)}`);
    }
    if (items.length > 3) console.log(`      ... and ${items.length - 3} more`);
  }
}
