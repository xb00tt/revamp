import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { listInstalls, listPatches, patchApp, revampPaths, rollback, uninstall } from "@revamp/engine";
import { formatInstalls, formatPatchList, formatPatchResult } from "./format.ts";

// Running from the repo, the bundle defaults to the repo build. A function, because a SEA has no import.meta.url.
const defaultBundle = () => fileURLToPath(new URL("../../../bundles/official/dist/official.mjs", import.meta.url));

const USAGE = `Usage:
  revamp patch <app> [--version <v>] [--force] [--enable <patch>]... [--disable <patch>]...
               [--option "<patch>:<key>=<value>"]... [--bundle <file>] [--dry-run]
  revamp patches <app> [--version <v>] [--bundle <file>]
  revamp list
  revamp rollback <app>
  revamp uninstall <app> [--yes]`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      version: { type: "string" },
      force: { type: "boolean" },
      enable: { type: "string", multiple: true },
      disable: { type: "string", multiple: true },
      option: { type: "string", multiple: true },
      bundle: { type: "string" },
      "dry-run": { type: "boolean" },
      yes: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, appId] = positionals;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (!command) {
    console.error(USAGE);
    return 1;
  }
  const paths = revampPaths();
  const needApp = () => {
    if (!appId) throw new Error(`"${command}" needs an app, e.g. revamp ${command} hydra`);
    return appId;
  };
  switch (command) {
    case "patch": {
      const result = await patchApp({
        appId: needApp(),
        bundlePath: values.bundle ?? defaultBundle(),
        version: values.version,
        force: values.force,
        enable: values.enable,
        disable: values.disable,
        options: values.option,
        dryRun: values["dry-run"],
        paths,
        log: (line) => console.error(line),
      });
      console.log(formatPatchResult(result));
      return result.exitCode;
    }
    case "patches":
      console.log(formatPatchList(await listPatches(values.bundle ?? defaultBundle(), needApp(), values.version)));
      return 0;
    case "list":
      console.log(formatInstalls(listInstalls(paths)));
      return 0;
    case "rollback":
      console.log(`${needApp()}: now using ${rollback(paths, needApp())}`);
      return 0;
    case "uninstall": {
      const id = needApp();
      if (!values.yes) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question(`Remove Revamped ${id} (all versions, its menu entry and saved choices)? [y/N] `);
        rl.close();
        if (!/^y(es)?$/i.test(answer.trim())) return 1;
      }
      uninstall(paths, id);
      console.log(`Removed Revamped ${id}.`);
      return 0;
    }
    default:
      console.error(`Unknown command "${command}".\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(`revamp: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  },
);
