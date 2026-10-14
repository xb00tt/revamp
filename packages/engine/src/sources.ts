import { listAsarFiles, readAsarFile, type AsarArchive } from "./asar.ts";
import { parseFile, type ParsedFile } from "./pattern.ts";

export interface SourceStore {
  list(): string[];
  /** Throws if the file does not exist. */
  read(path: string): Buffer;
}

export function memoryStore(files: Record<string, string | Buffer>): SourceStore {
  return {
    list: () => Object.keys(files),
    read: (path) => {
      if (!Object.hasOwn(files, path)) throw new Error(`no file "${path}" in the app`);
      const v = files[path];
      return typeof v === "string" ? Buffer.from(v) : v;
    },
  };
}

export function asarStore(a: AsarArchive): SourceStore {
  const files = listAsarFiles(a);
  const known = new Set(files);
  return {
    list: () => files,
    read: (path) => {
      if (!known.has(path)) throw new Error(`no file "${path}" in the app`);
      return readAsarFile(a, path);
    },
  };
}

const JS = /\.(c|m)?js$/;
const IN_NODE_MODULES = /(^|\/)node_modules\//;

/** Read-through cache over one app's files: raw bytes for prefiltering, text and ASTs for matching. */
export class Sources {
  readonly store: SourceStore;
  private listing: Set<string> | undefined;
  private texts = new Map<string, string>();
  private asts = new Map<string, ParsedFile>();

  constructor(store: SourceStore) {
    this.store = store;
  }

  list(): string[] {
    return [...this.known()];
  }

  has(path: string): boolean {
    return this.known().has(path);
  }

  jsFiles(scope: "app" | "all"): string[] {
    return this.list().filter((p) => JS.test(p) && (scope === "all" || !IN_NODE_MODULES.test(p)));
  }

  /** Raw bytes, not cached: prefiltering may touch thousands of files once. */
  buffer(path: string): Buffer {
    return this.store.read(path);
  }

  text(path: string): string {
    let t = this.texts.get(path);
    if (t === undefined) {
      t = this.store.read(path).toString("utf8");
      this.texts.set(path, t);
    }
    return t;
  }

  /** Parses as an ES module; non-.mjs files fall back to a sloppy script. */
  parsed(path: string): ParsedFile {
    let f = this.asts.get(path);
    if (!f) {
      const code = this.text(path);
      try {
        f = parseFile(code);
      } catch (moduleError) {
        if (path.endsWith(".mjs")) throw moduleError;
        try {
          f = parseFile(code, "script");
        } catch {
          throw moduleError;
        }
      }
      this.asts.set(path, f);
    }
    return f;
  }

  private known(): Set<string> {
    return (this.listing ??= new Set(this.store.list()));
  }
}
