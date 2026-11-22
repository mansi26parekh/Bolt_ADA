// Maps Deno "npm:" specifiers to bare specifiers so the ada-scan tests
// can run under Node (linkedom is installed as a devDependency).
export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("npm:")) {
    return nextResolve(specifier.slice(4).split("@")[0], context);
  }
  return nextResolve(specifier, context);
}
