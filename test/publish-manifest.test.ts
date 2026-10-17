import { test } from "node:test";
import assert from "node:assert/strict";
import { publishedManifest, versionProblem } from "../scripts/publish-manifest.ts";

test("publishedManifest points exports and bin at the compiled files and pins the sibling packages", () => {
  const cli = { name: "@revamp-app/cli", version: "0.3.0", private: true, type: "module", license: "GPL-3.0-only",
    exports: { "./format": "./src/format.ts" }, bin: { revamp: "src/main.ts" }, scripts: { build: "x" },
    dependencies: { "@revamp-app/engine": "*", acorn: "^8.19.0" } };
  assert.deepEqual(publishedManifest(cli, "0.3.0"), {
    name: "@revamp-app/cli", version: "0.3.0", type: "module", license: "GPL-3.0-only",
    exports: { "./format": { types: "./src/format.d.ts", default: "./src/format.js" } },
    dependencies: { "@revamp-app/engine": "0.3.0", acorn: "^8.19.0" },
    bin: { revamp: "src/main.js" },
  });
});

test("versionProblem names each package that differs from ENGINE_VERSION", () => {
  assert.equal(versionProblem({ sdk: "0.3.0", engine: "0.3.0", cli: "0.3.0" }, "0.3.0"), undefined);
  assert.match(versionProblem({ sdk: "0.3.0", engine: "0.2.0", cli: "0.3.0" }, "0.3.0")!, /engine is 0\.2\.0/);
});
