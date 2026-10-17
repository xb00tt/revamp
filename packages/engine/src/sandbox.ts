import { spawn } from "node:child_process";
import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 180_000;
/** A stderr line starting with this carries one JSON progress event from the child; every other line is error text. */
export const EVENT_PREFIX = "revamp-event ";

export class SandboxError extends Error {}

export interface SandboxAccess {
  read: string[];
  write: string[];
}

/** Flags in NODE_OPTIONS syntax, which `--node-options` shares: each value in double quotes, backslashes and quotes escaped. */
export function nodeOptions(flags: string[]): string {
  return flags
    .map((flag) => {
      const eq = flag.indexOf("=");
      return eq < 0 ? flag : `${flag.slice(0, eq + 1)}"${flag.slice(eq + 1).replace(/[\\"]/g, "\\$&")}"`;
    })
    .join(" ");
}

function childArgs(access: SandboxAccess, entry: string | undefined): string[] {
  const writes = access.write.map((p) => `--allow-fs-write=${p}`);
  // A SEA ignores Node flags in argv, so they go in --node-options, and the binary itself is the runner (spec §4.4).
  if (isSea()) {
    const flags = ["--permission", ...access.read.map((p) => `--allow-fs-read=${p}`), ...writes];
    return [`--node-options=${nodeOptions(flags)}`, "--sandbox-runner"];
  }
  // Outside the SEA the child runs this engine from where it lives, so it may read the folder three levels above this
  // file: the repo in dev (sources and node_modules), or from an npm install the consumer's node_modules, which holds
  // @revamp-app/engine, acorn and xz-decompress (split design §4.2). That is the boundary: the bundle still sees
  // nothing outside it and the job's paths.
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const runner = entry ?? fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./runner.ts" : "./runner.js", import.meta.url));
  return ["--permission", ...[repo, ...access.read].map((p) => `--allow-fs-read=${p}`), ...writes, runner];
}

/**
 * Runs `entry` (default: the bundle runner; a SEA always runs itself as the runner) in a child Node process under
 * the permission model. Reads are limited to access.read (plus, outside the SEA, the folder that holds this engine:
 * the repo in dev, the consumer's node_modules from an npm install) and writes to access.write.
 * There is no network, no child processes, workers, addons or WASI, and the environment holds only PATH.
 * The job goes in on stdin; the child's stdout must be JSON.
 */
export function runSandboxed<T>(
  job: unknown,
  access: SandboxAccess,
  o: { entry?: string; timeoutMs?: number; onEvent?: (event: unknown) => void } = {},
): Promise<T> {
  const timeout = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = childArgs(access, o.entry);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", REVAMP_SANDBOX: "1" },
      timeout,
      killSignal: "SIGKILL",
    });
    const out: Buffer[] = [];
    const err: string[] = [];
    let partial = "";
    const line = (l: string) => {
      if (!l.startsWith(EVENT_PREFIX)) return void err.push(l);
      try {
        o.onEvent?.(JSON.parse(l.slice(EVENT_PREFIX.length)));
      } catch {
        err.push(l); // not an event after all: keep it as error text
      }
    };
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.setEncoding("utf8"); // whole characters, even when a chunk ends inside one
    child.stderr.on("data", (c: string) => {
      const lines = (partial + c).split("\n");
      partial = lines.pop()!;
      lines.forEach(line);
    });
    child.stdin.on("error", () => {}); // the child may exit before reading all of stdin
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (partial) line(partial);
      const stderr = err.join("\n").trim();
      if (signal) {
        return reject(new SandboxError(`the sandboxed run timed out or was killed (${signal}, limit ${timeout} ms)${stderr ? `: ${stderr}` : ""}`));
      }
      if (code !== 0) return reject(new SandboxError(stderr || `the sandboxed run failed with exit code ${code}`));
      try {
        resolve(JSON.parse(Buffer.concat(out).toString()) as T);
      } catch {
        reject(new SandboxError(`the sandboxed run returned invalid output${stderr ? `: ${stderr}` : ""}`));
      }
    });
    child.stdin.end(JSON.stringify(job));
  });
}
