// Tries things the sandbox must forbid and reports what happened. Used by sandbox.test.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const job = JSON.parse(Buffer.concat(chunks).toString());
if (job.mode === "hang") for (;;);

const attempt = async (fn) => {
  try {
    await fn();
    return "allowed";
  } catch (e) {
    return e.code ?? e.cause?.code ?? e.message;
  }
};
const report = {
  readAllowed: await attempt(() => readFileSync(job.allowedFile)),
  readOutside: await attempt(() => readFileSync(job.outsideFile)),
  writeAllowed: await attempt(() => writeFileSync(job.allowedWrite, "ok")),
  writeOutside: await attempt(() => writeFileSync(job.outsideWrite, "no")),
  spawn: await attempt(() => {
    const r = spawnSync("true");
    if (r.error) throw r.error;
  }),
  fetch: await attempt(() => fetch(job.url)),
};
process.stdout.write(JSON.stringify(report));
