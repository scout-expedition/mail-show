// Production stand-in for the `agentation` dev toolbar. NOT dead code: it is
// the alias target in next.config.ts's `turbopack.resolveAlias`. The
// `process.env.NODE_ENV === "development"` guard in the root layout stops the
// toolbar rendering in production but does NOT keep the package out of the
// bundle — without this alias the ~670KB dev tool ships to every visitor.
// Deleting this file silently re-adds that weight.
export function Agentation() {
  return null;
}
