import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const RUNNER = fileURLToPath(new URL("./runner.ts", import.meta.url));
/** Dev mode runs this repo's TypeScript in the child, so it may read the repo (sources and node_modules). */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_TIMEOUT_MS = 180_000;

export class SandboxError extends Error {}

export interface SandboxAccess {
  read: string[];
  write: string[];
}

/**
 * Runs `entry` (default: the bundle runner) in a child Node process under the permission model.
 * Reads are limited to the repo and access.read and writes to access.write. There is no network,
 * no child processes, workers, addons or WASI, and the environment holds only PATH.
 * The job goes in on stdin; the child's stdout must be JSON.
 */
export function runSandboxed<T>(job: unknown, access: SandboxAccess, o: { entry?: string; timeoutMs?: number } = {}): Promise<T> {
  const timeout = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = [
    "--permission",
    ...[REPO_ROOT, ...access.read].map((p) => `--allow-fs-read=${p}`),
    ...access.write.map((p) => `--allow-fs-write=${p}`),
    o.entry ?? RUNNER,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", REVAMP_SANDBOX: "1" },
      timeout,
      killSignal: "SIGKILL",
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.stdin.on("error", () => {}); // the child may exit before reading all of stdin
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const stderr = Buffer.concat(err).toString().trim();
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
