// Register custom ESM resolve hook that strips "npm:" prefix from specifiers
// so analysis.ts (written for Deno's npm: import maps) can run in Node tests.
//
// Usage:
//   node --import ./supabase/functions/ada-scan/register-resolver.js \
//     supabase/functions/ada-scan/tests/test-empty-link.test.mjs

import { register } from "node:module";

register("./npm-resolver.js", import.meta.url);
