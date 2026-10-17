import type { Fingerprint } from "@revamp-app/sdk";
import { fromPattern, MatchImpl, type CaptureSpec, type Host } from "./match.ts";
import { compilePattern, findMatches } from "./pattern.ts";

export class FingerprintError extends Error {
  readonly fingerprint: string;
  readonly step: string;
  readonly detail: string;

  constructor(fingerprint: string, step: string, detail: string) {
    super(`fingerprint "${fingerprint}" failed at step "${step}": ${detail}`);
    this.fingerprint = fingerprint;
    this.step = step;
    this.detail = detail;
  }
}

const brief = (items: string[], max = 5) =>
  items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} and ${items.length - max} more`;

/** Resolves fingerprints against one app's files. Results and errors are cached for the whole job. */
export class Fingerprints {
  private readonly host: Host;
  private cache = new Map<Fingerprint, MatchImpl[] | FingerprintError>();

  constructor(host: Host) {
    this.host = host;
  }

  resolve(fp: Fingerprint): MatchImpl[] {
    let r = this.cache.get(fp);
    if (r === undefined) {
      try {
        r = this.compute(fp);
      } catch (e) {
        if (!(e instanceof FingerprintError)) throw e;
        r = e;
      }
      this.cache.set(fp, r);
    }
    if (r instanceof FingerprintError) throw r;
    return r;
  }

  private compute(fp: Fingerprint): MatchImpl[] {
    const { sources } = this.host;
    const scope = fp.scope ?? "app";
    const files = sources.jsFiles(scope);
    const hits = files.filter((f) => {
      const b = sources.buffer(f);
      return fp.strings.every((s) => b.includes(s));
    });
    if (hits.length === 0) {
      const counts = fp.strings.map((s) => `${JSON.stringify(s)} in ${files.filter((f) => sources.buffer(f).includes(s)).length} file(s)`);
      throw new FingerprintError(
        fp.name,
        "strings",
        `no file contains all strings (${counts.join(", ")}; searched ${files.length} ${scope === "app" ? "app " : ""}JS files)`,
      );
    }

    let matches: MatchImpl[] = [];
    if (fp.pattern !== undefined) {
      let pattern;
      try {
        pattern = compilePattern(fp.pattern);
      } catch (e) {
        throw new FingerprintError(fp.name, "pattern", (e as Error).message);
      }
      const unparsable: string[] = [];
      for (const f of hits) {
        let parsed;
        try {
          parsed = sources.parsed(f);
        } catch (e) {
          unparsable.push(`${f} (${(e as Error).message})`);
          continue;
        }
        for (const m of findMatches(pattern, parsed)) matches.push(fromPattern(this.host, f, m.node, m.captures));
      }
      if (matches.length === 0) {
        throw new FingerprintError(
          fp.name,
          "pattern",
          `strings matched ${hits.length} file(s): ${brief(hits)}; pattern ${fp.pattern} matched 0 nodes` +
            (unparsable.length > 0 ? `; could not parse ${brief(unparsable)}` : ""),
        );
      }
    } else {
      const re = fp.regex!;
      const flags = re.flags.includes("d") ? re.flags : `${re.flags}d`;
      for (const f of hits) {
        for (const m of sources.text(f).matchAll(new RegExp(re.source, flags))) {
          const specs = new Map<string, CaptureSpec>();
          for (const [name, span] of Object.entries(m.indices?.groups ?? {})) {
            if (span) specs.set(name, { start: span[0], end: span[1] });
          }
          matches.push(new MatchImpl(this.host, f, m.index, m.index + m[0].length, undefined, specs));
        }
      }
      if (matches.length === 0) {
        throw new FingerprintError(fp.name, "regex", `strings matched ${hits.length} file(s): ${brief(hits)}; regex ${re} matched nothing`);
      }
    }

    for (const [name, check] of Object.entries(fp.where ?? {})) {
      const before = matches.length;
      matches = matches.filter((m) => check(m));
      if (matches.length === 0) throw new FingerprintError(fp.name, `where:${name}`, `${before} match(es) before this check, 0 after`);
    }
    if ((fp.count ?? "one") === "one" && matches.length !== 1) {
      throw new FingerprintError(
        fp.name,
        "count",
        `expected exactly 1 match, found ${matches.length}: ${brief(matches.map((m) => `${m.file}:${m.line}`))}`,
      );
    }
    return matches;
  }
}
