// Custom ESM resolve hook: strips "npm:" prefix and version suffix from
// specifiers so analysis.ts (written for Deno's "npm:linkedom@0.18.13"
// import-map style) can be imported in Node where the package is just
// installed as "linkedom" in node_modules.
//
// Usage:
//   node --import ./supabase/functions/ada-scan/register-resolver.js \
//     supabase/functions/ada-scan/tests/test-empty-link.test.mjs

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("npm:")) {
    // Strip "npm:" prefix and any "@version" suffix
    let clean = specifier.slice(4);
    const atIdx = clean.indexOf("@");
    if (atIdx > 0) {
      // Keep scope packages like @supabase/supabase-js — only strip version
      // if the @ is not at position 0 (scope) and is followed by digits
      const afterAt = clean.slice(atIdx + 1);
      if (/^\d/.test(afterAt)) {
        clean = clean.slice(0, atIdx);
      }
    }
    return nextResolve(clean, context);
  }
  return nextResolve(specifier, context);
}
