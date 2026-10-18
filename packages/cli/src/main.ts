#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { isSea } from "node:sea";
import { parseArgs } from "node:util";
import {
  addSource,
  checkMessage,
  checkUpdates,
  DEFAULT_SOURCE,
  doctorExitCode,
  listInstalls,
  listPatches,
  loadSources,
  onPath,
  patchApp,
  prepareSource,
  PROFILE_DIR,
  realDoctorEnv,
  realSandboxEnv,
  removeHelper,
  removeSource,
  revampPaths,
  rollback,
  runDoctor,
  uninstall,
  updateApp,
  userNamespacesRestricted,
  type Paths,
} from "@revamp-app/engine";
import { formatInstalls, formatPatchList, formatPatchResult, formatSourceCandidate, formatSources, printable } from "./format.ts";
import { bundleFor, seedDefaultSource } from "./bundle-for.ts";
import { notifyCheck } from "./notify.ts";
import { newPatchesPrompt } from "./new-patches.ts";
import { applyProfile, cancelled, canPrompt, existingProfileNames, pkexecFailed, pkexecPath, planProfile, runAsRoot, sudoInstructions, writeHelper } from "./sandbox.ts";
import { serve } from "./serve.ts";
import { installCli, installWindow } from "./install.ts";
import { disableTimer, enableTimer } from "./timer.ts";

// Bundles supply names, notes and messages, and the trust prompt follows them: print nothing that moves the cursor.
const print = (text: string) => console.log(printable(text));
const printError = (text: string) => console.error(printable(text));

const USAGE = `Usage:
  revamp patch <app> [--version <v>] [--force] [--enable <patch>]... [--disable <patch>]...
               [--option "<patch>:<key>=<value>"]... [--bundle <file>] [--dry-run] [--yes]
  revamp patches <app> [--version <v>] [--bundle <file>]
  revamp list
  revamp rollback <app>
  revamp uninstall <app> [--yes]
  revamp sources add <owner/repo | https-url-of-bundle.json | file.mjs> [--yes]
  revamp sources list
  revamp sources remove <source>
  revamp check [--notify]
  revamp update [<app>] [--force] [--yes]
  revamp timer enable|disable
  revamp self-install   install this binary (and the window beside it) for your user
  revamp doctor         check this machine: libraries, the sandbox, PATH, the timer, sources
  revamp sandbox <app>  install the AppArmor profile a Revamped app needs on Ubuntu 24.04+ (one administrator prompt)
  revamp serve        JSON-RPC 2.0 on stdin/stdout, for the GUI

Without --bundle, an app's bundle comes from the first source that has it.`;

// One interface for the whole run: a second one would find the first has already read the lines piped in behind the first
// answer (`printf 'y\ny\n' | revamp uninstall hydra`). Lines are read through its iterator, which queues them.
let input: { rl: Interface; lines: AsyncIterator<string>; closed: boolean } | undefined;

async function confirm(question: string): Promise<boolean> {
  if (!input) {
    // terminal: false leaves the tty in the kernel's canonical mode (echo, backspace, Ctrl-C, Ctrl-D) for the whole run:
    // readline's own terminal mode is raw, and would stay raw through the download or the pkexec prompt after the answer.
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    input = { rl, lines: rl[Symbol.asyncIterator](), closed: false };
    rl.once("close", () => input && (input.closed = true));
  }
  const prompt = `${question} [y/N] `;
  if (input.closed) process.stdout.write(prompt); // a closed interface can't prompt
  else {
    input.rl.setPrompt(prompt);
    input.rl.prompt();
  }
  const next = await input.lines.next();
  if (next.done) {
    process.stdout.write("\n"); // the end of input answers no, on the prompt's line
    return false;
  }
  return /^y(es)?$/i.test(next.value.trim());
}

/** Lets go of stdin so the process can exit. */
const closeInput = () => input?.rl.close();

