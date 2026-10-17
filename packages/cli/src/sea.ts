// The SEA's entry point (spec §4.4): the same binary is the CLI and, run with --sandbox-runner, the sandbox child.
if (process.argv[2] === "--sandbox-runner") void import("@revamp-app/engine/runner");
else void import("./main.ts");
