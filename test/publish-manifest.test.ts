import { test } from "node:test";
import assert from "node:assert/strict";
import { publishedManifest, versionProblem } from "../scripts/publish-manifest.ts";

const engines = { node: ">=26" };

test("publishedManifest points exports and bin at the compiled files, pins the sibling packages and describes the package", () => {
  const cli = { name: "@revamp-app/cli", version: "0.3.0", private: true, type: "module", license: "GPL-3.0-only", description: "The revamp command",
    exports: { "./format": "./src/format.ts" }, bin: { revamp: "src/main.ts" }, scripts: { build: "x" },
    dependencies: { "@revamp-app/engine": "*", acorn: "^8.19.0" } };
  assert.deepEqual(publishedManifest(cli, "0.3.0", engines), {
    name: "@revamp-app/cli", version: "0.3.0", type: "module", license: "GPL-3.0-only", description: "The revamp command",
    repository: { type: "git", url: "git+https://github.com/xb00tt/revamp.git", directory: "packages/cli" },
    engines: { node: ">=26" },
    exports: { "./format": { types: "./src/format.d.ts", default: "./src/format.js" } },
    dependencies: { "@revamp-app/engine": "0.3.0", acorn: "^8.19.0" },
    bin: { revamp: "src/main.js" },
  });
});

test("publishedManifest keeps the sdk's optional peers", () => {
  const sdk = { name: "@revamp-app/sdk", version: "0.3.0", type: "module", license: "GPL-3.0-only", description: "Types for bundle authors",
    exports: { ".": "./src/index.ts" },
    peerDependencies: { react: "^18.0.0" }, peerDependenciesMeta: { react: { optional: true } } };
  assert.deepEqual(publishedManifest(sdk, "0.3.0", engines), {
    name: "@revamp-app/sdk", version: "0.3.0", type: "module", license: "GPL-3.0-only", description: "Types for bundle authors",
    repository: { type: "git", url: "git+https://github.com/xb00tt/revamp.git", directory: "packages/sdk" },
    engines: { node: ">=26" },
    exports: { ".": { types: "./src/index.d.ts", default: "./src/index.js" } },
    dependencies: {},
    peerDependencies: { react: "^18.0.0" }, peerDependenciesMeta: { react: { optional: true } },
  });
});

test("versionProblem names each package that differs from ENGINE_VERSION", () => {
  assert.equal(versionProblem({ sdk: "0.3.0", engine: "0.3.0", cli: "0.3.0" }, "0.3.0"), undefined);
  assert.match(versionProblem({ sdk: "0.3.0", engine: "0.2.0", cli: "0.3.0" }, "0.3.0")!, /engine is 0\.2\.0/);
});
