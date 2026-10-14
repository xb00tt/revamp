// @revamp/sdk: what bundle authors import. Declarations and types only; the engine does the work.

export interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: any;
}

export interface Editable {
  replace(code: string): void;
  insertBefore(code: string): void;
  insertAfter(code: string): void;
  remove(): void;
}

/** A `$NAME` or `$$$NAME` blank from a pattern, or a named group from a regex fingerprint. */
export interface Capture extends Editable {
  readonly file: string;
  /** The captured node; undefined for list captures and regex groups. */
  readonly node: AstNode | undefined;
  /** The captured nodes of a `$$$NAME` list blank. */
  readonly items: readonly AstNode[] | undefined;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  toString(): string;
}

export interface Match extends Editable {
  readonly file: string;
  /** The matched node; undefined for regex fingerprints. */
  readonly node: AstNode | undefined;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  /** Exactly one match of `pattern` inside this match. */
  find(pattern: string): Match;
  findAll(pattern: string): Match[];
  readonly [capture: `$${string}`]: Capture;
}

export interface TextFile {
  readonly path: string;
  readonly text: string;
  setText(text: string): void;
  json<T = unknown>(): T;
  setJson(value: unknown): void;
}

export type OptionType = "bool" | "string" | "number";

export interface OptionDef<T> {
  readonly kind: "option";
  readonly type: OptionType;
  title: string;
  description?: string;
  default?: T;
  /** Named presets shown to users. */
  values?: Record<string, T>;
  required?: boolean;
  /** Returns an error message, or undefined when the value is fine. */
  validate?: (value: T) => string | undefined;
}

type OptionInput<T> = Omit<OptionDef<T>, "kind" | "type">;

export const option = {
  bool: (o: OptionInput<boolean>): OptionDef<boolean> => ({ kind: "option", type: "bool", ...o }),
  string: (o: OptionInput<string>): OptionDef<string> => ({ kind: "option", type: "string", ...o }),
  number: (o: OptionInput<number>): OptionDef<number> => ({ kind: "option", type: "number", ...o }),
};

export type Options = Record<string, OptionDef<any>>;
export type OptionValues<O extends Options> = {
  [K in keyof O]: O[K] extends OptionDef<infer T> ? T | undefined : never;
};

export interface PatchContext<O extends Options = Options> {
  readonly app: { readonly id: string; readonly version: string };
  readonly options: OptionValues<O>;
  /** The single match of a `count: "one"` fingerprint. */
  match(fp: Fingerprint): Match;
  /** Every match of a `count: "many"` fingerprint. */
  matchAll(fp: Fingerprint): Match[];
  /** A text file at a fixed path inside app.asar (package.json, index.html). */
  file(path: string): TextFile;
  /** Adds a new file inside app.asar. */
  addFile(path: string, contents: string | Uint8Array): void;
  /** [Desktop Entry] keys, prefilled from the stock .desktop file. Exec and Icon are set by the installer. */
  readonly desktopEntry: Record<string, string>;
  log(message: string): void;
}

export interface FingerprintDef {
  name: string;
  /** Raw substrings that must all occur in a file before it is parsed. */
  strings: string[];
  pattern?: string;
  regex?: RegExp;
  where?: Record<string, (m: Match) => boolean>;
  count?: "one" | "many";
  /** "app" (default) skips node_modules/; "all" searches it too. */
  scope?: "app" | "all";
}

export interface Fingerprint extends Readonly<FingerprintDef> {
  readonly kind: "fingerprint";
}

export function fingerprint(def: FingerprintDef): Fingerprint {
  if (def.strings.length === 0) throw new Error(`fingerprint "${def.name}": strings must not be empty`);
  if ((def.pattern === undefined) === (def.regex === undefined)) {
    throw new Error(`fingerprint "${def.name}": set exactly one of pattern or regex`);
  }
  if (def.regex && !def.regex.global) throw new Error(`fingerprint "${def.name}": regex needs the g flag`);
  return { kind: "fingerprint", ...def };
}

export interface AppVersion {
  sha256: string;
  experimental?: boolean;
}

export interface AppDef {
  readonly kind: "app";
  id: string;
  name: string;
  /** `{version}` in tag and asset is replaced by the version. */
  release: { github: string; tag: string; asset: string };
  /** Directory of the app inside the .deb data tree, e.g. "opt/Hydra". */
  installDir: string;
  /** Executable relative to installDir. */
  executable: string;
  /** Stock desktop file inside the .deb data tree. */
  desktopFile: string;
  versions: Record<string, AppVersion>;
  /** Patches always applied for this app; users can't disable them. */
  required: Patch<any>[];
}

export function defineApp(def: Omit<AppDef, "kind" | "required"> & { required?: Patch<any>[] }): AppDef {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(def.id)) throw new Error(`invalid app id "${def.id}"`);
  for (const [version, info] of Object.entries(def.versions)) {
    if (!/^[0-9a-f]{64}$/.test(info.sha256)) {
      throw new Error(`app "${def.id}" ${version}: sha256 must be 64 lowercase hex characters`);
    }
  }
  return { kind: "app", ...def, required: def.required ?? [] };
}

export interface PatchDef<O extends Options> {
  /** Omit to make an internal patch, hidden from users and reached through dependsOn. */
  name?: string;
  description?: string;
  /** Omit for a universal patch (any app, default off unless an app requires it). */
  compatibleWith?: { app: AppDef; versions?: string[] }[];
  dependsOn?: Patch<any>[];
  default?: boolean;
  options?: O;
  execute(ctx: PatchContext<O>): void;
  /** Runs after every patch has executed, in reverse order. */
  finalize?(ctx: PatchContext<O>): void;
}

export interface Patch<O extends Options = Options> extends PatchDef<O> {
  readonly kind: "patch";
}

export function definePatch<O extends Options = {}>(def: PatchDef<O>): Patch<O> {
  return { kind: "patch", ...def };
}

export interface Manifest {
  name: string;
  version: string;
  minEngine: string;
  author: string;
  license: string;
  source: string;
}