async function sources(paths: Paths, sub: string | undefined, location: string | undefined, yes: boolean): Promise<number> {
  const needLocation = () => {
    if (!location) throw new Error(`"sources ${sub}" needs a source, e.g. revamp sources ${sub} ${DEFAULT_SOURCE}`);
    return location;
  };
  switch (sub) {
    case "add": {
      const loc = needLocation();
      // The default goes in first, so a first `sources add` of another repo never takes its place; adding the default itself is the seed.
      if (loc !== DEFAULT_SOURCE) await seedDefaultSource(paths, printError);
      const candidate = await prepareSource(paths, loc);
      print(formatSourceCandidate(candidate));
      if (!yes && !(await confirm("Trust this bundle and add the source?"))) return 1;
      addSource(paths, candidate.source);
      print(`Added ${candidate.source.location}.`);
      return 0;
    }
    case "list":
      await seedDefaultSource(paths, printError);
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

// One source for pkexec's path: the check that a prompt is possible and the run use the same program.
const PKEXEC = pkexecPath(process.env);
const canAsk = () => canPrompt(process.env, PKEXEC);
const asRoot = (script: string) => runAsRoot(script, undefined, PKEXEC);

/** What root is about to run, shown before anything asks for it. */
const showScript = (script: string) => print(`This script runs with administrator rights:\n\n${script.trimEnd()}\n`);

async function sandbox(paths: Paths, id: string, yes: boolean): Promise<number> {
  const plan = planProfile(paths, id);
  if (!userNamespacesRestricted()) print(`This system doesn't restrict user namespaces, so Revamped ${id} starts without a profile. Installing one anyway is harmless.`);
  showScript(plan.script);
  print(`This writes ${plan.file} and runs: apparmor_parser -r ${plan.file}`);
  if (!canAsk()) {
    print(plan.sudo());
    return 1;
  }
  if (!yes && !(await confirm("Write it with administrator rights?"))) {
    print(`Nothing changed. ${plan.sudo()}`);
    return 1;
  }
  const failure = applyProfile(plan, PKEXEC);
  if (failure) {
    print(failure);
    return 1;
  }
  print(`Installed and loaded ${plan.file}. Start ${id} (Revamped) again.`);
  return 0;
}

/** After an uninstall: offers to remove this user's sandbox profile(s) for the app. Never fails the uninstall. */
async function removeProfile(paths: Paths, id: string, yes: boolean): Promise<void> {
  const names = existingProfileNames(paths, id, realSandboxEnv());
  if (names.length === 0) return;
  const many = names.length > 1;
  const script = removeHelper(names);
  const sudo = () => sudoInstructions(writeHelper(paths, `${names[0]}-remove`, script));
  const files = names.map((n) => `${PROFILE_DIR}/${n}`);
  for (const f of files) print(`A sandbox profile ${f} remains.`);
  showScript(script);
  if (!canAsk()) {
    print(sudo());
    return;
  }
  if (!yes && !(await confirm(`Remove ${many ? "them" : "it"} with administrator rights?`))) {
    print(`${many ? "They stay." : "It stays."} ${sudo()}`);
    return;
  }
  const r = asRoot(script);
  if (r.ok) print(`Removed ${files.join(", ")}.`);
  else print(cancelled(r) ? `The administrator prompt was cancelled; the ${many ? "profiles stay" : "profile stays"}.` : pkexecFailed(r, sudo()));
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
  // parseArgs takes every flag for every command, and only patch has a dry run: the others would quietly do it for real.
  if (values["dry-run"] && command !== "patch") throw new Error(`"${command}" has no --dry-run; use revamp patch <app> --dry-run`);
  const paths = revampPaths();
  const needApp = () => {
    if (!appId) throw new Error(`"${command}" needs an app, e.g. revamp ${command} hydra`);
    return appId;
  };
  const confirmNewPatches = newPatchesPrompt({ yes: values.yes ?? false, dryRun: values["dry-run"] ?? false, interactive: process.stdin.isTTY === true, confirm, print });
  switch (command) {
    case "patch": {
      const id = needApp();
      if (!values.bundle) await seedDefaultSource(paths, printError);
      const result = await patchApp({
        appId: id,
        bundlePath: await bundleFor(paths, id, values.bundle, printError),
        version: values.version,
        force: values.force,
        enable: values.enable,
        disable: values.disable,
        options: values.option,
        dryRun: values["dry-run"],
        confirmNewPatches,
        paths,
        log: (line) => printError(line),
      });
      print(formatPatchResult(result));
      return result.exitCode;
    }
    case "patches": {
      const id = needApp();
      if (!values.bundle) await seedDefaultSource(paths, printError);
      print(formatPatchList(await listPatches(await bundleFor(paths, id, values.bundle, printError), id, values.version)));
      return 0;
    }
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
      try {
        await removeProfile(paths, id, values.yes ?? false);
      } catch (e) {
        printError(`revamp: couldn't check for a sandbox profile: ${e instanceof Error ? e.message : String(e)}`);
      }
      return 0;
    }
    case "doctor": {
      const checks = runDoctor(paths, realDoctorEnv());
      // Extra detail lines (sources, apps) are indented, so a source's name can't fake a check line of its own.
      const indent = (text: string) => text.replaceAll("\n", "\n    ");
      for (const c of checks) {
        print(`${c.severity === "ok" ? "✓" : "✗"} ${c.label}: ${indent(c.detail)}`);
        if (c.fix) print(`    Fix: ${indent(c.fix)}`);
      }
      return doctorExitCode(checks);
    }
    case "sandbox":
      return sandbox(paths, needApp(), values.yes ?? false);
    case "check": {
      await seedDefaultSource(paths, printError);
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
      await seedDefaultSource(paths, printError);
      const ids = appId ? [appId] : listInstalls(paths).filter((a) => a.current).map((a) => a.appId);
      if (ids.length === 0) print("No Revamped apps installed.");
      let code = 0;
      for (const id of ids) {
        try {
          const u = await updateApp(id, { paths, force: values.force, confirmNewPatches, log: (line) => printError(line) });
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
    case "self-install": {
      if (!isSea()) throw new Error("self-install runs from the release's revamp binary; from the repo use npm run install:cli or npm run gui:install");
      const home = process.env.HOME || homedir();
      const dir = dirname(process.execPath);
      const { bin, link } = installCli(paths, process.execPath, home);
      print(`Installed ${bin}; ${link} points to it.`);
      const gui = join(dir, "revamp-gui");
      const icon = join(dir, "revamp.png");
      if (existsSync(gui) && existsSync(icon)) print(`Installed ${installWindow(paths, { gui, icon })}; "Revamp" is in your applications menu.`);
      else print("No revamp-gui beside this binary, so only the command line was (re)installed; an installed window stays as it is.");
      if (!onPath((process.env.PATH ?? "").split(":"), dirname(link))) print("Add ~/.local/bin to your PATH to run revamp from anywhere.");
      print("For a daily update check, run: revamp timer enable");
      return 0;
    }
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

main(process.argv.slice(2))
  .then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      printError(`revamp: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    },
  )
  .finally(closeInput);
