import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Dev only (`npm run dev -w @revamp-app/gui` in a browser): the page talks to `revamp serve`, run from this repo's source,
 * over Vite's own websocket. It acts on the real home unless HOME points elsewhere.
 */
function revampServe(): Plugin {
  return {
    name: "revamp-serve",
    apply: "serve",
    configureServer(server) {
      const main = fileURLToPath(new URL("../cli/src/main.ts", import.meta.url));
      const child = spawn(process.execPath, [main, "serve"], { stdio: ["pipe", "pipe", "inherit"] });
      createInterface({ input: child.stdout }).on("line", (line) => server.ws.send("revamp:rpc", line));
      server.ws.on("revamp:rpc", (line: string) => void child.stdin.write(`${line}\n`));
      server.httpServer?.on("close", () => child.kill());
    },
  };
}

// Port 1420 is Tauri's dev default; never 3000, which a production server uses on the owner's machine.
export default defineConfig({
  plugins: [react(), revampServe()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022" },
});
