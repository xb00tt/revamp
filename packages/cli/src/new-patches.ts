import type { NewPatchesAnswer, NewPatchesQuestion } from "@revamp/engine";
import { printable } from "./format.ts";

/** The CLI's answer to "this re-patch would turn on new patches": list them, then --yes, a prompt, or off for this run. */
export function newPatchesPrompt(o: {
  yes: boolean;
  dryRun: boolean;
  interactive: boolean;
  confirm: (question: string) => Promise<boolean>;
  print: (line: string) => void;
}): (q: NewPatchesQuestion) => Promise<NewPatchesAnswer> {
  return async (q) => {
    const out = (line: string) => o.print(printable(line));
    const width = Math.max(...q.patches.map((p) => p.name.length)) + 2;
    out(`${q.bundle.name} ${q.bundle.version} adds ${q.patches.length} new patch${q.patches.length === 1 ? "" : "es"} for ${q.appName} ${q.version}:`);
    for (const p of q.patches) out(`  ${p.name.padEnd(width)}${p.description}`);
    if (o.yes) return "on";
    if (o.dryRun || !o.interactive) {
      out('They stay off for this run. To turn them on, run it again with --yes, or use revamp patch <app> --enable "<patch>".');
      return "off-this-run";
    }
    return (await o.confirm("Turn them on?")) ? "on" : "off";
  };
}
