// Entry point of the sandboxed child process started by sandbox.ts. Never import this module:
// it reads a job from stdin as soon as it loads.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { assertAsarPath, readAsar } from "./asar.ts";
import { ASAR_PATH, describeBundle, runJob, type BundleModule, type RunnerJob, type SandboxPatchOutput } from "./job.ts";
import { asarStore } from "./sources.ts";

function loadBundle(path: string): BundleModule {
  // require(esm): import() of files on disk is unavailable inside a Node 26 SEA, and require works in both modes.
  const mod = createRequire(path)(path);
  if (typeof mod?.manifest?.name !== "string" || !Array.isArray(mod.apps) || !Array.isArray(mod.patches)) {
    throw new Error(`${path} is not a Revamp bundle (it needs manifest, apps and patches exports)`);
  }
  return mod as BundleModule;
}

async function main(): Promise<string> {
  // The SEA runs itself as the runner, so `revamp --sandbox-runner` must not run bundle code unconfined.
  if (!process.permission) throw new Error("the sandbox runner only runs under Node's permission model");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const job = JSON.parse(Buffer.concat(chunks).toString("utf8")) as RunnerJob;
  const bundle = loadBundle(job.bundle);
  if (job.mode === "describe") return JSON.stringify(describeBundle(bundle));

  const out = runJob(bundle, job, asarStore(readAsar(join(job.staging, ASAR_PATH))));
  for (const [path, buf] of out.outputs) {
    const dest = join(job.outDir, "files", ...assertAsarPath(path).split("/"));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
  }
  const result: SandboxPatchOutput = {
    results: out.results,
    aborted: out.aborted ?? null,
    files: [...out.outputs.keys()],
    desktopEntry: out.desktopEntry,
    logs: out.logs,
  };
  return JSON.stringify(result);
}

main().then(
  (json) => void process.stdout.write(json),
  (e) => {
    process.stderr.write(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  },
);
