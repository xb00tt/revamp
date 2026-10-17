// What `npm run publish:packages` writes as each package's package.json: pure functions, no I/O.

/** The publish order: each package's dependencies are published before it. */
export const PUBLISHED = ["sdk", "engine", "cli"] as const;

const compiled = (path: string) => path.replace(/\.ts$/, ".js");

/**
 * The workspace manifest points at `src/*.ts`; the published one points at the compiled `.js` and `.d.ts`, pins the
 * sibling `@revamp-app/*` packages to the same version, and drops what npm must not see (`private`, `scripts`).
 */
export function publishedManifest(pkg: Record<string, any>, version: string): Record<string, unknown> {
  const exports = Object.fromEntries(
    Object.entries(pkg.exports as Record<string, string>).map(([key, path]) => [key, { types: path.replace(/\.ts$/, ".d.ts"), default: compiled(path) }]),
  );
  const dependencies = Object.fromEntries(
    Object.entries((pkg.dependencies ?? {}) as Record<string, string>).map(([name, range]) => [name, name.startsWith("@revamp-app/") ? version : range]),
  );
  const manifest: Record<string, unknown> = { name: pkg.name, version, type: "module", license: pkg.license, exports, dependencies };
  if (pkg.bin) manifest.bin = Object.fromEntries(Object.entries(pkg.bin as Record<string, string>).map(([name, path]) => [name, compiled(path)]));
  return manifest;
}

/** Names each package whose version differs from ENGINE_VERSION, or `undefined` when all three match. */
export function versionProblem(versions: Record<string, string>, engineVersion: string): string | undefined {
  const differing = Object.entries(versions).filter(([, v]) => v !== engineVersion);
  if (differing.length === 0) return undefined;
  return `the packages must all be ENGINE_VERSION ${engineVersion}: ${differing.map(([name, v]) => `${name} is ${v}`).join(", ")}`;
}
