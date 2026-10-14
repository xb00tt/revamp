// Runtime code compiled into extensions. The app's own objects reach an extension through
// globalThis.__revamp.registry (filled by registry patches) and are looked up when they are used, never at load,
// because the extension's <script> runs before the app's module.

export interface RevampGlobal {
  /** App internals by name, filled by the bundle's registry patches. */
  registry: Record<string, unknown>;
  /** Extension replacements for mounted components, by mount id. */
  mounts: Record<string, unknown>;
  /** Wraps an app component so an extension can replace it; installed by the extension. */
  mount?: (id: string, original: unknown) => unknown;
}

export const revamp = (): RevampGlobal => ((globalThis as { __revamp?: RevampGlobal }).__revamp ??= { registry: {}, mounts: {} });

/** An app internal from the registry; throws a named error when a registry patch didn't provide it. */
export function need<T = any>(name: string): T {
  const value = revamp().registry[name];
  if (value === undefined) throw new Error(`Revamp: "${name}" is missing from the app registry`);
  return value as T;
}
