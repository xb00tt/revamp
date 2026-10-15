import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { isSea } from "node:sea";
import { parseArgs } from "node:util";
import {
  addSource,
  checkMessage,
  checkUpdates,
  listInstalls,
  listPatches,
  loadSources,
  patchApp,
  prepareSource,
  removeSource,
  revampPaths,
  rollback,
  uninstall,
  updateApp,
  type Paths,
} from "@revamp/engine";
import { formatInstalls, formatPatchList, formatPatchResult, formatSourceCandidate, formatSources, printable } from "./format.ts";
import { bundleFor } from "./bundle-for.ts";
import { notifyCheck } from "./notify.ts";
import { serve } from "./serve.ts";
import { disableTimer, enableTimer } from "./timer.ts";

// Bundles supply names, notes and messages, and the trust prompt follows them: print nothing that moves the cursor.
const print = (text: string) => console.log(printable(text));
const printError = (text: string) => console.error(printable(text));

const USAGE = `Usage:
  revamp patch <app> [--version <v>] [--force] [--enable <patch>]... [--disable <patch>]...
               [--option "<patch>:<key>=<value>"]... [--bundle <file>] [--dry-run]
  revamp patches <app> [--version <v>] [--bundle <file>]
  revamp list
  revamp rollback <app>
  revamp uninstall <app> [--yes]
  revamp sources add <owner/repo | https-url-of-bundle.json | file.mjs> [--yes]
  revamp sources list
  revamp sources remove <source>
  revamp check [--notify]
  revamp update [<app>] [--force]
  revamp timer enable|disable
  revamp serve        JSON-RPC 2.0 on stdin/stdout, for the GUI

Without --bundle, an app's bundle comes from the first source that has it.`;

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // End of input answers no: question() never settles when stdin closes, so race it against the close.
  const closed = new Promise<string>((resolve) => rl.once("close", () => resolve("")));
  const answer = await Promise.race([rl.question(`${question} [y/N] `).catch(() => ""), closed]);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function sources(paths: Paths, sub: string | undefined, location: string | undefined, yes: boolean): Promise<number> {
  const needLocation = () => {
    if (!location) throw new Error(`"sources ${sub}" needs a source, e.g. revamp sources ${sub} xb00tt/revamp`);
    return location;
  };
  switch (sub) {
    case "add": {
      const candidate = await prepareSource(paths, needLocation());
      print(formatSourceCandidate(candidate));
      if (!yes && !(await confirm("Trust this bundle and add the source?"))) return 1;
      addSource(paths, candidate.source);
      print(`Added ${candidate.source.location}.`);
      return 0;
    }
    case "list":
      print(formatSources(loadSources(paths)));
      return 0;
    case "remove": {
      const removed = removeSource(paths, needLocation());
      print(`Removed ${removed.location} ("${removed.name}" ${removed.version}).`);
      return 0;
    }
    default:
      printError(`Unknown sources command "${sub ?? ""}".\n${USAGE}`);
      return 1;
  }
}

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
      notify: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, appId] = positionals;
  if (values.help) {
    print(USAGE);
    return 0;
  }
  if (!command) {
    printError(USAGE);
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
        bundlePath: await bundleFor(paths, needApp(), values.bundle, printError),
        version: values.version,
        force: values.force,
        enable: values.enable,
        disable: values.disable,
        options: values.option,
        dryRun: values["dry-run"],
        paths,
        log: (line) => printError(line),
      });
      print(formatPatchResult(result));
      return result.exitCode;
    }
    case "patches":
      print(formatPatchList(await listPatches(await bundleFor(paths, needApp(), values.bundle, printError), needApp(), values.version)));
      return 0;
    case "list":
      print(formatInstalls(listInstalls(paths)));
      return 0;
    case "rollback":
      print(`${needApp()}: now using ${rollback(paths, needApp())}`);
      return 0;
    case "uninstall": {
      const id = needApp();
      if (!values.yes && !(await confirm(`Remove Revamped ${id} (all versions, its menu entry and saved choices)?`))) return 1;
      uninstall(paths, id);
      print(`Removed Revamped ${id}.`);
      return 0;
    }
    case "check": {
      const r = await checkUpdates({ paths, log: (line) => printError(line) });
      for (const line of r.sources) print(line);
      if (r.apps.length === 0) print("No Revamped apps installed.");
      for (const c of r.apps) print(checkMessage(c));
      if (values.notify) {
        const gui = join(paths.data, "gui", "revamp-gui");
        const news = r.apps.filter((c) => c.status !== "up to date" && c.status !== "skipped").map((c) => printable(checkMessage(c)));
        // Run by hand from a terminal (the timer's stdin is /dev/null), the check doesn't wait up to ten minutes for a
        // click: no Open Revamp button then.
        notifyCheck(news, existsSync(gui) && !process.stdin.isTTY ? gui : undefined, printError);
      }
      return r.apps.some((c) => c.status === "failed") ? 1 : 0;
    }
    case "update": {
      const ids = appId ? [appId] : listInstalls(paths).filter((a) => a.current).map((a) => a.appId);
      if (ids.length === 0) print("No Revamped apps installed.");
      let code = 0;
      for (const id of ids) {
        try {
          const u = await updateApp(id, { paths, force: values.force, log: (line) => printError(line) });
          print(u.result ? formatPatchResult(u.result) : `${u.appName} ${u.current} is up to date`);
          code = Math.max(code, u.result?.exitCode ?? 0);
        } catch (e) {
          if (appId) throw e;
          // One app's failure (say, an unlisted newest release) must not stop the others.
          printError(`revamp: ${id}: ${e instanceof Error ? e.message : String(e)}`);
          code = Math.max(code, 1);
        }
      }
      return code;
    }
    case "serve":
      await serve({ paths, log: printError });
      return 0;
    case "timer": {
      const units = join(dirname(paths.config), "systemd", "user");
      if (appId === "enable") {
        // The timer starts this very binary, so it has to be the installed SEA, not node running the repo's source
        // or a repo-built SEA that the next build overwrites.
        const bin = join(paths.data, "bin", "revamp");
        if (!isSea() || process.execPath !== bin) throw new Error(`the timer runs the installed revamp (${bin}): run npm run install:cli, then revamp timer enable`);
        enableTimer(units, process.execPath);
        print(`Enabled revamp-check.timer: "${process.execPath} check --notify" runs daily.`);
        return 0;
      }
      if (appId === "disable") {
        disableTimer(units);
        print("Disabled revamp-check.timer.");
        return 0;
      }
      printError(`"timer" needs enable or disable.\n${USAGE}`);
      return 1;
    }
    case "sources":
      return sources(paths, positionals[1], positionals[2], values.yes ?? false);
    default:
      printError(`Unknown command "${command}".\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    printError(`revamp: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  },
);
